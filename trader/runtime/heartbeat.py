from __future__ import annotations

import logging
import time
from typing import Dict, Optional, Tuple

from broker.ibkr import IBKRClient
from broker.reconcile import nonzero_positions
from config import Settings
from database.supabase import SupabaseRepository
from runtime.capital import sync_risk_manager_capital
from runtime.timing import should_refresh
from models.types import BotStatusUpdate, ExecutionMode, Quote, RiskSettings, TradingMode
from risk.manager import RiskManager

logger = logging.getLogger(__name__)


def run_heartbeat_cycle(
    *,
    db: SupabaseRepository,
    settings: Settings,
    ibkr: IBKRClient,
    risk_manager: Optional[RiskManager],
    risk_settings: RiskSettings,
    quotes: list[Quote],
    quotes_by_symbol: Dict[str, Quote],
    bot_enabled: bool,
    trading_mode: TradingMode,
    configured_execution_mode: ExecutionMode,
    execution_mode: ExecutionMode,
    jev_connected_this_cycle: bool,
    jev_connected: bool,
    active_ibkr_account_id: Optional[str],
    last_heartbeat: float,
    last_portfolio_history: float,
    now_mono: Optional[float] = None,
) -> Tuple[float, float, Optional[str]]:
    """Write heartbeat when due. Returns (last_heartbeat, last_portfolio_history, active_account)."""
    now = now_mono if now_mono is not None else time.monotonic()
    if (now - last_heartbeat) < settings.heartbeat_interval_sec:
        return last_heartbeat, last_portfolio_history, active_ibkr_account_id

    heartbeat_status = BotStatusUpdate(
        enabled=bot_enabled,
        trading_mode=trading_mode,
        ibkr_connected=ibkr.is_connected(),
        jev_connected=jev_connected_this_cycle or jev_connected,
        execution_mode=configured_execution_mode,
        last_error=None,
        ibkr_account_id=None,
    )
    account = None
    ibkr_positions = None
    simulated_portfolio = None
    open_trades = None

    if execution_mode == ExecutionMode.IBKR and ibkr.is_connected():
        try:
            account = ibkr.get_account_summary()
            heartbeat_status.ibkr_account_id = account.account_id
            if account.account_id != active_ibkr_account_id:
                prev = active_ibkr_account_id
                active_ibkr_account_id = account.account_id
                logger.info(
                    "Active IBKR account: %s -> %s",
                    prev or "(none)",
                    active_ibkr_account_id,
                )
                if risk_manager:
                    sync_risk_manager_capital(
                        risk_manager,
                        ibkr,
                        risk_settings.account_capital,
                    )
                    risk_manager.reload_open_trades(
                        db.get_open_trades(active_ibkr_account_id)
                    )
                    risk_manager.set_daily_realized_pnl(
                        db.get_daily_realized_pnl(active_ibkr_account_id)
                    )
            ibkr_positions = nonzero_positions(ibkr.get_positions())
        except Exception as exc:
            logger.warning("IBKR heartbeat failed: %s", exc)
            heartbeat_status.ibkr_account_id = None
    elif risk_manager:
        simulated_portfolio = risk_manager.get_portfolio_snapshot(quotes_by_symbol)
        open_trades = risk_manager.open_trades

    include_portfolio_history = should_refresh(
        now,
        last_portfolio_history,
        settings.portfolio_history_interval_sec,
    )

    db.write_heartbeat(
        heartbeat_status,
        quotes,
        account=account,
        ibkr_positions=ibkr_positions,
        simulated_portfolio=simulated_portfolio,
        open_trades=open_trades,
        include_portfolio_history=include_portfolio_history,
        include_market_snapshots=settings.market_snapshots_enabled,
    )
    if include_portfolio_history:
        last_portfolio_history = now

    heartbeat_equity = None
    if account is not None:
        heartbeat_equity = account.net_liquidation
    if heartbeat_equity is None and risk_manager is not None:
        snapshot = simulated_portfolio or risk_manager.get_portfolio_snapshot(
            quotes_by_symbol
        )
        heartbeat_equity = snapshot.equity
    if heartbeat_equity is not None and heartbeat_equity > 0:
        db.maybe_advance_risk_baseline(
            heartbeat_equity,
            threshold=settings.risk_sync_threshold_pct,
            ibkr_account_id=(
                account.account_id if account is not None else None
            ),
        )

    logger.info("Heartbeat written to Supabase")
    return now, last_portfolio_history, active_ibkr_account_id
