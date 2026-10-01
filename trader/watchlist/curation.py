from __future__ import annotations

from typing import Dict, List, Sequence, Set

from models.types import JevRankedSymbol, RiskSettings, WatchlistPin


def resolve_watchlist_dismissed(risk_settings: RiskSettings) -> Set[str]:
    return {
        str(symbol).upper()
        for symbol in getattr(risk_settings, "watchlist_dismissed", []) or []
        if str(symbol).strip()
    }


def pin_symbols_for_scan(risk_settings: RiskSettings) -> List[str]:
    """Symbols from pins that must be scored on EM universe scans."""
    symbols: List[str] = []
    for pin in risk_settings.watchlist_pins or []:
        symbol = str(pin.symbol).upper()
        if symbol and symbol not in symbols:
            symbols.append(symbol)
    return symbols


def buy_by_symbol(rankings: Sequence[JevRankedSymbol]) -> Dict[str, float]:
    return {item.symbol.upper(): float(item.buy) for item in rankings}


def symbol_meets_watchlist_min_buy(
    symbol: str,
    rankings: Sequence[JevRankedSymbol],
    min_buy: float,
) -> bool:
    floor = max(0.0, float(min_buy))
    score = buy_by_symbol(rankings).get(symbol.upper())
    if score is None:
        return False
    return score >= floor


def locked_pin_included_in_merge(
    symbol: str,
    rankings: Sequence[JevRankedSymbol],
    min_buy: float,
) -> bool:
    """Keep locked pins without a score until the next scan ranks them."""
    floor = max(0.0, float(min_buy))
    score = buy_by_symbol(rankings).get(symbol.upper())
    if score is None:
        return True
    return score >= floor


def qualifying_locked_pin_symbols(
    risk_settings: RiskSettings,
    rankings: Sequence[JevRankedSymbol],
) -> List[str]:
    min_buy = float(getattr(risk_settings, "watchlist_min_buy", 0.6) or 0.0)
    symbols: List[str] = []
    for pin in risk_settings.watchlist_pins or []:
        if not pin.locked:
            continue
        symbol = str(pin.symbol).upper()
        if not symbol:
            continue
        if not locked_pin_included_in_merge(symbol, rankings, min_buy):
            continue
        if symbol not in symbols:
            symbols.append(symbol)
    return symbols


def unlocked_pin_symbols(risk_settings: RiskSettings) -> List[str]:
    dismissed = resolve_watchlist_dismissed(risk_settings)
    symbols: List[str] = []
    for pin in risk_settings.watchlist_pins or []:
        if pin.locked:
            continue
        symbol = str(pin.symbol).upper()
        if not symbol or symbol in dismissed:
            continue
        if symbol not in symbols:
            symbols.append(symbol)
    return symbols


def protect_demotion_symbols(risk_settings: RiskSettings) -> Set[str]:
    return {
        str(pin.symbol).upper()
        for pin in risk_settings.watchlist_pins or []
        if pin.protect_demotion and str(pin.symbol).strip()
    }


def apply_dismissed_filter(
    symbols: Sequence[str],
    risk_settings: RiskSettings,
) -> List[str]:
    dismissed = resolve_watchlist_dismissed(risk_settings)
    return [str(s).upper() for s in symbols if str(s).upper() not in dismissed]


def merge_curated_base_watchlist(
    risk_settings: RiskSettings,
    dynamic_symbols: Sequence[str],
    rankings: Sequence[JevRankedSymbol],
) -> List[str]:
    """Dynamic scan picks + manual pins (locked when qualified, unlocked always)."""
    from watchlist.jev_screener import _merge_symbol_lists, strip_benchmark_symbol

    dynamic_base = apply_dismissed_filter(dynamic_symbols, risk_settings)
    locked = qualifying_locked_pin_symbols(risk_settings, rankings)
    unlocked = unlocked_pin_symbols(risk_settings)
    return strip_benchmark_symbol(
        _merge_symbol_lists(dynamic_base, unlocked, locked),
        risk_settings,
    )


def prune_watchlist_pins_below_min_buy(
    risk_settings: RiskSettings,
    rankings: Sequence[JevRankedSymbol],
) -> List[WatchlistPin]:
    """Drop locked pins not scored on this scan or below the watchlist min BUY floor."""
    min_buy = float(getattr(risk_settings, "watchlist_min_buy", 0.6) or 0.0)
    scores = buy_by_symbol(rankings)
    pruned: List[WatchlistPin] = []
    for pin in risk_settings.watchlist_pins or []:
        symbol = str(pin.symbol).upper()
        if not symbol:
            continue
        if pin.locked:
            score = scores.get(symbol)
            if score is None or score < min_buy:
                continue
        pruned.append(
            WatchlistPin(
                symbol=symbol,
                locked=pin.locked,
                protect_demotion=pin.protect_demotion,
            )
        )
    return pruned

