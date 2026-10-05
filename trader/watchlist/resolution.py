from __future__ import annotations

from typing import List, Sequence

from models.types import RiskSettings


def effective_benchmark(risk_settings: RiskSettings) -> str:
    """Benchmark for headwind checks and Jev context (never an entry symbol). Empty = off."""
    return (risk_settings.benchmark_symbol or "").strip().upper()


def untradeable_benchmark_symbols(risk_settings: RiskSettings) -> set[str]:
    configured = str(risk_settings.benchmark_symbol or "").strip().upper()
    return {configured} if configured else set()


def strip_benchmark_symbol(
    symbols: Sequence[str],
    risk_settings: RiskSettings,
) -> List[str]:
    blocked = untradeable_benchmark_symbols(risk_settings)
    return [symbol for symbol in symbols if symbol.upper() not in blocked]


def resolve_trading_watchlist(
    risk_settings: RiskSettings,
    open_symbols: Sequence[str] = (),
) -> List[str]:
    """Configured watchlist plus open positions (benchmark excluded)."""
    base = strip_benchmark_symbol(
        [str(s).upper() for s in risk_settings.watchlist if str(s).strip()],
        risk_settings,
    )
    if not open_symbols:
        return base
    merged: List[str] = []
    for raw in list(base) + list(open_symbols):
        symbol = str(raw).upper()
        if symbol and symbol not in merged:
            merged.append(symbol)
    return strip_benchmark_symbol(merged, risk_settings)


def resolve_runtime_watchlist(
    risk_settings: RiskSettings,
    open_symbols: Sequence[str] = (),
    *,
    env_fallback: Sequence[str] = (),
) -> List[str]:
    """Runtime watchlist for the eval loop."""
    resolved = resolve_trading_watchlist(risk_settings, open_symbols)
    if resolved:
        return resolved
    fallback = [str(s).upper() for s in env_fallback if str(s).strip()]
    if not fallback:
        return []
    return strip_benchmark_symbol(fallback, risk_settings)
