from __future__ import annotations

import logging
from typing import Optional

from models.types import ExecutionMode

logger = logging.getLogger(__name__)


def log_trader_running(
    *,
    bot_enabled: bool,
    market_open: bool,
    ibkr_connected: bool,
    jev_connected: bool,
    execution_mode: ExecutionMode,
    open_trades: int,
    ibkr_account_id: Optional[str] = None,
    data_source: str = "ibkr",
) -> None:
    """Single-line console status for operators (startup + periodic)."""
    account_suffix = f" | account {ibkr_account_id}" if ibkr_account_id else ""
    logger.info(
        "Trader running — auto-trading %s | US market %s | %s quotes | broker %s | "
        "Jev %s | %s open position(s) | %s execution%s",
        "ON" if bot_enabled else "off",
        "open" if market_open else "closed",
        data_source,
        "connected" if ibkr_connected else "offline",
        "connected" if jev_connected else "idle",
        open_trades,
        execution_mode.value,
        account_suffix,
    )
