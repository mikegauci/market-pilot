from __future__ import annotations


def to_ibkr_symbol(symbol: str) -> str:
    """Convert app ticker to IBKR contract symbol (e.g. BRK.B -> BRK B)."""
    return symbol.replace(".", " ")


def from_ibkr_contract(symbol: str, local_symbol: str = "") -> str:
    """Convert IBKR contract fields back to app ticker (e.g. BRK B -> BRK.B)."""
    if local_symbol and " " in local_symbol:
        return local_symbol.replace(" ", ".")
    return symbol
