from __future__ import annotations

from typing import List, Sequence

from models.types import RiskSettings


def effective_benchmark(risk_settings: RiskSettings) -> str:
    """Benchmark for headwind checks and Jev context (never an entry symbol). Empty = off."""
    return (risk_settings.benchmark_symbol or "").strip().upper()


def untradeable_benchmark_symbols(risk_settings: RiskSettings) -> set[str]:
    configured = str(risk_settings.benchmark_symbol or "").strip().upper()
    return {configured} if configured else set()


def entry_blocked_symbol_set(risk_settings: RiskSettings) -> set[str]:
    return {
        str(symbol).strip().upper()
        for symbol in getattr(risk_settings, "entry_blocked_symbols", ()) or ()
        if str(symbol).strip()
    }


def strip_blocked_symbols(
    symbols: Sequence[str],
    risk_settings: RiskSettings,
) -> List[str]:
    blocked = entry_blocked_symbol_set(risk_settings)
    if not blocked:
        return list(symbols)
    return [symbol for symbol in symbols if symbol.upper() not in blocked]


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
    base = strip_blocked_symbols(
        strip_benchmark_symbol(
            [str(s).upper() for s in risk_settings.watchlist if str(s).strip()],
            risk_settings,
        ),
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


def resolve_rotation_scan_watchlist(risk_settings: RiskSettings) -> List[str]:
    """Active list for Jev entry scans when rotation is on (never the full pool)."""
    blocked = entry_blocked_symbol_set(risk_settings)
    active = [
        str(symbol).strip().upper()
        for symbol in risk_settings.watchlist_active
        if str(symbol).strip() and str(symbol).strip().upper() not in blocked
    ]
    return strip_benchmark_symbol(active, risk_settings)


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
