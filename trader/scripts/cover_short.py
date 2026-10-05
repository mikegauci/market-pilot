#!/usr/bin/env python3
"""Market-buy to cover an IBKR short (uses clientId+9 so the trader can stay connected).

Usage:
  cd trader && python scripts/cover_short.py AAPL
  cd trader && python scripts/cover_short.py AAPL 14
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from broker.ibkr import IBKRClient  # noqa: E402
from config import load_settings  # noqa: E402


def main() -> int:
    load_dotenv(ROOT / ".env")
    settings = load_settings()

    parser = argparse.ArgumentParser(description="Cover a short position at IBKR")
    parser.add_argument("symbol", help="Ticker, e.g. AAPL")
    parser.add_argument(
        "quantity",
        nargs="?",
        type=float,
        help="Shares to buy (default: full short at broker)",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip confirmation prompt",
    )
    args = parser.parse_args()
    symbol = args.symbol.strip().upper()

    client = IBKRClient(
        settings.ibkr_host,
        settings.ibkr_port,
        client_id=settings.ibkr_client_id + 9,
        market_data_type=settings.ibkr_market_data_type,
    )
    try:
        client.connect(timeout=float(settings.ibkr_connect_timeout_sec))
    except Exception as exc:
        print(f"Could not connect to IBKR: {exc}")
        return 1

    try:
        short_qty = 0.0
        for position in client.get_positions():
            if position.symbol == symbol and position.quantity < 0:
                short_qty = abs(position.quantity)
                break

        if short_qty < 1:
            print(f"No short position for {symbol} at IBKR.")
            return 1

        qty = args.quantity if args.quantity is not None else short_qty
        qty = min(qty, short_qty)
        print(
            f"Cover {symbol}: market BUY {int(qty)} share(s) "
            f"(short at broker: {int(short_qty)})"
        )
        if not args.yes:
            answer = input("Proceed? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                print("Cancelled.")
                return 0

        fill = client.cover_short_position(
            symbol,
            qty,
            fill_timeout_sec=settings.ibkr_fill_timeout_sec,
        )
        print(
            f"Filled BUY {fill.quantity} @ ${fill.price:.2f} "
            f"(commission ${fill.commission:.2f})"
        )
    finally:
        client.disconnect()

    return 0


if __name__ == "__main__":
    sys.exit(main())
