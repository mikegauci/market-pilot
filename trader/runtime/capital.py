from __future__ import annotations

import logging

from broker.ibkr import IBKRClient

logger = logging.getLogger(__name__)


def resolve_effective_capital(
    ibkr: IBKRClient,
    fallback: float,
) -> tuple[float, str]:
    if ibkr.is_connected():
        try:
            account = ibkr.get_account_summary()
            return account.net_liquidation, account.currency
        except Exception as exc:
            logger.warning("Could not read IBKR capital: %s", exc)
    return fallback, "USD"
