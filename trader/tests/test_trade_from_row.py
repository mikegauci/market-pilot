from __future__ import annotations

from datetime import datetime, timezone

from database.supabase import _trade_from_row


def test_trade_from_row_hydrates_commission_and_account() -> None:
    entry = datetime(2026, 1, 15, 14, 30, tzinfo=timezone.utc)
    row = {
        "id": "t-1",
        "symbol": "NU",
        "side": "buy",
        "entry_time": entry.isoformat(),
        "entry_price": 10.0,
        "quantity": 5.0,
        "position_value": 50.0,
        "stop_loss": 9.5,
        "take_profit": 10.5,
        "status": "open",
        "paper_or_live": "paper",
        "execution_mode": "ibkr",
        "commission": 1.25,
        "ibkr_account_id": "DUR217910",
    }
    trade = _trade_from_row(row)
    assert trade.entry_commission == 1.25
    assert trade.ibkr_account_id == "DUR217910"
