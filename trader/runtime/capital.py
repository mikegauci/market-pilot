from __future__ import annotations

import logging
from typing import Optional

from broker.ibkr import IBKRClient
from models.types import AccountSummary, TradingMode
from risk.manager import RiskManager

logger = logging.getLogger(__name__)


def resolve_effective_capital(
    ibkr: IBKRClient,
    fallback: float,
    trading_mode: TradingMode,
) -> tuple[float, str]:
    account = resolve_ibkr_account_summary(ibkr)
    if account is not None:
        return account.equity_for_trading_mode(trading_mode), account.currency
    return fallback, "USD"


def resolve_ibkr_account_summary(ibkr: IBKRClient) -> Optional[AccountSummary]:
    if not ibkr.is_connected():
        return None
    try:
        return ibkr.get_account_summary()
    except Exception as exc:
        logger.warning("Could not read IBKR capital: %s", exc)
        return None


def sync_risk_manager_capital(
    risk_manager: RiskManager,
    ibkr: IBKRClient,
    fallback_capital: float,
) -> None:
    account = resolve_ibkr_account_summary(ibkr)
    if account is not None:
        equity = account.equity_for_trading_mode(risk_manager.trading_mode)
        risk_manager.update_capital(equity, account.currency)
        risk_manager.set_ibkr_buying_power(account.buying_power)
        return
    risk_manager.update_capital(fallback_capital, "USD")
    risk_manager.set_ibkr_buying_power(None)
