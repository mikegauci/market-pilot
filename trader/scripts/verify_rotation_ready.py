#!/usr/bin/env python3
"""Pre-flight check for watchlist rotation + QQQ benchmark (read-only unless --write-test).

Usage:
  cd trader && .venv/bin/python scripts/verify_rotation_ready.py
  cd trader && .venv/bin/python scripts/verify_rotation_ready.py --simulate-scores
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from broker.ibkr import IBKRClient  # noqa: E402
from config import Settings, load_settings  # noqa: E402
from database.supabase import SupabaseRepository  # noqa: E402
from market.bar_aggregator import MinuteBarStore  # noqa: E402
from market.bars import BarStore  # noqa: E402
from market.hours import is_us_regular_session_open  # noqa: E402
from models.types import DataSource, Quote  # noqa: E402
from strategy.config import strategy_config_with_risk_overrides  # noqa: E402
from watchlist.resolution import effective_benchmark  # noqa: E402
from watchlist.rotation import rotate_active, score_candidate  # noqa: E402
from watchlist.rotation_runtime import build_rotation_candidate  # noqa: E402


def _print_header(title: str) -> None:
    print(f"\n=== {title} ===")


def check_config(risk) -> list[str]:
    issues: list[str] = []
    if not risk.watchlist_rotation_enabled:
        issues.append("watchlist_rotation_enabled is false")
    if not risk.watchlist_pool:
        issues.append("watchlist_pool is empty")
    if len(risk.watchlist_pool) < risk.watchlist_active_size:
        issues.append(
            f"pool has {len(risk.watchlist_pool)} symbols but active size is {risk.watchlist_active_size}"
        )
    bench = (risk.benchmark_symbol or "").strip().upper()
    if not bench:
        issues.append("benchmark_symbol is empty (headwind filter off)")
    elif bench in {s.upper() for s in risk.watchlist_pool}:
        issues.append(f"{bench} should not be in the candidate pool")
    if not risk.watchlist_active:
        print("  Note: watchlist_active is empty — first open-session cycle should seed it.")
    return issues


def simulate_scores(
    settings: Settings,
    db: SupabaseRepository,
    risk,
    ibkr: IBKRClient,
) -> None:
    from watchlist.rotation import backfill_order

    benchmark = effective_benchmark(risk)
    symbols = backfill_order(
        risk.watchlist_active,
        risk.watchlist_pool,
        benchmark,
        open_symbols=[],
    )
    bar_store = BarStore(
        db,
        daily_duration=settings.bar_daily_duration,
        intraday_duration=settings.bar_intraday_duration,
        backfill_pacing_sec=0,
    )
    minute_bars = MinuteBarStore(symbols)
    for symbol in symbols:
        bar_store.seed_minute_aggregator(minute_bars.get(symbol), symbol)

    quotes_by_symbol: dict[str, Quote] = {}
    for quote in ibkr.get_quotes(symbols):
        quotes_by_symbol[quote.symbol.upper()] = quote

    bench_agg = minute_bars.get(benchmark) if benchmark else None
    bench_5m = bench_agg.change_pct(5) if bench_agg and bench_agg.bar_count() else None
    bench_15m = bench_agg.change_pct(15) if bench_agg and bench_agg.bar_count() else None
    print(f"  Benchmark {benchmark or '—'} 5m change: {bench_5m}")

    strategy = strategy_config_with_risk_overrides(
        settings.strategy_config,
        min_volume_ratio=risk.min_volume_ratio,
        min_share_price=risk.min_share_price,
        min_dollar_volume=risk.min_dollar_volume,
        jev_sell_exit_threshold=risk.jev_sell_exit_threshold,
        confirmation_cycles=risk.confirmation_cycles,
        confirmation_seconds=risk.confirmation_seconds,
    )

    scores: dict[str, float] = {}
    for symbol in risk.watchlist_pool:
        candidate = build_rotation_candidate(
            symbol,
            quotes_by_symbol.get(symbol.upper()),
            minute_bars,
            bar_store,
        )
        scores[symbol.upper()] = score_candidate(
            candidate,
            benchmark_change_5m=bench_5m,
            benchmark_change_15m=bench_15m,
            min_volume_ratio=strategy.min_volume_ratio,
            max_rsi=strategy.max_rsi,
        )

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    print("  Top pool scores (higher = stronger rotation candidate):")
    for symbol, value in ranked[:10]:
        print(f"    {symbol:6s}  {value:+.3f}")

    result = rotate_active(
        risk.watchlist_pool,
        risk.watchlist_active,
        scores,
        active_size=risk.watchlist_active_size,
        max_swaps=risk.watchlist_max_swaps_per_rotation,
        protected=[],
    )
    print(f"  Dry-run rotation: {result.note}")
    if result.swapped_in or result.swapped_out:
        print(f"    in:  {', '.join(result.swapped_in) or '—'}")
        print(f"    out: {', '.join(result.swapped_out) or '—'}")
    print(f"    active ({len(result.active)}): {', '.join(result.active)}")


def main() -> int:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Verify watchlist rotation is ready")
    parser.add_argument(
        "--simulate-scores",
        action="store_true",
        help="Connect IBKR (alternate clientId) and dry-run rotation scores",
    )
    args = parser.parse_args()

    settings = load_settings()
    try:
        db = SupabaseRepository(settings.supabase_url, settings.supabase_service_role_key)
    except Exception as exc:
        print(f"Supabase failed: {exc}")
        return 1

    risk = db.get_risk_settings()
    status = db.get_bot_control(settings.execution_mode)
    try:
        bot_row = db.get_trader_status_snapshot()
    except Exception:
        bot_row = {}

    _print_header("Watchlist rotation config")
    print(f"  Rotation enabled: {risk.watchlist_rotation_enabled}")
    print(f"  Benchmark: {risk.benchmark_symbol or '(off)'}")
    print(f"  Pool: {len(risk.watchlist_pool)} symbols")
    print(f"  Active: {len(risk.watchlist_active)} — {', '.join(risk.watchlist_active[:8])}{'…' if len(risk.watchlist_active) > 8 else ''}")
    print(
        f"  Size / interval / max swaps: {risk.watchlist_active_size} / "
        f"{risk.watchlist_rotation_interval_minutes}m / {risk.watchlist_max_swaps_per_rotation}"
    )
    if risk.watchlist_last_rotation_note:
        print(f"  Last rotation note: {risk.watchlist_last_rotation_note}")

    issues = check_config(risk)
    if issues:
        print("  Problems:")
        for item in issues:
            print(f"    - {item}")
    else:
        print("  Config OK")

    _print_header("Trader / session")
    print(f"  US regular session open: {is_us_regular_session_open()}")
    print(f"  Bot enabled (dashboard): {status.enabled}")
    print(f"  IBKR connected (status): {bot_row.get('ibkr_connected')}")
    print(f"  Jev connected (status): {bot_row.get('jev_connected')}")
    print(f"  Last heartbeat: {bot_row.get('last_heartbeat')}")

    if not is_us_regular_session_open():
        print(
            "\n  Market is closed — Jev and rotation will not run until 9:30–16:00 ET."
        )
        print("  Re-run this script after the open, or watch the trader log.")

    if args.simulate_scores:
        if settings.data_source != DataSource.IBKR:
            print("\n  --simulate-scores requires DATA_SOURCE=ibkr in .env")
            return 1
        _print_header("Rotation score dry-run (IBKR)")
        alt_id = settings.ibkr_client_id + 9
        ibkr = IBKRClient(
            settings.ibkr_host,
            settings.ibkr_port,
            alt_id,
            account=settings.ibkr_account,
            market_data_type=settings.ibkr_market_data_type,
        )
        try:
            ibkr.connect()
        except Exception as exc:
            print(f"  IBKR connect failed: {exc}")
            return 1
        try:
            simulate_scores(settings, db, risk, ibkr)
        finally:
            ibkr.disconnect()

    _print_header("At market open — pass/fail signals")
    print("  LOGS (trader terminal):")
    print("    - Symbol lines like  NVDA  $…  (ibkr)  — Jev scanning active list")
    print("    - Watchlist rotation: … — swap or seeded active list")
    print("    - Filter: skipped Jev for … — benchmark_headwind (QQQ weak)")
    print("  SUPABASE (after ~5 min open):")
    print("    - settings.watchlist_last_rotation_at updates on first rotation")
    print("    - predictions for active symbols with market_snapshot.benchmark_change_5m")
    print("    - distinct symbol count ≈ active size (+ open positions)")

    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
