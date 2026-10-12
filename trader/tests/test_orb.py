from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from market.bars import Bar
from market.opening_range import (
    in_play_metrics,
    opening_range_for_day,
    opening_range_today,
    rth_bars_by_day,
)
from models.types import JevPrediction, Quote, RiskSettings, TradeRecord, TradingMode
from risk.manager import RiskManager
from runtime.orb_entry import jev_vetoes
from runtime.orb_runtime import rank_in_play
from strategy.config import StrategyConfig
from strategy.exits import breakeven_armed, breakeven_should_exit
from strategy.orb import evaluate_orb, in_play_reason

ET = ZoneInfo("America/New_York")


def _bar(day: str, hh: int, mm: int, o, h, l, c, v, symbol: str = "NVDA") -> Bar:
    ts = datetime.fromisoformat(f"{day}T{hh:02d}:{mm:02d}:00").replace(tzinfo=ET)
    return Bar(symbol, "5 mins", ts.astimezone(timezone.utc), o, h, l, c, v)


def _session(day: str, volume: int, open_px: float = 100.0, close_px: float = 100.5) -> list[Bar]:
    """Three opening bars (9:30, 9:35, 9:40) and a closing bar for one day."""
    return [
        _bar(day, 9, 30, open_px, open_px + 1.0, open_px - 0.5, open_px + 0.5, volume),
        _bar(day, 9, 35, open_px + 0.5, open_px + 1.5, open_px, open_px + 1.0, volume),
        _bar(day, 9, 40, open_px + 1.0, open_px + 1.2, open_px + 0.2, open_px + 0.4, volume),
        _bar(day, 15, 55, close_px, close_px + 0.1, close_px - 0.1, close_px, volume),
    ]


def _settings(**overrides) -> RiskSettings:
    base = dict(
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
    )
    base.update(overrides)
    return RiskSettings(**base)  # type: ignore[arg-type]


class TestOpeningRange(unittest.TestCase):
    def test_five_minute_range_uses_first_bar_only(self) -> None:
        bars = _session("2026-10-09", 1000)
        rng = opening_range_for_day("NVDA", rth_bars_by_day(bars)["2026-10-09"], 5)
        self.assertIsNotNone(rng)
        assert rng is not None
        self.assertEqual((rng.high, rng.low, rng.volume), (101.0, 99.5, 1000.0))

    def test_fifteen_minute_range_spans_three_bars(self) -> None:
        bars = _session("2026-10-09", 1000)
        rng = opening_range_for_day("NVDA", rth_bars_by_day(bars)["2026-10-09"], 15)
        assert rng is not None
        self.assertEqual((rng.high, rng.low, rng.volume), (101.5, 99.5, 3000.0))

    def test_missing_bucket_means_no_range(self) -> None:
        bars = [b for b in _session("2026-10-09", 1000) if b.ts.astimezone(ET).minute != 35]
        self.assertIsNone(
            opening_range_for_day("NVDA", rth_bars_by_day(bars)["2026-10-09"], 15)
        )

    def test_premarket_bars_are_ignored(self) -> None:
        bars = _session("2026-10-09", 1000) + [
            _bar("2026-10-09", 9, 0, 90, 95, 89, 94, 777_777)
        ]
        rng = opening_range_for_day("NVDA", rth_bars_by_day(bars)["2026-10-09"], 5)
        assert rng is not None
        self.assertEqual(rng.volume, 1000.0)

    def test_range_not_available_before_window_closes(self) -> None:
        bars = _session("2026-10-09", 1000)
        early = datetime(2026, 10, 9, 9, 33, tzinfo=ET)
        late = datetime(2026, 10, 9, 9, 40, tzinfo=ET)
        self.assertIsNone(opening_range_today("NVDA", bars, 5, now=early))
        self.assertIsNotNone(opening_range_today("NVDA", bars, 5, now=late))


class TestInPlayMetrics(unittest.TestCase):
    def _history(self, today_volume: int, prior_volumes: list[int]) -> list[Bar]:
        bars = _session("2026-10-09", today_volume, open_px=105.0)
        days = ["2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05"]
        for day, volume in zip(days, prior_volumes):
            bars += _session(day, volume, open_px=100.0, close_px=100.0)
        return bars

    def test_rvol_is_window_volume_over_prior_average(self) -> None:
        now = datetime(2026, 10, 9, 9, 40, tzinfo=ET)
        metrics = in_play_metrics(self._history(3000, [1000, 1000, 1000]), 5, now=now)
        self.assertEqual(metrics.rvol, 3.0)
        self.assertEqual(metrics.baseline_days, 3)

    def test_gap_uses_previous_session_last_close(self) -> None:
        now = datetime(2026, 10, 9, 9, 40, tzinfo=ET)
        metrics = in_play_metrics(self._history(3000, [1000, 1000]), 5, now=now)
        self.assertEqual(metrics.gap_pct, 5.0)

    def test_needs_two_prior_days(self) -> None:
        now = datetime(2026, 10, 9, 9, 40, tzinfo=ET)
        metrics = in_play_metrics(self._history(3000, [1000]), 5, now=now)
        self.assertIsNone(metrics.rvol)


class TestOrbSignal(unittest.TestCase):
    def setUp(self) -> None:
        bars = _session("2026-10-09", 1000)
        self.range = opening_range_for_day("NVDA", rth_bars_by_day(bars)["2026-10-09"], 5)
        assert self.range is not None  # high 101.0, low 99.5
        self.config = StrategyConfig()
        self.settings = _settings(in_play_min_rvol=None)

    def _eval(self, price: float, minutes: float = 10.0, metrics=None, settings=None):
        return evaluate_orb(
            price, self.range, metrics, settings or self.settings, self.config, minutes
        )

    def test_breakout_sets_stop_at_range_low_and_two_to_one_target(self) -> None:
        signal = self._eval(101.2)
        self.assertTrue(signal.ok)
        assert signal.stop_pct is not None and signal.take_pct is not None
        self.assertAlmostEqual(signal.stop_pct, (101.2 - 99.5) / 101.2, places=6)
        self.assertAlmostEqual(signal.take_pct, signal.stop_pct * 2.0, places=6)

    def test_uses_configured_reward_risk(self) -> None:
        signal = self._eval(101.2, settings=_settings(in_play_min_rvol=None, min_reward_risk=3.0))
        assert signal.stop_pct is not None and signal.take_pct is not None
        self.assertAlmostEqual(signal.take_pct, signal.stop_pct * 3.0, places=6)

    def test_inside_range_is_no_breakout(self) -> None:
        self.assertEqual(self._eval(100.9).reason, "orb_no_breakout")

    def test_before_range_closes(self) -> None:
        self.assertEqual(self._eval(101.2, minutes=3).reason, "orb_range_not_ready")

    def test_after_cutoff(self) -> None:
        self.assertEqual(self._eval(101.2, minutes=95).reason, "orb_window_closed")

    def test_missing_range(self) -> None:
        signal = evaluate_orb(101.2, None, None, self.settings, self.config, 10.0)
        self.assertEqual(signal.reason, "orb_range_not_ready")

    def test_extended_breakout_is_skipped(self) -> None:
        # range size 1.5; price more than one range above the high
        self.assertEqual(self._eval(102.8).reason, "orb_extended")

    def test_tight_range_still_allows_a_small_move_above_the_high(self) -> None:
        tight = type(self.range)("NVDA", 100.0, 99.95, 99.97, 1000.0, 5)
        signal = evaluate_orb(100.1, tight, None, self.settings, self.config, 10.0)
        self.assertTrue(signal.ok)
        far = evaluate_orb(100.5, tight, None, self.settings, self.config, 10.0)
        self.assertEqual(far.reason, "orb_extended")

    def test_stop_is_clamped_to_strategy_bounds(self) -> None:
        wide = evaluate_orb(
            101.2,
            type(self.range)("NVDA", 101.0, 90.0, 95.0, 1000.0, 5),
            None,
            self.settings,
            self.config,
            10.0,
        )
        # a stop 11% away is clamped to max_stop_loss_pct
        self.assertTrue(wide.ok or wide.reason == "orb_extended")
        if wide.ok:
            self.assertEqual(wide.stop_pct, self.config.max_stop_loss_pct)

    def test_in_play_gate(self) -> None:
        gated = _settings(in_play_min_rvol=2.0)
        low = in_play_metrics(_session("2026-10-09", 1500) + _session("2026-10-08", 1000)
                              + _session("2026-10-07", 1000),
                              5, now=datetime(2026, 10, 9, 9, 40, tzinfo=ET))
        high = in_play_metrics(_session("2026-10-09", 3000) + _session("2026-10-08", 1000)
                               + _session("2026-10-07", 1000),
                               5, now=datetime(2026, 10, 9, 9, 40, tzinfo=ET))
        self.assertIn("not_in_play (rvol 1.5x", in_play_reason(low, gated) or "")
        self.assertIsNone(in_play_reason(high, gated))
        self.assertEqual(in_play_reason(None, gated), "not_in_play (no volume history)")
        self.assertEqual(self._eval(101.2, metrics=low, settings=gated).reason[:11], "not_in_play")
        self.assertTrue(self._eval(101.2, metrics=high, settings=gated).ok)

    def test_gap_gate_uses_absolute_gap(self) -> None:
        gated = _settings(in_play_min_rvol=None, in_play_min_gap_pct=2.0)
        metrics = in_play_metrics(
            _session("2026-10-09", 1000, open_px=95.0) + _session("2026-10-08", 1000, close_px=100.0)
            + _session("2026-10-07", 1000),
            5,
            now=datetime(2026, 10, 9, 9, 40, tzinfo=ET),
        )
        self.assertLess(metrics.gap_pct or 0, 0)
        self.assertIsNone(in_play_reason(metrics, gated))


class TestRankInPlay(unittest.TestCase):
    def test_ranks_by_rvol_and_filters_gate(self) -> None:
        from market.opening_range import InPlayMetrics

        metrics = {
            "A": InPlayMetrics(rvol=3.0, gap_pct=0.5, baseline_days=3),
            "B": InPlayMetrics(rvol=5.0, gap_pct=0.1, baseline_days=3),
            "C": InPlayMetrics(rvol=1.2, gap_pct=4.0, baseline_days=3),
            "D": InPlayMetrics(rvol=None, gap_pct=None, baseline_days=1),
        }
        ranked = rank_in_play(["A", "B", "C", "D", "E"], metrics, _settings(in_play_min_rvol=2.0))
        self.assertEqual(ranked, ["B", "A"])

    def test_gap_only_gate_ranks_by_gap_when_volume_unknown(self) -> None:
        from market.opening_range import InPlayMetrics

        metrics = {
            "A": InPlayMetrics(rvol=None, gap_pct=-3.0, baseline_days=0),
            "B": InPlayMetrics(rvol=None, gap_pct=0.2, baseline_days=0),
        }
        settings = _settings(in_play_min_rvol=None, in_play_min_gap_pct=1.0)
        self.assertEqual(rank_in_play(["A", "B"], metrics, settings), ["A"])


class TestJevVeto(unittest.TestCase):
    def test_only_sell_dominant_vetoes(self) -> None:
        now = datetime.now(timezone.utc)
        self.assertTrue(jev_vetoes(JevPrediction("X", 0.1, 0.2, 0.7, now)))
        self.assertFalse(jev_vetoes(JevPrediction("X", 0.7, 0.2, 0.1, now)))
        self.assertFalse(jev_vetoes(None))


def _trade(entry=100.0, stop=99.0, take=102.0) -> TradeRecord:
    return TradeRecord(
        id="t1", symbol="NVDA", side="buy", entry_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        entry_price=entry, quantity=10.0, position_value=entry * 10, stop_loss=stop, take_profit=take,
        status="open", paper_or_live="paper",
    )


class TestBreakeven(unittest.TestCase):
    def test_arms_after_n_r_and_exits_at_entry(self) -> None:
        trade = _trade()
        settings = _settings(breakeven_at_r=1.0)
        self.assertFalse(breakeven_armed(trade, 100.9, 1.0))
        self.assertTrue(breakeven_armed(trade, 101.0, 1.0))
        self.assertFalse(breakeven_should_exit(trade, 100.5, 100.9, settings))
        self.assertFalse(breakeven_should_exit(trade, 100.5, 101.2, settings))
        self.assertTrue(breakeven_should_exit(trade, 100.0, 101.2, settings))

    def test_exit_level_covers_round_trip_commissions(self) -> None:
        from strategy.exits import breakeven_exit_price

        trade = _trade()
        trade.entry_commission = 0.5
        # (0.5 entry + 0.35 minimum exit) / 10 shares above entry
        self.assertAlmostEqual(breakeven_exit_price(trade), 100.085, places=6)
        settings = _settings(breakeven_at_r=1.0)
        self.assertTrue(breakeven_should_exit(trade, 100.08, 101.5, settings))
        self.assertFalse(breakeven_should_exit(trade, 100.2, 101.5, settings))

    def test_off_when_unset(self) -> None:
        self.assertFalse(breakeven_should_exit(_trade(), 99.5, 105.0, _settings()))

    def test_manager_closes_simulated_trade_after_fade(self) -> None:
        manager = RiskManager(_settings(breakeven_at_r=1.0), TradingMode.PAPER, 10_000.0)
        trade = _trade()
        trade.execution_mode = "simulated"
        manager.register_open_trade(trade)
        up = {"NVDA": Quote("NVDA", 101.5, 101.4, 101.6, 0.2)}
        down = {"NVDA": Quote("NVDA", 99.9, 99.9, 100.0, 0.1)}
        self.assertEqual(manager.check_breakeven_exits(up), [])
        closed = manager.check_breakeven_exits(down)
        self.assertEqual([c.reason for c in closed], ["breakeven"])
        self.assertEqual(manager.open_trades, [])


class TestDailyCapAndRewardRisk(unittest.TestCase):
    def _manager(self, **overrides) -> RiskManager:
        return RiskManager(_settings(**overrides), TradingMode.PAPER, 10_000.0)

    def _entry(self, manager: RiskManager, **kwargs):
        from tests.test_strategy import _prediction, _state

        return manager.evaluate_entry(_state(), _prediction(), True, {}, **kwargs)

    def test_daily_cap_blocks_after_limit_and_survives_closes(self) -> None:
        manager = self._manager(max_trades_per_day=2, max_entries_per_symbol_per_day=0)
        for index in range(2):
            decision = self._entry(manager)
            self.assertTrue(decision.approved)
            assert decision.trade is not None
            decision.trade.id = f"t{index}"
            manager.register_open_trade(decision.trade)
            manager.remove_open_trade(decision.trade.id)
        blocked = self._entry(manager)
        self.assertFalse(blocked.approved)
        self.assertEqual(blocked.reason, "daily_trade_limit (2/2)")

    def test_manual_entries_are_exempt(self) -> None:
        manager = self._manager(max_trades_per_day=1, max_entries_per_symbol_per_day=0)
        manager.hydrate_symbol_entry_counts({"NVDA": 1})
        self.assertFalse(self._entry(manager).approved)
        self.assertTrue(self._entry(manager, manual=True).approved)

    def test_cap_off_by_default(self) -> None:
        manager = self._manager(max_entries_per_symbol_per_day=0)
        manager.hydrate_symbol_entry_counts({"AAA": 50})
        self.assertTrue(self._entry(manager).approved)

    def test_reward_risk_floor_raises_take_profit(self) -> None:
        manager = self._manager(min_reward_risk=2.0)
        decision = self._entry(manager)
        assert decision.trade is not None
        trade = decision.trade
        risk = trade.entry_price - trade.stop_loss
        self.assertGreaterEqual(trade.take_profit - trade.entry_price, 2.0 * risk - 1e-6)

    def test_orb_overrides_set_stop_and_take(self) -> None:
        manager = self._manager()
        decision = self._entry(manager, stop_pct_override=0.005, take_pct_override=0.01)
        assert decision.trade is not None
        trade = decision.trade
        self.assertAlmostEqual((trade.entry_price - trade.stop_loss) / trade.entry_price, 0.005, places=4)
        self.assertAlmostEqual((trade.take_profit - trade.entry_price) / trade.entry_price, 0.01, places=4)

    def test_new_trading_day_via_heartbeat_resets_entry_counts(self) -> None:
        manager = self._manager(max_trades_per_day=1, max_entries_per_symbol_per_day=1)
        manager.hydrate_symbol_entry_counts({"NVDA": 1})
        self.assertFalse(self._entry(manager).approved)
        manager._daily_pnl_trading_date = "2000-01-01"
        manager.sync_daily_realized_for_trading_day(lambda: 0.0)
        self.assertTrue(self._entry(manager).approved)

    def test_re_registering_a_counted_trade_does_not_inflate_counts(self) -> None:
        manager = self._manager()
        trade = _trade()
        manager.register_open_trade(trade, count_entry=False)
        self.assertEqual(manager.entries_today("NVDA"), 0)
        self.assertEqual(manager._total_entries_today, 0)
        self.assertEqual(len(manager.open_trades), 1)

    def test_entry_without_prediction_has_no_jev_probability(self) -> None:
        from tests.test_strategy import _state

        decision = self._manager().evaluate_entry(_state(), None, True, {})
        assert decision.trade is not None
        self.assertIsNone(decision.trade.jev_buy_probability)


class TestProcessOrbStates(unittest.TestCase):
    def _run(self, price: float, *, settings=None, vetoing=None):
        from unittest.mock import MagicMock, patch

        from models.types import ExecutionMode
        from runtime.orb_entry import process_orb_states
        from runtime.state import TraderRuntimeState
        from strategy.confirmation import ConfirmationTracker
        from tests.test_strategy import _state

        risk = settings or _settings(in_play_min_rvol=None, max_entries_per_symbol_per_day=1)
        manager = RiskManager(risk, TradingMode.PAPER, 10_000.0)
        runtime = TraderRuntimeState()
        bars = _session("2026-10-09", 1000)
        runtime.orb.ranges["NVDA"] = opening_range_for_day(
            "NVDA", rth_bars_by_day(bars)["2026-10-09"], 5
        )
        db = MagicMock()
        db.get_portfolio_snapshot = MagicMock()
        tracker = ConfirmationTracker(1, required_seconds=0)
        predictions = {"NVDA": vetoing} if vetoing else {}
        with patch("runtime.orb_entry.minutes_since_regular_open", return_value=12.0), patch(
            "runtime.orb_entry.is_entry_window_open", return_value=True
        ):
            result = process_orb_states(
                ready_states=[("NVDA", _state(price=price))],
                predictions_by_symbol=predictions,
                db=db,
                risk_manager=manager,
                risk_settings=risk,
                strategy_config=StrategyConfig(),
                quotes_by_symbol={"NVDA": Quote("NVDA", price, price - 0.02, price + 0.02, 0.04)},
                confirmation_tracker=tracker,
                bot_enabled=True,
                execution_mode=ExecutionMode.SIMULATED,
                ibkr=MagicMock(),
                settings=MagicMock(),
                active_ibkr_account_id=None,
                runtime=runtime,
            )
        return result, manager, db

    def test_breakout_opens_a_trade_without_jev(self) -> None:
        result, manager, db = self._run(101.2)
        self.assertEqual(len(manager.open_trades), 1)
        trade = manager.open_trades[0]
        self.assertIsNone(trade.jev_buy_probability)
        self.assertGreater(trade.stop_loss, 99.0)
        self.assertLess(trade.stop_loss, trade.entry_price)
        self.assertTrue(result.prediction_rows[0]["trade_created"])
        db.insert_trade.assert_called_once()

    def test_no_breakout_records_skip_reason(self) -> None:
        result, manager, db = self._run(100.5)
        self.assertEqual(manager.open_trades, [])
        self.assertEqual(result.prediction_rows[0]["trade_skip_reason"], "orb_no_breakout")
        db.insert_trade.assert_not_called()

    def test_jev_veto_blocks_when_enabled(self) -> None:
        sell = JevPrediction("NVDA", 0.1, 0.1, 0.8, datetime.now(timezone.utc))
        settings = _settings(in_play_min_rvol=None, orb_jev_veto=True)
        result, manager, _ = self._run(101.2, settings=settings, vetoing=sell)
        self.assertEqual(manager.open_trades, [])
        self.assertEqual(result.prediction_rows[0]["trade_skip_reason"], "orb_jev_veto")

    def test_second_entry_in_same_symbol_is_blocked_even_if_setting_allows_more(self) -> None:
        settings = _settings(in_play_min_rvol=None, max_entries_per_symbol_per_day=3)
        _, manager, _ = self._run(101.2, settings=settings)
        self.assertEqual(manager.entries_today("NVDA"), 1)
        manager.remove_open_trade(manager.open_trades[0].id)
        manager.hydrate_reentry_cooldowns({})
        # second pass on the same manager state is simulated via a fresh run with a prior entry
        from unittest.mock import MagicMock, patch

        from models.types import ExecutionMode
        from runtime.orb_entry import process_orb_states
        from runtime.state import TraderRuntimeState
        from strategy.confirmation import ConfirmationTracker
        from tests.test_strategy import _state

        runtime = TraderRuntimeState()
        runtime.orb.ranges["NVDA"] = opening_range_for_day(
            "NVDA", rth_bars_by_day(_session("2026-10-09", 1000))["2026-10-09"], 5
        )
        with patch("runtime.orb_entry.minutes_since_regular_open", return_value=12.0), patch(
            "runtime.orb_entry.is_entry_window_open", return_value=True
        ):
            result = process_orb_states(
                ready_states=[("NVDA", _state(price=101.2))],
                predictions_by_symbol={},
                db=MagicMock(),
                risk_manager=manager,
                risk_settings=settings,
                strategy_config=StrategyConfig(),
                quotes_by_symbol={},
                confirmation_tracker=ConfirmationTracker(1, required_seconds=0),
                bot_enabled=True,
                execution_mode=ExecutionMode.SIMULATED,
                ibkr=MagicMock(),
                settings=MagicMock(),
                active_ibkr_account_id=None,
                runtime=runtime,
            )
        self.assertEqual(result.prediction_rows[0]["trade_skip_reason"], "orb_already_traded")
        self.assertEqual(manager.open_trades, [])

    def test_daily_cap_applies_to_orb_entries(self) -> None:
        settings = _settings(in_play_min_rvol=None, max_trades_per_day=1)
        result, manager, _ = self._run(101.2, settings=settings)
        self.assertEqual(len(manager.open_trades), 1)


class TestOrbPrep(unittest.TestCase):
    NOW = datetime(2026, 10, 9, 9, 38, tzinfo=ET)

    def _history(self, symbol: str, today_volume: int) -> list[Bar]:
        bars = _session("2026-10-09", today_volume)
        for day in ("2026-10-08", "2026-10-07", "2026-10-06"):
            bars += _session(day, 1000, close_px=100.0)
        return [Bar(symbol, b.bar_size, b.ts, b.open, b.high, b.low, b.close, b.volume) for b in bars]

    def _setup(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock

        from market.bars import BarStore
        from models.types import DataSource
        from runtime.state import TraderRuntimeState

        volumes = {"AAA": 3000, "BBB": 1000, "CCC": 5000}
        ibkr = MagicMock()
        ibkr.is_connected.return_value = True
        ibkr.fetch_historical_bars.side_effect = lambda symbol, **kw: self._history(
            symbol, volumes[symbol]
        )
        repo = MagicMock()
        store = BarStore(repo)
        risk = _settings(
            entry_mode="orb",
            in_play_min_rvol=2.0,
            watchlist=[],
            watchlist_pool=["AAA", "BBB", "CCC"],
            watchlist_active=["BBB"],
            watchlist_active_size=2,
        )
        scratch = SimpleNamespace(risk_settings=risk, open_symbols=[], watchlist=["BBB"])
        settings = SimpleNamespace(data_source=DataSource.IBKR)
        return ibkr, store, repo, scratch, settings, TraderRuntimeState(), MagicMock()

    def _run(self, ibkr, store, db, scratch, settings, runtime, now=None):
        from unittest.mock import patch

        from runtime.orb_runtime import run_cycle_orb_prep

        with patch("runtime.orb_runtime.time.sleep"):
            run_cycle_orb_prep(
                db=db, settings=settings, ibkr=ibkr, bar_store=store,
                scratch=scratch, runtime=runtime, now=now or self.NOW,
            )

    def test_fetches_history_then_selects_top_in_play(self) -> None:
        ibkr, store, repo, scratch, settings, runtime, db = self._setup()
        self._run(ibkr, store, db, scratch, settings, runtime)
        self.assertEqual(ibkr.fetch_historical_bars.call_count, 2)
        self.assertFalse(runtime.orb.selected)
        self._run(ibkr, store, db, scratch, settings, runtime)
        self.assertEqual(ibkr.fetch_historical_bars.call_count, 3)
        repo.upsert_bars.assert_called()
        self.assertEqual(set(runtime.orb.history_done), {"AAA", "BBB", "CCC"})
        self.assertEqual(runtime.orb.metrics["CCC"].rvol, 5.0)
        self.assertIn("AAA", runtime.orb.ranges)
        self.assertTrue(runtime.orb.selected)
        saved = db.save_watchlist_rotation.call_args.args[0]
        self.assertEqual(saved, ["CCC", "AAA"])
        self.assertEqual(scratch.risk_settings.watchlist_active, ["CCC", "AAA"])
        self.assertEqual(scratch.watchlist, ["CCC", "AAA"])

    def test_waits_for_range_to_close(self) -> None:
        ibkr, store, _, scratch, settings, runtime, db = self._setup()
        self._run(ibkr, store, db, scratch, settings, runtime,
                  now=datetime(2026, 10, 9, 9, 34, tzinfo=ET))
        ibkr.fetch_historical_bars.assert_not_called()
        self.assertFalse(runtime.orb.selected)

    def test_noop_in_jev_mode(self) -> None:
        ibkr, store, _, scratch, settings, runtime, db = self._setup()
        scratch.risk_settings = _settings(entry_mode="jev")
        self._run(ibkr, store, db, scratch, settings, runtime)
        ibkr.fetch_historical_bars.assert_not_called()

    def test_failed_fetch_retries_then_gives_up(self) -> None:
        ibkr, store, _, scratch, settings, runtime, db = self._setup()
        ibkr.fetch_historical_bars.side_effect = lambda symbol, **kw: []
        for _ in range(6):
            self._run(ibkr, store, db, scratch, settings, runtime)
        self.assertEqual(ibkr.fetch_historical_bars.call_count, 9)
        self.assertTrue(runtime.orb.selected)
        db.save_watchlist_rotation.assert_not_called()

    def test_skips_everything_after_entry_cutoff(self) -> None:
        ibkr, store, _, scratch, settings, runtime, db = self._setup()
        self._run(ibkr, store, db, scratch, settings, runtime,
                  now=datetime(2026, 10, 9, 13, 0, tzinfo=ET))
        ibkr.fetch_historical_bars.assert_not_called()
        db.save_watchlist_rotation.assert_not_called()

    def test_failed_save_is_retried_next_cycle(self) -> None:
        ibkr, store, _, scratch, settings, runtime, db = self._setup()
        db.save_watchlist_rotation.side_effect = [RuntimeError("down"), None]
        self._run(ibkr, store, db, scratch, settings, runtime)
        self._run(ibkr, store, db, scratch, settings, runtime)
        self.assertFalse(runtime.orb.selected)
        self._run(ibkr, store, db, scratch, settings, runtime)
        self.assertTrue(runtime.orb.selected)
        self.assertEqual(db.save_watchlist_rotation.call_count, 2)

    def test_new_day_resets_state(self) -> None:
        ibkr, store, _, scratch, settings, runtime, db = self._setup()
        self._run(ibkr, store, db, scratch, settings, runtime)
        runtime.orb.reset_for("2026-10-12")
        self.assertEqual(runtime.orb.ranges, {})
        self.assertFalse(runtime.orb.selected)


if __name__ == "__main__":
    unittest.main()
