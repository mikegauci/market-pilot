from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from market.bar_aggregator import MinuteBarAggregator, MinuteBarStore
from market.bars import BAR_SIZE_INTRADAY, Bar, BarStore
from market.hours import minutes_since_regular_open
from market.indicators import build_market_state
from market.minute_seed import SEED_RETRY_SEC, seed_minute_history
from models.types import Quote
from tests.test_live_bar_flush import InMemoryBarRepo

# Monday 10:30 ET (EST) — one hour into the regular session.
NOW = datetime(2026, 1, 12, 15, 30, 20, tzinfo=timezone.utc)


def _minute_bars(symbol: str, end: datetime, count: int, start_price: float = 100.0) -> list[Bar]:
    return [
        Bar(
            symbol=symbol,
            bar_size="1 min",
            ts=end - timedelta(minutes=count - index),
            open=start_price + index,
            high=start_price + index + 0.5,
            low=start_price + index - 0.5,
            close=start_price + index + (0.25 if index % 3 else -1.5),
            volume=10_000,
        )
        for index in range(count)
    ]


class FakeIbkr:
    def __init__(self, bars_by_symbol: dict[str, list[Bar]], connected: bool = True) -> None:
        self.bars_by_symbol = bars_by_symbol
        self.connected = connected
        self.calls: list[tuple[str, str, str]] = []

    def is_connected(self) -> bool:
        return self.connected

    def fetch_historical_bars(self, symbol, duration="1 W", bar_size="1 day", use_rth=True):
        self.calls.append((symbol, duration, bar_size))
        return list(self.bars_by_symbol.get(symbol, []))


def _synthetic_five_min(symbol: str) -> list[Bar]:
    prior_close = datetime(2026, 1, 9, 20, 0, tzinfo=timezone.utc)
    return [
        Bar(symbol, BAR_SIZE_INTRADAY, prior_close - timedelta(minutes=5 * (20 - i)), 50, 50, 50, 50.0, 5_000)
        for i in range(20)
    ]


class BootstrapFromMinuteBarsTests(unittest.TestCase):
    def test_replaces_placeholders_and_counts_for_price_not_volume(self) -> None:
        agg = MinuteBarAggregator()
        agg.bootstrap_from_five_min_bars(_synthetic_five_min("ADI"))
        self.assertEqual(agg.live_bar_count(), 0)

        current_minute = NOW.replace(second=0, microsecond=0)
        agg.bootstrap_from_minute_bars(_minute_bars("ADI", current_minute, 20))

        self.assertEqual(agg.bar_count(), 20)
        self.assertEqual(agg.live_bar_count(), 20)
        self.assertEqual(agg.live_closes()[-1], 119.25)
        self.assertEqual(agg.live_closes()[0], 98.5)
        self.assertEqual(agg.live_volumes(), [])
        self.assertFalse(agg.has_live_ticks())

    def test_keeps_live_ticks_and_only_adds_older_history(self) -> None:
        agg = MinuteBarAggregator()
        live_start = NOW.replace(second=0, microsecond=0) - timedelta(minutes=3)
        for offset in range(3):
            agg.record_point(live_start + timedelta(minutes=offset), 200.0 + offset, 1_000 * (offset + 1))

        agg.bootstrap_from_minute_bars(_minute_bars("ADI", live_start + timedelta(minutes=3), 20))

        bars = agg.all_bars()
        self.assertTrue(all(bar.ts < live_start for bar in bars if bar.seeded))
        self.assertEqual([bar.close for bar in bars if not bar.seeded], [200.0, 201.0, 202.0])
        self.assertEqual(agg.live_bar_count(), 17 + 3)
        self.assertEqual(agg.live_from(), live_start)

    def test_market_state_is_ready_immediately_after_seed(self) -> None:
        minute_bars = MinuteBarStore(["ADI"])
        agg = minute_bars.get("ADI")
        agg.bootstrap_from_minute_bars(_minute_bars("ADI", NOW.replace(second=0, microsecond=0), 20))
        quote = Quote(symbol="ADI", price=120.0, bid=119.95, ask=120.05, spread=0.1, volume=None)

        state = build_market_state(quote, agg, None, warmup_min_1m_bars=15)

        self.assertIsNotNone(state)
        assert state is not None
        self.assertIsNotNone(state.rsi)
        self.assertGreater(state.ema_9, 110.0)
        self.assertIsNone(state.volume_ratio)


class SeedMinuteHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.current_minute = NOW.replace(second=0, microsecond=0)
        forming = Bar("ADI", "1 min", self.current_minute, 999, 999, 999, 999.0, 1)
        self.ibkr = FakeIbkr({"ADI": [*_minute_bars("ADI", self.current_minute, 40), forming]})
        self.minute_bars = MinuteBarStore(["ADI"])
        self.attempts: dict[str, float] = {}

    def _seed(self, symbols=("ADI",), now=NOW, now_mono=1_000.0) -> list[str]:
        return seed_minute_history(
            self.ibkr,
            self.minute_bars,
            list(symbols),
            min_bars=15,
            attempts=self.attempts,
            now=now,
            now_mono=now_mono,
        )

    def test_seeds_completed_minutes_and_drops_forming_bar(self) -> None:
        self.assertEqual(self._seed(), ["ADI"])
        agg = self.minute_bars.get("ADI")
        self.assertEqual(agg.live_bar_count(), 40)
        self.assertNotIn(999.0, agg.live_closes())
        self.assertEqual(self.ibkr.calls, [("ADI", "2400 S", "1 min")])

    def test_skips_symbols_already_warm(self) -> None:
        agg = self.minute_bars.get("ADI")
        for offset in range(15):
            agg.record_point(self.current_minute - timedelta(minutes=15 - offset), 100.0, 0)
        self.assertEqual(self._seed(), [])
        self.assertEqual(self.ibkr.calls, [])

    def test_skips_first_minutes_after_open(self) -> None:
        just_after_open = datetime(2026, 1, 12, 14, 40, tzinfo=timezone.utc)  # 9:40 ET
        self.assertEqual(self._seed(now=just_after_open), [])
        self.assertEqual(self.ibkr.calls, [])

    def test_skips_outside_session_and_when_disconnected(self) -> None:
        self.assertEqual(self._seed(now=datetime(2026, 1, 12, 22, 0, tzinfo=timezone.utc)), [])
        self.ibkr.connected = False
        self.assertEqual(self._seed(), [])
        self.assertEqual(self.ibkr.calls, [])

    def test_rejects_stale_history_and_waits_before_retrying(self) -> None:
        self.ibkr.bars_by_symbol["ADI"] = _minute_bars("ADI", self.current_minute - timedelta(minutes=30), 40)
        self.assertEqual(self._seed(now_mono=1_000.0), [])
        self.assertEqual(self._seed(now_mono=1_000.0 + SEED_RETRY_SEC - 1), [])
        self.assertEqual(len(self.ibkr.calls), 1)

        self.ibkr.bars_by_symbol["ADI"] = _minute_bars("ADI", self.current_minute, 40)
        self.assertEqual(self._seed(now_mono=1_000.0 + SEED_RETRY_SEC), ["ADI"])

    def test_rejects_too_little_history(self) -> None:
        self.ibkr.bars_by_symbol["ADI"] = _minute_bars("ADI", self.current_minute, 10)
        self.assertEqual(self._seed(), [])
        self.assertEqual(self.minute_bars.get("ADI").live_bar_count(), 0)


class BarStoreSeedAndFlushTests(unittest.TestCase):
    def test_seed_minute_aggregator_refreshes_placeholder_only_history(self) -> None:
        repo = InMemoryBarRepo()
        store = BarStore(repo)
        agg = MinuteBarAggregator()
        repo.upsert_bars(_synthetic_five_min("ADI"))
        store.seed_minute_aggregator(agg, "ADI")
        self.assertEqual(agg.closes()[-1], 50.0)

        fresh = Bar("ADI", BAR_SIZE_INTRADAY, datetime(2026, 1, 12, 15, 25, tzinfo=timezone.utc), 60, 60, 60, 60.0, 5_000)
        repo.upsert_bars([fresh])
        store.invalidate_bar_cache("ADI")
        store.seed_minute_aggregator(agg, "ADI")
        self.assertEqual(agg.closes()[-1], 60.0)

    def test_flush_batches_all_symbols_into_one_upsert(self) -> None:
        repo = InMemoryBarRepo()
        calls: list[int] = []
        original = repo.upsert_bars

        def counting_upsert(bars) -> None:
            calls.append(len(list(bars)))
            original(bars)

        repo.upsert_bars = counting_upsert  # type: ignore[method-assign]
        store = BarStore(repo)
        minute_bars = MinuteBarStore(["ADI", "NFLX", "IDLE"])
        base = datetime(2026, 1, 12, 15, 0, tzinfo=timezone.utc)
        for symbol in ("ADI", "NFLX"):
            for offset in range(6):
                minute_bars.get(symbol).record_point(base + timedelta(minutes=offset), 100.0 + offset, 0)

        flushed = store.flush_live_intraday_bars(["ADI", "NFLX", "IDLE", "adi"], minute_bars)

        self.assertEqual(flushed, 2)
        self.assertEqual(len(calls), 1)
        self.assertEqual({bar.symbol for bar in repo.bars}, {"ADI", "NFLX"})


class MinutesSinceOpenTests(unittest.TestCase):
    def test_minutes_since_regular_open(self) -> None:
        self.assertAlmostEqual(minutes_since_regular_open(NOW), 60 + 20 / 60)
        self.assertLess(minutes_since_regular_open(datetime(2026, 1, 12, 13, 0, tzinfo=timezone.utc)), 0)


if __name__ == "__main__":
    unittest.main()
