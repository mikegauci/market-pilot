from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from market.bars import BAR_SIZE_INTRADAY, Bar
from database.supabase import SupabaseRepository


class PredictionForwardReturnsTests(unittest.TestCase):
    @patch("database.supabase.create_client")
    def test_backfills_mature_predictions_not_newest_young_rows(
        self, create_client: MagicMock
    ) -> None:
        now = datetime.now(timezone.utc)
        entry_ts = now - timedelta(minutes=20)
        bar_ts = entry_ts + timedelta(minutes=15)

        client = MagicMock()
        table = MagicMock()
        client.table.return_value = table

        select_chain = MagicMock()
        table.select.return_value = select_chain
        select_chain.is_.return_value = select_chain
        # return_15m_pct null, forward_returns_checked_at null
        select_chain.lte.return_value = select_chain
        select_chain.order.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(
            data=[
                {
                    "id": "pred-1",
                    "symbol": "NU",
                    "timestamp": entry_ts.isoformat(),
                    "price": 100.0,
                    "return_15m_pct": None,
                }
            ]
        )

        update_chain = MagicMock()
        table.update.return_value = update_chain
        update_chain.eq.return_value = update_chain
        update_chain.execute.return_value = MagicMock(data=[{}])

        create_client.return_value = client
        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")

        bars = [
            Bar(
                symbol="NU",
                bar_size=BAR_SIZE_INTRADAY,
                ts=bar_ts,
                open=100.0,
                high=101.0,
                low=99.0,
                close=101.0,
                volume=1000,
            )
        ]

        with patch.object(repo, "get_bars", return_value=bars):
            updated = repo.backfill_prediction_forward_returns(limit=10)

        self.assertEqual(updated, 1)
        select_chain.lte.assert_called()
        lte_args = select_chain.lte.call_args[0]
        self.assertEqual(lte_args[0], "timestamp")
        table.update.assert_called()
        payload = table.update.call_args[0][0]
        self.assertIsNotNone(payload.get("return_15m_pct"))

    @patch("database.supabase.create_client")
    def test_skips_when_no_bar_within_slop_of_target(
        self, create_client: MagicMock
    ) -> None:
        now = datetime.now(timezone.utc)
        entry_ts = now - timedelta(hours=6)
        session_open = entry_ts.replace(hour=13, minute=30, second=0, microsecond=0)

        client = MagicMock()
        table = MagicMock()
        client.table.return_value = table

        select_chain = MagicMock()
        table.select.return_value = select_chain
        select_chain.is_.return_value = select_chain
        # return_15m_pct null, forward_returns_checked_at null
        select_chain.lte.return_value = select_chain
        select_chain.order.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(
            data=[
                {
                    "id": "pred-early",
                    "symbol": "NU",
                    "timestamp": entry_ts.isoformat(),
                    "price": 100.0,
                    "return_15m_pct": None,
                }
            ]
        )

        create_client.return_value = client
        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")

        bars = [
            Bar(
                symbol="NU",
                bar_size=BAR_SIZE_INTRADAY,
                ts=session_open,
                open=100.0,
                high=101.0,
                low=99.0,
                close=101.0,
                volume=1000,
            )
        ]

        with patch.object(repo, "get_bars", return_value=bars):
            updated = repo.backfill_prediction_forward_returns(limit=10)

        self.assertEqual(updated, 1)
        table.update.assert_called()
        payload = table.update.call_args[0][0]
        self.assertIn("forward_returns_checked_at", payload)
        self.assertNotIn("return_15m_pct", payload)

    @patch("database.supabase.create_client")
    def test_marks_checked_when_symbol_has_no_bars(
        self, create_client: MagicMock
    ) -> None:
        now = datetime.now(timezone.utc)
        entry_ts = now - timedelta(minutes=20)

        client = MagicMock()
        table = MagicMock()
        client.table.return_value = table

        select_chain = MagicMock()
        table.select.return_value = select_chain
        select_chain.is_.return_value = select_chain
        select_chain.lte.return_value = select_chain
        select_chain.order.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(
            data=[
                {
                    "id": "pred-spy",
                    "symbol": "SPY",
                    "timestamp": entry_ts.isoformat(),
                    "price": 500.0,
                    "return_15m_pct": None,
                }
            ]
        )

        update_chain = MagicMock()
        table.update.return_value = update_chain
        update_chain.eq.return_value = update_chain
        update_chain.execute.return_value = MagicMock(data=[{}])

        create_client.return_value = client
        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")

        with patch.object(repo, "get_bars", return_value=[]):
            updated = repo.backfill_prediction_forward_returns(limit=10)

        self.assertEqual(updated, 1)
        payload = table.update.call_args[0][0]
        self.assertIn("forward_returns_checked_at", payload)


if __name__ == "__main__":
    unittest.main()
