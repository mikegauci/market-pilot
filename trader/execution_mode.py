from __future__ import annotations

from models.types import DataSource, ExecutionMode


def effective_execution_mode(
    data_source: DataSource,
    configured: ExecutionMode,
) -> ExecutionMode:
    """Resolve how orders are placed for this process.

    Production uses IBKR paper orders. Mock market data keeps simulated
    execution so local dev works without IB Gateway.
    """
    if data_source == DataSource.MOCK:
        return ExecutionMode.SIMULATED
    return configured
