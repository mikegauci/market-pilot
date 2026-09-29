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
from market.bars import BackfillSymbolResult, BarStore
from watchlist.universe import load_em_universe


def _format_progress(result: BackfillSymbolResult, index: int, total: int) -> str:
    prefix = f"[{index}/{total}] {result.symbol}"
    if result.status == "refreshed":
        return (
            f"{prefix} — refreshed "
            f"(daily={result.daily_bars}, intraday={result.intraday_bars})"
        )
    if result.status == "skipped_fresh":
        return f"{prefix} — skipped (cache fresh)"
    if result.status == "unqualified":
        return f"{prefix} — SKIP unqualified ({result.message})"
    if result.status == "no_bars":
        return f"{prefix} — no bars returned ({result.message})"
    if result.status == "disconnected":
        return f"{prefix} — SKIP ({result.message})"
    return f"{prefix} — {result.status}"


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

    print(
        f"Backfilling {len(universe)} EM symbol(s) via IBKR "
        f"({settings.ibkr_host}:{settings.ibkr_port})..."
    )

    ibkr = IBKRClient(
        host=settings.ibkr_host,
        port=settings.ibkr_port,
        client_id=settings.ibkr_client_id,
        account=settings.ibkr_account,
        market_data_type=settings.ibkr_market_data_type,
    )
    ibkr.connect()
    try:

        def _on_progress(result: BackfillSymbolResult, index: int, total: int) -> None:
            print(_format_progress(result, index, total), flush=True)
            if result.status == "unqualified":
                db.set_em_universe_tradable(result.symbol, False)

        summary = bar_store.backfill_universe(
            universe,
            ibkr,
            force=args.force,
            pacing_sec=settings.bar_backfill_pacing_sec,
            on_progress=_on_progress,
        )
    finally:
        if ibkr.is_connected():
            ibkr.ib.disconnect()

    skipped_fresh = sum(1 for item in summary.results if item.status == "skipped_fresh")
    print(
        f"\nBackfill complete — refreshed {summary.refreshed}/{summary.total}, "
        f"skipped fresh {skipped_fresh}, "
        f"unqualified {len(summary.unqualified_symbols)}, "
        f"no bars {len(summary.no_bars_symbols)}"
    )
    if summary.unqualified_symbols:
        print(f"Unqualified: {', '.join(summary.unqualified_symbols)}")
    if summary.no_bars_symbols:
        print(f"No bars: {', '.join(summary.no_bars_symbols)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
