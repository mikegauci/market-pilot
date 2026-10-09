from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from config import Settings
from market.bars import BarStore
from models.types import ExecutionMode, JevPrediction, MarketState, Quote, RiskSettings, TradingMode
from risk.manager import RiskManager
from runtime.entry_eval import process_ready_states
from runtime.state import TraderRuntimeState
from strategy.config import StrategyConfig
from strategy.confirmation import ConfirmationTracker


def _market_state(symbol: str = "NVDA") -> MarketState:
    return MarketState(
        symbol=symbol,
        price=100.0,
        change_5m=0.2,
        change_15m=0.3,
        volume_ratio=1.2,
        rsi=50.0,
        ema_9=99.0,
        ema_20=98.0,
        bid=99.9,
        ask=100.1,
        spread=0.001,
        spy_change_5m=0.1,
    )


def _prediction(symbol: str = "NVDA", buy: float = 0.92) -> JevPrediction:
    return JevPrediction(
        symbol=symbol,
        buy=buy,
        hold=0.05,
        sell=0.03,
        timestamp=datetime.now(timezone.utc),
        model="jev-latest",
    )


def _risk_settings() -> RiskSettings:
    return RiskSettings(
        minimum_jev_confidence=0.85,
        signal_record_threshold=0.75,
        risk_per_trade=100.0,
        max_position_size=10_000.0,
        max_daily_loss=500.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.015,
        max_hold_minutes=0.0,
        account_capital=10_000.0,
        risk_sync_equity=None,
        watchlist=["NVDA"],
        min_hold_minutes=0.0,
        min_volume_ratio=0.5,
        min_share_price=0.0,
        min_dollar_volume=0.0,
        confirmation_cycles=1,
        confirmation_seconds=0.0,
    )


class ProcessReadyStatesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = TraderRuntimeState()
        self.risk_settings = _risk_settings()
        self.strategy = StrategyConfig(
            confirmation_cycles=1,
            confirmation_seconds=0.0,
            min_volume_ratio=0.5,
        )
        self.confirmation = ConfirmationTracker(1, required_seconds=0.0)
        self.risk_manager = RiskManager(
            settings=self.risk_settings,
            trading_mode=TradingMode.PAPER,
            effective_capital=10_000.0,
        )
        self.db = MagicMock()
        self.ibkr = MagicMock()
        self.ibkr.is_connected.return_value = False
        self.bar_store = MagicMock(spec=BarStore)
        self.bar_store.get_intraday_bars.return_value = []
        self.settings = MagicMock(spec=Settings)
        self.settings.ibkr_fill_timeout_sec = 30.0
        self.settings.ibkr_entry_cooldown_sec = 60.0

    def _run(
        self,
        *,
        prediction: JevPrediction,
        execution_mode: ExecutionMode = ExecutionMode.SIMULATED,
        bot_enabled: bool = True,
        shadow_reader=None,
    ):
        state = _market_state(prediction.symbol)
        quotes = {
            prediction.symbol: Quote(
                symbol=prediction.symbol,
                price=100.0,
                bid=99.9,
                ask=100.1,
                spread=0.001,
            )
        }
        return process_ready_states(
            ready_states=[(prediction.symbol, state)],
            predictions_by_symbol={prediction.symbol: prediction},
            db=self.db,
            risk_manager=self.risk_manager,
            risk_settings=self.risk_settings,
            strategy_config=self.strategy,
            runtime_entry_strategy=self.strategy,
            bar_store=self.bar_store,
            quotes_by_symbol=quotes,
            confirmation_tracker=self.confirmation,
            bot_enabled=bot_enabled,
            execution_mode=execution_mode,
            ibkr=self.ibkr,
            settings=self.settings,
            active_ibkr_account_id=None,
            daily_pnl_account_id=None,
            runtime=self.runtime,
            shadow_reader=shadow_reader,
        )

    def test_low_confidence_records_skip_reason(self) -> None:
        result = self._run(prediction=_prediction(buy=0.5))

        self.assertEqual(len(result.prediction_rows), 1)
        row = result.prediction_rows[0]
        self.assertFalse(row.get("trade_created"))
        self.assertIsNotNone(row.get("trade_skip_reason"))
        self.db.insert_trade.assert_not_called()

    def test_confirmation_required_before_entry(self) -> None:
        self.confirmation = ConfirmationTracker(2, required_seconds=60.0)
        result = self._run(prediction=_prediction())

        self.assertEqual(len(result.prediction_rows), 1)
        reason = result.prediction_rows[0].get("trade_skip_reason") or ""
        self.assertIn("awaiting_confirmation", reason)
        self.db.insert_trade.assert_not_called()

    @patch("runtime.entry_eval.is_entry_window_open", return_value=True)
    @patch("runtime.entry_eval.check_entry_filters")
    @patch("runtime.entry_eval.check_correlation_cap")
    def test_simulated_entry_persists_trade(
        self,
        mock_corr,
        mock_filters,
        _window,
    ) -> None:
        from strategy.filters import FilterResult

        mock_filters.return_value = FilterResult(passed=True, reason=None)
        mock_corr.return_value = FilterResult(passed=True, reason=None)

        result = self._run(prediction=_prediction())

        self.db.insert_trade.assert_called_once()
        self.assertTrue(result.portfolio_dirty)
        row = result.prediction_rows[0]
        self.assertTrue(row.get("trade_created"))

    def test_shadow_read_enriches_payload_before_return(self) -> None:
        shadow_reader = MagicMock()
        shadow_reader.read.return_value = ("agree", "Looks aligned.")

        with patch("runtime.entry_eval.is_entry_window_open", return_value=True):
            with patch("runtime.entry_eval.check_entry_filters") as mock_filters:
                with patch("runtime.entry_eval.check_correlation_cap") as mock_corr:
                    with patch(
                        "runtime.entry_eval.should_shadow_read",
                        return_value=True,
                    ):
                        from strategy.filters import FilterResult

                        mock_filters.return_value = FilterResult(passed=True, reason=None)
                        mock_corr.return_value = FilterResult(passed=True, reason=None)
                        result = self._run(
                            prediction=_prediction(buy=0.92),
                            shadow_reader=shadow_reader,
                        )

        self.assertEqual(len(result.prediction_rows), 1)
        snapshot = result.prediction_rows[0]["market_snapshot"]
        self.assertEqual(snapshot.get("ai_shadow_verdict"), "agree")
        self.assertEqual(snapshot.get("ai_shadow_note"), "Looks aligned.")
        self.assertEqual(snapshot.get("momentum_shadow_verdict"), "would_block")
        shadow_reader.read.assert_called_once()
        read_state = shadow_reader.read.call_args.args[0]
        self.assertIsNone(read_state.momentum_shadow_verdict)

    def test_momentum_shadow_never_blocks_trade(self) -> None:
        with patch("runtime.entry_eval.is_entry_window_open", return_value=True):
            with patch("runtime.entry_eval.check_entry_filters") as mock_filters:
                with patch("runtime.entry_eval.check_correlation_cap") as mock_corr:
                    from strategy.filters import FilterResult

                    mock_filters.return_value = FilterResult(passed=True, reason=None)
                    mock_corr.return_value = FilterResult(passed=True, reason=None)
                    result = self._run(prediction=_prediction())

        row = result.prediction_rows[0]
        self.assertTrue(row.get("trade_created"))
        self.assertEqual(row["market_snapshot"].get("momentum_shadow_verdict"), "would_block")
        self.db.insert_trade.assert_called_once()

    def test_ibkr_blocked_symbol_skips_entry(self) -> None:
        self.runtime.ibkr_entry_blocked.add("NVDA")
        self.ibkr.is_connected.return_value = True
        with patch("runtime.entry_eval.is_entry_window_open", return_value=True):
            with patch("runtime.entry_eval.check_entry_filters") as mock_filters:
                with patch("runtime.entry_eval.check_correlation_cap") as mock_corr:
                    from strategy.filters import FilterResult

                    mock_filters.return_value = FilterResult(passed=True, reason=None)
                    mock_corr.return_value = FilterResult(passed=True, reason=None)
                    result = self._run(
                        prediction=_prediction(),
                        execution_mode=ExecutionMode.IBKR,
                    )

        reason = result.prediction_rows[0].get("trade_skip_reason") or ""
        self.assertIn("ibkr_ineligible", reason)
        self.db.insert_trade.assert_not_called()


if __name__ == "__main__":
    unittest.main()
