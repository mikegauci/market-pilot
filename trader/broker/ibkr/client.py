from __future__ import annotations

from broker.ibkr._connection import IBKRConnectionMixin
from broker.ibkr._contracts import IBKRContractsMixin
from broker.ibkr._market_data import IBKRMarketDataMixin
from broker.ibkr._orders import IBKROrdersMixin

# Re-export for tests that patch broker.ibkr.client.ibkr_synchronized
from broker.ibkr._sync import _ibkr_synchronized, ibkr_synchronized  # noqa: F401


class IBKRClient(
    IBKRConnectionMixin,
    IBKRContractsMixin,
    IBKRMarketDataMixin,
    IBKROrdersMixin,
):
    """Interactive Brokers client for quotes, account data, and order execution."""
