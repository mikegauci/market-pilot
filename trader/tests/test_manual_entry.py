import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from broker.entry_open import OpenTradeResult
from broker.manual_entry import process_manual_entry_commands
from models.types import ExecutionMode, Quote, TradeDecision, TradeRecord, TradingMode
from strategy.config import StrategyConfig


def _trade(**overrides: object) -> TradeRecord:
    base = {
        "id": "trade-new",
        "symbol": "AAPL",
        "side": "buy",
        "entry_time": datetime.now(timezone.utc),
        "entry_price": 100.0,
        "quantity": 2.0,
        "position_value": 200.0,
        "stop_loss": 99.0,
        "take_profit": 101.5,
        "status": "open",
        "paper_or_live": "paper",
    }
    base.update(overrides)
    return TradeRecord(**base)  # type: ignore[arg-type]


class ManualEntryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = MagicMock()
        self.risk_manager = MagicMock()
        self.risk_manager.trading_mode = TradingMode.PAPER
        self.risk_manager.open_trades = []
        self.ibkr = MagicMock()
        self.minute_bars = MagicMock()
        self.minute_bars.get.return_value = MagicMock()
        self.bar_store = MagicMock()
        self.bar_store.get_intraday_bars.return_value = []
        self.runtime = MagicMock()
        self.runtime.ibkr_entry_blocked = set()
        self.runtime.ibkr_entry_cooldown_until = {}
        self.settings = MagicMock()
        self.settings.ibkr_fill_timeout_sec = 30.0

    @patch("broker.manual_entry.open_approved_trade")
    @patch("broker.manual_entry.is_entry_window_open", return_value=True)
    @patch("broker.manual_entry.build_market_state")
    @patch("broker.manual_entry.check_correlation_cap")
    def test_opens_simulated_trade(
        self,
        mock_corr,
        mock_build,
        _window,
        mock_open,
    ) -> None:
        mock_corr.return_value = MagicMock(passed=True, reason="ok")
        mock_build.return_value = MagicMock(symbol="AAPL", price=100.0)
        mock_open.return_value = OpenTradeResult(True)
        self.db.get_pending_entry_commands.return_value = [
            {"id": "cmd-1", "symbol": "AAPL", "quantity": None}
        ]
        self.db.claim_entry_command.return_value = True
        self.risk_manager.evaluate_entry.return_value = TradeDecision(
            True,
            "approved",
            trade=_trade(),
        )
        quotes = {
            "AAPL": Quote(symbol="AAPL", price=100.0, bid=99.9, ask=100.1, spread=0.2),
        }

        dirty = process_manual_entry_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.SIMULATED,
            quotes,
            self.minute_bars,
            self.bar_store,
            StrategyConfig(),
            self.settings,
            self.runtime,
        )

        self.assertTrue(dirty)
        mock_open.assert_called_once()
        self.db.complete_entry_command.assert_called_once_with("cmd-1")
        self.risk_manager.evaluate_entry.assert_called_once()
        self.assertTrue(self.risk_manager.evaluate_entry.call_args.kwargs.get("manual"))

    @patch("broker.manual_entry.is_entry_window_open", return_value=True)
    @patch("broker.manual_entry.build_market_state", return_value=None)
    def test_defers_when_market_warming_up(self, _build, _window) -> None:
        self.db.get_pending_entry_commands.return_value = [
            {"id": "cmd-1", "symbol": "AAPL", "quantity": None}
        ]
        self.db.claim_entry_command.return_value = True

        dirty = process_manual_entry_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.SIMULATED,
            {"AAPL": Quote(symbol="AAPL", price=100.0, bid=None, ask=None, spread=None)},
            self.minute_bars,
            self.bar_store,
            StrategyConfig(),
            self.settings,
            self.runtime,
        )

        self.assertFalse(dirty)
        self.db.defer_entry_command.assert_called_once_with("cmd-1", "market_warming_up")

    @patch("broker.manual_entry.is_entry_window_open", return_value=True)
    def test_fails_live_when_bot_disabled(self, _window) -> None:
        self.risk_manager.trading_mode = TradingMode.LIVE
        self.db.get_pending_entry_commands.return_value = [
            {"id": "cmd-1", "symbol": "AAPL", "quantity": None}
        ]
        self.db.claim_entry_command.return_value = True

        dirty = process_manual_entry_commands(
            self.db,
            self.risk_manager,
            self.ibkr,
            ExecutionMode.SIMULATED,
            {"AAPL": Quote(symbol="AAPL", price=100.0, bid=None, ask=None, spread=None)},
            self.minute_bars,
            self.bar_store,
            StrategyConfig(),
            self.settings,
            self.runtime,
            bot_enabled=False,
        )

        self.assertFalse(dirty)
        self.db.fail_entry_command.assert_called_once_with(
            "cmd-1",
            "manual_buy_requires_bot_enabled_live",
        )
