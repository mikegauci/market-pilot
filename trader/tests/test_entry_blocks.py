from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from models.types import RiskSettings
from watchlist.entry_blocks import apply_expired_entry_blocks, expired_entry_blocks


def _settings(**overrides: object) -> RiskSettings:
    defaults = dict(
        minimum_jev_confidence=0.8,
        signal_record_threshold=0.5,
        risk_per_trade=1.0,
        max_position_size=100.0,
        max_daily_loss=10.0,
        max_open_positions=5,
        stop_loss_percentage=0.01,
        take_profit_percentage=0.02,
        max_hold_minutes=100.0,
        account_capital=1000.0,
        risk_sync_equity=None,
        watchlist=["NVDA"],
        watchlist_rotation_enabled=True,
        watchlist_pool=["ISRG", "NVDA", "AMD"],
        watchlist_active=["NVDA", "AMD"],
        watchlist_active_size=2,
        watchlist_rotation_interval_minutes=15,
        entry_blocked_symbols=["ISRG"],
        entry_blocked_at={
            "ISRG": (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat(),
        },
    )
    defaults.update(overrides)
    return RiskSettings(**defaults)  # type: ignore[arg-type]


class EntryBlockExpiryTests(unittest.TestCase):
    def test_expired_blocks_return_to_active(self) -> None:
        updated, expired = apply_expired_entry_blocks(_settings())
        self.assertEqual(expired, ["ISRG"])
        self.assertEqual(updated.entry_blocked_symbols, [])
        self.assertIn("ISRG", updated.watchlist_active)

    def test_recent_blocks_stay_blocked(self) -> None:
        now = datetime.now(timezone.utc)
        settings = _settings(
            entry_blocked_at={"ISRG": now.isoformat()},
        )
        self.assertEqual(expired_entry_blocks(settings, now=now), [])


if __name__ == "__main__":
    unittest.main()
