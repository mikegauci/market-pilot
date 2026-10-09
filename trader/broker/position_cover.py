from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Dict, Optional

from models.types import ExecutionMode, Quote
from database.command_queue import STALE_PROCESSING_SEC

if TYPE_CHECKING:
    from broker.ibkr import IBKRClient
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)


def process_position_cover_commands(
    db: SupabaseRepository,
    ibkr: IBKRClient,
    execution_mode: ExecutionMode,
    quotes_by_symbol: Dict[str, Quote],
    *,
    fill_timeout_sec: float = 30.0,
    stale_processing_sec: float = STALE_PROCESSING_SEC,
) -> bool:
    """Execute dashboard requests to cover untracked IBKR shorts."""
    del quotes_by_symbol  # reserved for future quote logging

    reclaimed = db.reclaim_stale_position_commands(stale_processing_sec)
    if reclaimed:
        logger.info("Reclaimed %s stale position command(s)", reclaimed)

    commands = db.get_pending_position_commands()
    if not commands:
        return False

    if execution_mode != ExecutionMode.IBKR or not ibkr.is_connected():
        for command in commands:
            db.fail_position_command(str(command["id"]), "ibkr_not_connected")
        return False

    logger.info("Processing %s position cover command(s)", len(commands))
    covered_any = False

    for command in commands:
        command_id = str(command["id"])
        symbol = str(command["symbol"]).upper()
        quantity = float(command["quantity"])

        if not db.claim_position_command(command_id):
            continue

        try:
            ibkr.cover_short_position(
                symbol,
                quantity,
                fill_timeout_sec=fill_timeout_sec,
            )
            db.complete_position_command(command_id)
            covered_any = True
            logger.info("Covered short %s x %s", symbol, int(quantity))
        except RuntimeError as exc:
            db.fail_position_command(command_id, str(exc))
            logger.error("Cover short failed for %s: %s", symbol, exc)
        except Exception as exc:
            db.fail_position_command(command_id, str(exc))
            logger.error("Cover short failed for %s: %s", symbol, exc)

    return covered_any
