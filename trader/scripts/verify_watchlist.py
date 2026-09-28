#!/usr/bin/env python3
"""Verify watchlist symbols qualify as US equities on IBKR (SMART/USD).

Usage:
  cd trader && python scripts/verify_watchlist.py
  cd trader && python scripts/verify_watchlist.py TSLA GOOGL AMZN
"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv
from ib_insync import IB, Stock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import load_settings  # noqa: E402
from database.supabase import SupabaseRepository  # noqa: E402


def qualify_symbols(ib: IB, symbols: list[str]) -> tuple[list[str], list[str]]:
    ok: list[str] = []
    failed: list[str] = []
    for symbol in symbols:
        contract = Stock(symbol, "SMART", "USD")
        qualified = ib.qualifyContracts(contract)
        if qualified:
            ok.append(symbol)
            print(f"  OK   {symbol} -> {qualified[0].localSymbol} ({qualified[0].primaryExchange})")
        else:
            failed.append(symbol)
            print(f"  FAIL {symbol} — could not qualify as US stock (SMART/USD)")
    return ok, failed


def resolve_watchlist() -> list[str]:
    settings = load_settings()
    try:
        db = SupabaseRepository(settings.supabase_url, settings.supabase_service_role_key)
        watchlist = db.get_settings().watchlist or settings.watchlist_symbols
    except Exception as exc:
        print(f"Supabase unavailable ({exc}) — using WATCHLIST env/default")
        watchlist = settings.watchlist_symbols
    return list(dict.fromkeys(watchlist + ["SPY"]))


def main() -> int:
    load_dotenv(ROOT / ".env")
    settings = load_settings()

    symbols = [s.strip().upper() for s in sys.argv[1:] if s.strip()]
    if not symbols:
        symbols = resolve_watchlist()

    print(f"Verifying {len(symbols)} symbol(s) on IBKR ({settings.ibkr_host}:{settings.ibkr_port})...")
    ib = IB()
    try:
        ib.connect(settings.ibkr_host, settings.ibkr_port, clientId=settings.ibkr_client_id + 9)
    except Exception as exc:
        print(f"Could not connect to IBKR: {exc}")
        print("Start IB Gateway/TWS and retry.")
        return 1

    try:
        ok, failed = qualify_symbols(ib, symbols)
    finally:
        ib.disconnect()

    print(f"\nResult: {len(ok)} qualified, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
