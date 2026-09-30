"""Phase 3: live 1m bars, confirmation distinct_bars, kill hysteresis, gates."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from market.bar_aggregator import MinuteBar
from market.live_1m_bars import (
    BAR_1M_DURATION,
    bars_from_ib_historical,
    diff_live_vs_historical,
    drop_forming_bar,
    forward_fill_zero_volume,
    volume_units_match,
)
from models.types import Quote, RiskSettings
from strategy.confirmation import ConfirmationTracker
from strategy.data_gates import (
    EntryKillSwitch,
    JevTransportKillTracker,
    check_price_drift,
    check_quote_fresh_for_symbol,
    classify_jev_error,
    filter_news_for_jev_context,
    quote_age_sec,
)
from strategy.pre_submit import pre_submit_recheck


def _bar(ts: datetime, close: float = 10.0, volume: int = 100) -> MinuteBar:
    return MinuteBar(
        ts=ts, open=close, high=close, low=close, close=close, volume=volume
    )


class TestFormingBarDrop(unittest.TestCase):
    def test_forming_bar_drop(self) -> None:
        now = datetime(2026, 6, 15, 14, 30, 20, tzinfo=timezone.utc)
        bars = [
            _bar(datetime(2026, 6, 15, 14, 28, tzinfo=timezone.utc)),
            _bar(datetime(2026, 6, 15, 14, 29, tzinfo=timezone.utc)),
            _bar(datetime(2026, 6, 15, 14, 30, tzinfo=timezone.utc)),  # forming
        ]
        completed = drop_forming_bar(bars, now=now)
        self.assertEqual(len(completed), 2)
        self.assertEqual(completed[-1].ts.minute, 29)


class TestForwardFill(unittest.TestCase):
    def test_forward_fill(self) -> None:
        open_ts = datetime(2026, 6, 15, 13, 30, tzinfo=timezone.utc)
        close_ts = datetime(2026, 6, 15, 20, 0, tzinfo=timezone.utc)
        now = datetime(2026, 6, 15, 13, 35, tzinfo=timezone.utc)
        bars = [
            _bar(datetime(2026, 6, 15, 13, 30, tzinfo=timezone.utc), volume=50),
            _bar(datetime(2026, 6, 15, 13, 32, tzinfo=timezone.utc), volume=60),
        ]
        filled = forward_fill_zero_volume(
            bars, session_open=open_ts, session_close=close_ts, now=now
        )
        by_min = {b.ts.minute: b for b in filled}
        self.assertEqual(by_min[30].volume, 50)
        self.assertEqual(by_min[31].volume, 0)
        self.assertEqual(by_min[31].close, 10.0)
        self.assertEqual(by_min[32].volume, 60)


class TestUtcAcrossDst(unittest.TestCase):
    def test_utc_bars_across_dst(self) -> None:
        et = ZoneInfo("America/New_York")
        before = datetime(2026, 3, 8, 1, 30, tzinfo=et).astimezone(timezone.utc)
        after = datetime(2026, 3, 8, 3, 30, tzinfo=et).astimezone(timezone.utc)
        bars = [_bar(before), _bar(after)]
        completed = drop_forming_bar(
            bars, now=datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc)
        )
        for bar in completed:
            self.assertEqual(bar.ts.tzinfo, timezone.utc)
        self.assertEqual((after - before).total_seconds(), 3600.0)

    def test_bars_from_ib_epoch_formatdate2(self) -> None:
        class Row:
            def __init__(self, epoch: int, vol: int = 10) -> None:
                self.date = epoch
                self.open = self.high = self.low = self.close = 1.0
                self.volume = vol

        epoch = int(datetime(2026, 6, 15, 14, 5, tzinfo=timezone.utc).timestamp())
        bars = bars_from_ib_historical([Row(epoch)])
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0].ts.tzinfo, timezone.utc)
        self.assertEqual(bars[0].ts.minute, 5)


class TestVolumeUnits(unittest.TestCase):
    def test_seed_live_volume_units_match(self) -> None:
        ts = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
        seed = [_bar(ts, volume=1000)]
        live = [_bar(ts, volume=1100)]
        self.assertTrue(volume_units_match(seed, live))
        bad = [_bar(ts, volume=100_000)]
        self.assertFalse(volume_units_match(seed, bad))

    def test_bar_1m_duration_is_constant(self) -> None:
        self.assertEqual(BAR_1M_DURATION, "1 D")

    def test_eod_diff_live_vs_historical(self) -> None:
        ts = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
        live = [_bar(ts, close=10.0, volume=100), _bar(ts + timedelta(minutes=1), close=10.1, volume=110)]
        hist = [_bar(ts, close=10.0, volume=100), _bar(ts + timedelta(minutes=1), close=10.5, volume=200)]
        summary = diff_live_vs_historical(live, hist, now=ts + timedelta(minutes=5))
        self.assertEqual(summary["common_minutes"], 2)
        self.assertEqual(summary["mismatched_minutes"], 1)
        self.assertTrue(summary["volume_units_ok"])


class TestConfirmationDistinctBars(unittest.TestCase):
    def test_counts_once_per_completed_bar(self) -> None:
        tracker = ConfirmationTracker(2, mode="distinct_bars")
        t1 = datetime(2026, 6, 15, 14, 1, tzinfo=timezone.utc)
        t2 = datetime(2026, 6, 15, 14, 2, tzinfo=timezone.utc)
        self.assertFalse(tracker.record("AAPL", True, completed_bar_ts=t1))
        self.assertFalse(tracker.record("AAPL", True, completed_bar_ts=t1))
        self.assertEqual(tracker.progress("AAPL"), (1, 2))
        self.assertFalse(tracker.record("AAPL", True, completed_bar_ts=None))
        self.assertTrue(tracker.record("AAPL", True, completed_bar_ts=t2))

    def test_watchlist_removal_reset(self) -> None:
        tracker = ConfirmationTracker(2, mode="distinct_bars")
        t1 = datetime(2026, 6, 15, 14, 1, tzinfo=timezone.utc)
        tracker.record("MSFT", True, completed_bar_ts=t1)
        self.assertEqual(tracker.progress("MSFT"), (1, 2))
        tracker.reset_symbols_not_in({"AAPL"})
        self.assertEqual(tracker.progress("MSFT"), (0, 2))

    def test_forward_fill_not_distinct_confirmation(self) -> None:
        tracker = ConfirmationTracker(2, mode="distinct_bars")
        t1 = datetime(2026, 6, 15, 14, 1, tzinfo=timezone.utc)
        tracker.record("AAPL", True, completed_bar_ts=t1)
        # Caller passes None for zero-volume forward-fill bars.
        self.assertFalse(tracker.record("AAPL", True, completed_bar_ts=None))
        self.assertEqual(tracker.progress("AAPL"), (1, 2))

    def test_reset_on_failed_or_missed_bar(self) -> None:
        tracker = ConfirmationTracker(2, mode="distinct_bars")
        t1 = datetime(2026, 6, 15, 14, 1, tzinfo=timezone.utc)
        tracker.record("AAPL", True, completed_bar_ts=t1)
        tracker.record("AAPL", False)
        self.assertEqual(tracker.progress("AAPL"), (0, 2))
        tracker.record("AAPL", True, completed_bar_ts=t1)
        tracker.record("AAPL", True, missed_bar=True)
        self.assertEqual(tracker.progress("AAPL"), (0, 2))


class TestKillHysteresis(unittest.TestCase):
    def test_kill_hysteresis_time_based_recovery(self) -> None:
        kill = EntryKillSwitch(active=True, reason="startup")
        now = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
        self.assertFalse(kill.observe_healthy(now, recover_sec=120))
        self.assertTrue(kill.active)
        self.assertTrue(
            kill.observe_healthy(now + timedelta(seconds=120), recover_sec=120)
        )
        self.assertFalse(kill.active)

    def test_kill_alert_min_gap(self) -> None:
        kill = EntryKillSwitch(active=True, reason="startup")
        now = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
        self.assertTrue(kill.should_alert(now, 60))
        kill.mark_alerted(now)
        self.assertFalse(kill.should_alert(now + timedelta(seconds=30), 60))
        self.assertTrue(kill.should_alert(now + timedelta(seconds=60), 60))

    def test_restart_with_kill_state(self) -> None:
        kill = EntryKillSwitch()
        self.assertTrue(kill.active)
        self.assertEqual(kill.reason, "startup")


class TestDelayedMarketData(unittest.TestCase):
    def test_delayed_market_data_quote_age(self) -> None:
        now = datetime(2026, 6, 15, 14, 0, 10, tzinfo=timezone.utc)
        received = now - timedelta(seconds=3)
        age = quote_age_sec(now=now, received_at=received, exchange_at=None)
        self.assertAlmostEqual(age or 0, 3.0, places=3)
        self.assertTrue(check_quote_fresh_for_symbol(age, 5, enforce=True).passed)
        gate2 = check_quote_fresh_for_symbol(20.0, 5, enforce=True)
        self.assertFalse(gate2.passed)
        self.assertEqual(gate2.reason, "stale_quote")


class TestFreshPriceSizing(unittest.TestCase):
    def test_fresh_price_sizing_and_drift(self) -> None:
        self.assertFalse(check_price_drift(100.0, 100.5, 0.002).passed)
        self.assertTrue(check_price_drift(100.0, 100.1, 0.002).passed)

        class FakeRisk:
            open_trades = []
            settings = RiskSettings(
                minimum_jev_confidence=0.8,
                signal_record_threshold=0.5,
                risk_per_trade=100.0,
                max_position_size=5000.0,
                max_daily_loss=500.0,
                max_open_positions=3,
                stop_loss_percentage=0.01,
                take_profit_percentage=0.02,
                max_hold_minutes=0,
                account_capital=10_000.0,
                risk_sync_equity=None,
                watchlist=["AAPL"],
            )

            def _available_cash(self) -> float:
                return 10_000.0

            def _daily_pnl(self, _quotes) -> float:
                return 0.0

        now = datetime.now(timezone.utc)
        quote = Quote(
            symbol="AAPL",
            price=100.0,
            bid=99.9,
            ask=100.05,
            spread=0.15,
            received_at=now,
        )
        result = pre_submit_recheck(
            symbol="AAPL",
            decision_price=100.0,
            fresh_quote=quote,
            risk_manager=FakeRisk(),  # type: ignore[arg-type]
            risk_settings=FakeRisk.settings,
            bot_enabled=True,
            entry_kill_active=False,
            entry_block=None,
            prediction_ts=now - timedelta(seconds=1),
            now=now,
        )
        self.assertTrue(result.ok)
        self.assertEqual(result.entry_price, 100.05)

    def test_signal_age_measured_at_submit(self) -> None:
        class FakeRisk:
            open_trades = []
            settings = RiskSettings(
                minimum_jev_confidence=0.8,
                signal_record_threshold=0.5,
                risk_per_trade=100.0,
                max_position_size=5000.0,
                max_daily_loss=500.0,
                max_open_positions=3,
                stop_loss_percentage=0.01,
                take_profit_percentage=0.02,
                max_hold_minutes=0,
                account_capital=10_000.0,
                risk_sync_equity=None,
                watchlist=["AAPL"],
                max_signal_age_sec=30,
            )

            def _available_cash(self) -> float:
                return 10_000.0

            def _daily_pnl(self, _quotes) -> float:
                return 0.0

        now = datetime.now(timezone.utc)
        quote = Quote(
            symbol="AAPL",
            price=100.0,
            bid=99.9,
            ask=100.0,
            spread=0.1,
            received_at=now,
        )
        stale = pre_submit_recheck(
            symbol="AAPL",
            decision_price=100.0,
            fresh_quote=quote,
            risk_manager=FakeRisk(),  # type: ignore[arg-type]
            risk_settings=FakeRisk.settings,
            bot_enabled=True,
            entry_kill_active=False,
            entry_block=None,
            prediction_ts=now - timedelta(seconds=90),
            now=now,
        )
        self.assertFalse(stale.ok)
        self.assertEqual(stale.reason, "stale_signal")


class TestNewsStaleDrop(unittest.TestCase):
    def test_stale_negative_vetoes_stale_positive_dropped(self) -> None:
        now = datetime(2026, 6, 15, 14, 0, tzinfo=timezone.utc)
        articles = [
            {
                "published_at": (now - timedelta(hours=5)).isoformat(),
                "fetched_at": now.isoformat(),
                "sentiment": -0.8,
                "tags": ["downgrade"],
            },
            {
                "published_at": (now - timedelta(hours=5)).isoformat(),
                "fetched_at": now.isoformat(),
                "sentiment": 0.9,
                "tags": [],
            },
            {
                "published_at": (now - timedelta(minutes=10)).isoformat(),
                "fetched_at": now.isoformat(),
                "sentiment": 0.2,
                "tags": [],
            },
        ]
        fresh, stale_neg = filter_news_for_jev_context(
            articles,
            now=now,
            max_pub_age_sec=3600,
            max_receipt_lag_sec=600,
        )
        self.assertEqual(len(fresh), 1)
        self.assertEqual(len(stale_neg), 1)


class TestJevTransportKill(unittest.TestCase):
    def test_parse_errors_do_not_count(self) -> None:
        import httpx

        req = httpx.Request("POST", "https://example.com")
        resp = httpx.Response(422, request=req)
        err = httpx.HTTPStatusError("bad", request=req, response=resp)
        self.assertEqual(classify_jev_error(err), "parse")

        tracker = JevTransportKillTracker(window_sec=60, kill_frac=0.5)
        now = datetime.now(timezone.utc)
        tracker.record(transport_failure=False, now=now)
        tracker.record(transport_failure=True, now=now)
        tracker.record(transport_failure=True, now=now)
        self.assertTrue(tracker.should_kill(now))


if __name__ == "__main__":
    unittest.main()
