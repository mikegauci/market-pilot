#!/usr/bin/env python3
"""Pre-warm Supabase symbol_bars cache for the EM universe via IBKR.

Usage:
  cd trader && python scripts/backfill_em_universe.py
  cd trader && python scripts/backfill_em_universe.py --force
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

TRADER_ROOT = Path(__file__).resolve().parent.parent
if str(TRADER_ROOT) not in sys.path:
    sys.path.insert(0, str(TRADER_ROOT))

from broker.ibkr import IBKRClient
from config import load_settings
from database.supabase import SupabaseRepository
from market.bars import BarStore
from watchlist.universe import load_em_universe


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill EM universe bars into Supabase")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Refresh bars even when cache metadata is still fresh",
    )
    args = parser.parse_args()

    settings = load_settings()
    db = SupabaseRepository(settings.supabase_url, settings.supabase_service_role_key)
    bar_store = BarStore(
        db,
        daily_duration=settings.bar_daily_duration,
        intraday_duration=settings.bar_intraday_duration,
        backfill_pacing_sec=settings.bar_backfill_pacing_sec,
    )
    universe = load_em_universe(db=db, path=settings.resolved_em_universe_path)

    ibkr = IBKRClient(
        host=settings.ibkr_host,
        port=settings.ibkr_port,
        client_id=settings.ibkr_client_id,
        account=settings.ibkr_account,
        market_data_type=settings.ibkr_market_data_type,
    )
    ibkr.connect()
    try:
        count = bar_store.backfill_universe(
            universe,
            ibkr,
            force=args.force,
            pacing_sec=settings.bar_backfill_pacing_sec,
        )
    finally:
        if ibkr.is_connected():
            ibkr.ib.disconnect()

    print(f"Backfill complete — refreshed {count}/{len(universe)} symbols")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
