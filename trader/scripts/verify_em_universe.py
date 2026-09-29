#!/usr/bin/env python3
"""Mark em_universe symbols tradable/untradable via IBKR SMART/USD qualification.

Usage:
  cd trader && python scripts/verify_em_universe.py
  cd trader && python scripts/verify_em_universe.py --dry-run
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
from ib_insync import IB, Stock

TRADER_ROOT = Path(__file__).resolve().parent.parent
if str(TRADER_ROOT) not in sys.path:
    sys.path.insert(0, str(TRADER_ROOT))

from broker.symbols import to_ibkr_symbol  # noqa: E402
from config import load_settings  # noqa: E402
from database.supabase import SupabaseRepository  # noqa: E402
from watchlist.universe import load_em_universe  # noqa: E402


def qualify_symbol(ib: IB, symbol: str) -> bool:
    contract = Stock(to_ibkr_symbol(symbol), "SMART", "USD")
    return bool(ib.qualifyContracts(contract))


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify EM universe tradability on IBKR")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print results without updating Supabase",
    )
    args = parser.parse_args()

    load_dotenv(TRADER_ROOT / ".env")
    settings = load_settings()
    db = SupabaseRepository(settings.supabase_url, settings.supabase_service_role_key)
    symbols = load_em_universe(db=db, path=settings.resolved_em_universe_path)

    print(f"Verifying {len(symbols)} EM universe symbol(s) on IBKR...")
    ib = IB()
    try:
        ib.connect(
            settings.ibkr_host,
            settings.ibkr_port,
            clientId=settings.ibkr_client_id + 11,
        )
    except Exception as exc:
        print(f"Could not connect to IBKR: {exc}")
        return 1

    ok: list[str] = []
    failed: list[str] = []
    try:
        for symbol in symbols:
            if qualify_symbol(ib, symbol):
                ok.append(symbol)
                print(f"  OK   {symbol}")
            else:
                failed.append(symbol)
                print(f"  FAIL {symbol}")
    finally:
        ib.disconnect()

    if not args.dry_run:
        for symbol in ok:
            db.set_em_universe_tradable(symbol, True)
        for symbol in failed:
            db.set_em_universe_tradable(symbol, False)

    print(f"\nResult: {len(ok)} tradable, {len(failed)} untradable")
    if failed:
        print(f"Untradable: {', '.join(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
