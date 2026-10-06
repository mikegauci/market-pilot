from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from database.supabase import SupabaseRepository
from models.types import TradeRecord, TradingMode


class InsertTradeIdempotentTests(unittest.TestCase):
    @patch("database.repository._base.create_client")
    def test_skips_insert_when_trade_id_already_exists(
        self, create_client: MagicMock
    ) -> None:
        trade_id = str(uuid.uuid4())
        client = MagicMock()
        table = MagicMock()
        client.table.return_value = table

        select_chain = MagicMock()
        table.select.return_value = select_chain
        select_chain.eq.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=[{"id": trade_id}])

        create_client.return_value = client
        repo = SupabaseRepository("https://example.supabase.co", "service-role-key")

        trade = TradeRecord(
            id=trade_id,
            symbol="AAPL",
            side="long",
            entry_time=datetime.now(timezone.utc),
            entry_price=100.0,
            quantity=10,
            position_value=1000.0,
            stop_loss=95.0,
            take_profit=110.0,
            status="open",
            paper_or_live=TradingMode.PAPER,
            jev_buy_probability=0.8,
            execution_mode="simulated",
        )

        returned = repo.insert_trade(trade)

        self.assertEqual(returned, trade_id)
        table.insert.assert_not_called()


if __name__ == "__main__":
    unittest.main()
