#!/usr/bin/env python3
"""Mark em_universe symbols tradable/untradable via IBKR SMART/USD qualification.

Also persists ibkr_conid / exchange / currency on success. Loads **all** rows
(including currently untradable) so blocked names can be re-enabled.

Usage:
  cd trader && python scripts/verify_em_universe.py
  cd trader && python scripts/verify_em_universe.py --dry-run
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional, Tuple

from dotenv import load_dotenv
from ib_insync import IB, Stock

TRADER_ROOT = Path(__file__).resolve().parent.parent
if str(TRADER_ROOT) not in sys.path:
    sys.path.insert(0, str(TRADER_ROOT))

from broker.symbols import to_ibkr_symbol  # noqa: E402
from config import load_settings  # noqa: E402
from database.supabase import SupabaseRepository  # noqa: E402
from watchlist.universe import load_em_universe  # noqa: E402


def qualify_symbol(ib: IB, symbol: str) -> Tuple[bool, Optional[int], Optional[str], str]:
    """Return (ok, conId, primaryExchange, currency)."""
    contract = Stock(to_ibkr_symbol(symbol), "SMART", "USD")
    qualified = ib.qualifyContracts(contract)
    if not qualified:
        return False, None, None, "USD"
    c = qualified[0]
    conid = int(c.conId) if getattr(c, "conId", None) else None
    exchange = (
        str(getattr(c, "primaryExchange", "") or getattr(c, "exchange", "") or "")
        or None
    )
    currency = str(getattr(c, "currency", "") or "USD") or "USD"
    return True, conid, exchange, currency


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
    # Include currently untradable so verify can re-enable recovered names.
    symbols = load_em_universe(
        db=db,
        path=settings.resolved_em_universe_path,
        tradable_only=False,
    )

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
            passed, conid, exchange, currency = qualify_symbol(ib, symbol)
            if passed:
                ok.append(symbol)
                print(f"  OK   {symbol} conId={conid} exch={exchange}")
                if not args.dry_run:
                    db.set_em_universe_contract(
                        symbol,
                        tradable=True,
                        ibkr_conid=conid,
                        exchange=exchange,
                        currency=currency,
                    )
            else:
                failed.append(symbol)
                print(f"  FAIL {symbol}")
                if not args.dry_run:
                    db.set_em_universe_contract(
                        symbol,
                        tradable=False,
                        ibkr_conid=None,
                        exchange=None,
                        currency="USD",
                    )
    finally:
        ib.disconnect()

    print(f"\nResult: {len(ok)} tradable, {len(failed)} untradable")
    if failed:
        print(f"Untradable: {', '.join(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
