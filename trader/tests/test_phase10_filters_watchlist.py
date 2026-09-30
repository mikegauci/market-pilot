from __future__ import annotations

import unittest
from datetime import datetime, timezone

from analysis.buy_hold_margin_audit import PredProb, audit_margin_at_threshold, sweep_margin_audit
from analysis.demotion_compare import ClosedTradeExit, compare_demotion_vs_own_signal
from analysis.filter_replay import ReplaySample, named_presets, replay_all, replay_variant
from models.types import MarketState, RiskSettings, JevRankedSymbol
from strategy.config import StrategyConfig
from strategy.filters import check_entry_filters
from strategy.signals import signal_tier
from watchlist.demotion import jev_sell_exit_allowed, is_off_effective_watchlist
from watchlist.jev_screener import (
    effective_eval_pool_size,
    resolve_ranked_membership,
)
from main import build_eval_symbols
from models.types import Quote, TradeRecord


def _state(**overrides: object) -> MarketState:
    base = dict(
        symbol="NVDA",
        price=100.0,
        change_5m=0.2,
        change_15m=0.3,
        volume_ratio=1.2,
        rsi=55.0,
        ema_9=99.5,
        ema_20=98.0,
        bid=99.98,
        ask=100.02,
        spread=0.04,
        spy_change_5m=0.1,
    )
    base.update(overrides)
    return MarketState(**base)  # type: ignore[arg-type]


class TestPhase10Toggles(unittest.TestCase):
    def test_rsi_toggle_off_skips_veto(self) -> None:
        cfg = StrategyConfig(rsi_veto_enabled=False)
        result = check_entry_filters(_state(rsi=75.0), cfg)
        self.assertTrue(result.passed)

    def test_multi_fail_collects_all_reasons(self) -> None:
        cfg = StrategyConfig(
            min_share_price=50.0,
            require_price_above_ema20=True,
            max_spread_pct=0.0001,
        )
        result = check_entry_filters(
            _state(price=10.0, ema_20=20.0, spread=1.0, rsi=80.0),
            cfg,
        )
        self.assertFalse(result.passed)
        self.assertGreaterEqual(len(result.reasons), 2)
        joined = " ".join(result.reasons)
        self.assertIn("price_too_low", joined)
        self.assertIn("rsi_overbought", joined)

    def test_margin_toggle_off(self) -> None:
        from models.types import JevPrediction

        pred = JevPrediction(
            symbol="X",
            buy=0.86,
            hold=0.80,
            sell=0.34,
            timestamp=datetime.now(timezone.utc),
        )
        blocked = signal_tier(pred, 0.75, 0.85, 0.15, buy_hold_margin_enabled=True)
        self.assertIn("IGNORE (margin)", blocked)
        open_tier = signal_tier(pred, 0.75, 0.85, 0.15, buy_hold_margin_enabled=False)
        self.assertIn("ELIGIBLE", open_tier)

    def test_soft_exit_block_winners_toggle(self) -> None:
        trade = TradeRecord(
            id="1",
            symbol="NVDA",
            side="buy",
            entry_time=datetime.now(timezone.utc),
            entry_price=100.0,
            quantity=1.0,
            position_value=100.0,
            stop_loss=99.0,
            take_profit=102.0,
            status="open",
            paper_or_live="paper",
        )
        quote = Quote(symbol="NVDA", price=101.0, bid=100.9, ask=101.1, spread=0.2)
        settings = RiskSettings(
            minimum_jev_confidence=0.85,
            signal_record_threshold=0.8,
            risk_per_trade=2.5,
            max_position_size=250,
            max_daily_loss=10,
            max_open_positions=2,
            stop_loss_percentage=0.01,
            take_profit_percentage=0.015,
            max_hold_minutes=60,
            account_capital=1000,
            risk_sync_equity=None,
            watchlist=["AAPL"],
            min_hold_minutes=0,
            soft_exit_block_winners_enabled=True,
            demotion_exits_enabled=False,
        )
        self.assertFalse(jev_sell_exit_allowed(trade, settings, quote))
        settings.soft_exit_block_winners_enabled = False
        self.assertTrue(jev_sell_exit_allowed(trade, settings, quote))


class TestBuyHoldAudit(unittest.TestCase):
    def test_redundant_when_margin_never_blocks(self) -> None:
        preds = [PredProb(buy=0.9, hold=0.05) for _ in range(20)]
        row = audit_margin_at_threshold(preds, 0.85, 0.15)
        self.assertTrue(row.redundant)
        self.assertEqual(row.n_blocked_by_margin, 0)

    def test_incremental_when_margin_blocks(self) -> None:
        preds = [PredProb(buy=0.9, hold=0.85) for _ in range(10)]
        row = audit_margin_at_threshold(preds, 0.85, 0.15)
        self.assertFalse(row.redundant)
        self.assertEqual(row.n_blocked_by_margin, 10)

    def test_sweep_size(self) -> None:
        preds = [PredProb(0.9, 0.1)]
        rows = sweep_margin_audit(preds, [0.8, 0.9], [0.1, 0.2])
        self.assertEqual(len(rows), 4)


class TestFilterReplay(unittest.TestCase):
    def test_baseline_accepts_strong_signal(self) -> None:
        samples = [
            ReplaySample(buy=0.9, hold=0.05, sell=0.05, forward_return=0.01),
            ReplaySample(buy=0.9, hold=0.05, sell=0.05, forward_return=-0.01),
        ]
        metrics = replay_variant(samples, named_presets()[0])
        self.assertEqual(metrics.n, 2)
        self.assertAlmostEqual(metrics.hit_rate or 0, 0.5)

    def test_no_margin_accepts_tight_spread(self) -> None:
        samples = [
            ReplaySample(buy=0.9, hold=0.8, sell=0.05, forward_return=0.02),
        ]
        baseline = named_presets()[0]
        no_margin = named_presets()[2]
        self.assertEqual(replay_variant(samples, baseline).n, 0)
        self.assertEqual(replay_variant(samples, no_margin).n, 1)


class TestWatchlistSplit(unittest.TestCase):
    def test_eval_pool_at_least_dynamic(self) -> None:
        settings = RiskSettings(
            minimum_jev_confidence=0.85,
            signal_record_threshold=0.8,
            risk_per_trade=2.5,
            max_position_size=250,
            max_daily_loss=10,
            max_open_positions=2,
            stop_loss_percentage=0.01,
            take_profit_percentage=0.015,
            max_hold_minutes=60,
            account_capital=1000,
            risk_sync_equity=None,
            watchlist=["A", "B", "C", "D", "E"],
            watchlist_dynamic_enabled=True,
            watchlist_dynamic_size=3,
            watchlist_eval_pool_size=2,  # below dynamic — clamped up
            watchlist_screener_ran_at=datetime.now(timezone.utc),
            watchlist_jev_rankings=[
                JevRankedSymbol("A", 0.9, 0.05, 0.05, 1),
                JevRankedSymbol("B", 0.88, 0.05, 0.05, 2),
                JevRankedSymbol("C", 0.86, 0.05, 0.05, 3),
                JevRankedSymbol("D", 0.84, 0.05, 0.05, 4),
                JevRankedSymbol("E", 0.82, 0.05, 0.05, 5),
            ],
        )
        self.assertEqual(effective_eval_pool_size(settings), 3)
        ranked = resolve_ranked_membership(settings)
        self.assertEqual(ranked, ["A", "B", "C"])
        # Off ranked list but in eval pool should demote.
        self.assertTrue(is_off_effective_watchlist("D", settings))
        self.assertFalse(is_off_effective_watchlist("A", settings))

    def test_open_position_always_in_eval(self) -> None:
        symbols = build_eval_symbols(
            ["AAPL", "MSFT"],
            ["OFFLIST"],
            RiskSettings(
                minimum_jev_confidence=0.85,
                signal_record_threshold=0.8,
                risk_per_trade=2.5,
                max_position_size=250,
                max_daily_loss=10,
                max_open_positions=2,
                stop_loss_percentage=0.01,
                take_profit_percentage=0.015,
                max_hold_minutes=60,
                account_capital=1000,
                risk_sync_equity=None,
                watchlist=["AAPL"],
                watchlist_dynamic_enabled=True,
                benchmark_symbol="EEM",
            ),
        )
        self.assertIn("OFFLIST", symbols)
        self.assertIn("AAPL", symbols)


class TestDemotionCompare(unittest.TestCase):
    def test_compare_splits(self) -> None:
        result = compare_demotion_vs_own_signal(
            [
                ClosedTradeExit("1", "A", "demotion_exit", -1.0, True),
                ClosedTradeExit("2", "B", "take_profit", 2.0),
                ClosedTradeExit("3", "C", "jev_sell", 0.5),
                ClosedTradeExit("4", "D", "manual", 0.0),
            ]
        )
        self.assertEqual(result.n_demotion_exits, 1)
        self.assertEqual(result.n_own_signal_exits, 2)
        self.assertEqual(result.n_other, 1)
        self.assertAlmostEqual(result.mean_pnl_demotion or 0, -1.0)
        self.assertAlmostEqual(result.mean_pnl_own_signal or 0, 1.25)


if __name__ == "__main__":
    unittest.main()
