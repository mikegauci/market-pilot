from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from typing import Iterable, List, Optional, Sequence


@dataclass(frozen=True)
class PredProb:
    buy: float
    hold: float
    sell: float = 0.0
    forward_return: Optional[float] = None


@dataclass(frozen=True)
class MarginAuditRow:
    buy_threshold: float
    margin: float
    n_buy_at_threshold: int
    n_blocked_by_margin: int
    n_would_pass_without_margin: int
    redundancy_rate: float
    incremental_block_rate: float
    redundant: bool


def audit_margin_at_threshold(
    preds: Sequence[PredProb],
    buy_threshold: float,
    margin: float,
    *,
    redundancy_eps: float = 0.01,
) -> MarginAuditRow:
    """Measure how often BUY−HOLD margin blocks cases already at the BUY threshold.

    ``redundancy_rate`` = share of threshold-passing names that *also* fail margin
    (high => margin often co-fires with the threshold gate).
    ``incremental_block_rate`` = share of threshold-passers blocked *only* by margin
    (low ≈ margin is redundant at this threshold).
    """
    at_threshold = [p for p in preds if p.buy >= buy_threshold]
    n = len(at_threshold)
    if n == 0:
        return MarginAuditRow(
            buy_threshold=buy_threshold,
            margin=margin,
            n_buy_at_threshold=0,
            n_blocked_by_margin=0,
            n_would_pass_without_margin=0,
            redundancy_rate=0.0,
            incremental_block_rate=0.0,
            redundant=True,
        )

    blocked = [p for p in at_threshold if (p.buy - p.hold) < margin]
    n_blocked = len(blocked)
    # All blocked cases are incremental vs threshold-only eligibility.
    incremental = n_blocked / n
    # "Redundant" when margin almost never blocks anyone who already cleared BUY.
    redundant = incremental <= redundancy_eps
    return MarginAuditRow(
        buy_threshold=buy_threshold,
        margin=margin,
        n_buy_at_threshold=n,
        n_blocked_by_margin=n_blocked,
        n_would_pass_without_margin=n - n_blocked,
        redundancy_rate=n_blocked / n,
        incremental_block_rate=incremental,
        redundant=redundant,
    )


def sweep_margin_audit(
    preds: Sequence[PredProb],
    buy_thresholds: Iterable[float],
    margins: Iterable[float],
    *,
    redundancy_eps: float = 0.01,
) -> List[MarginAuditRow]:
    rows: List[MarginAuditRow] = []
    for thr in buy_thresholds:
        for margin in margins:
            rows.append(
                audit_margin_at_threshold(
                    preds, thr, margin, redundancy_eps=redundancy_eps
                )
            )
    return rows


def _default_grid() -> tuple[List[float], List[float]]:
    thresholds = [round(x * 0.05, 2) for x in range(10, 20)]  # 0.50–0.95
    margins = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25]
    return thresholds, margins


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="BUY−HOLD margin redundancy audit on logged predictions (JSONL)."
    )
    parser.add_argument(
        "--input",
        "-i",
        help="JSONL with buy/hold[/sell][/forward_return] per line. Stdin if omitted.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON rows.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    raw = open(args.input, encoding="utf-8") if args.input else sys.stdin
    try:
        preds: List[PredProb] = []
        for line in raw:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            preds.append(
                PredProb(
                    buy=float(obj["buy"]),
                    hold=float(obj["hold"]),
                    sell=float(obj.get("sell", 0.0)),
                    forward_return=(
                        float(obj["forward_return"])
                        if obj.get("forward_return") is not None
                        else None
                    ),
                )
            )
    finally:
        if args.input:
            raw.close()

    thresholds, margins = _default_grid()
    rows = sweep_margin_audit(preds, thresholds, margins)
    if args.json:
        print(json.dumps([asdict(r) for r in rows], indent=2))
    else:
        print(
            f"{'thr':>5} {'margin':>6} {'n':>5} {'blocked':>7} "
            f"{'incr%':>6} {'redundant':>10}"
        )
        for r in rows:
            if r.n_buy_at_threshold == 0:
                continue
            print(
                f"{r.buy_threshold:5.2f} {r.margin:6.2f} {r.n_buy_at_threshold:5d} "
                f"{r.n_blocked_by_margin:7d} {r.incremental_block_rate * 100:5.1f}% "
                f"{'yes' if r.redundant else 'no':>10}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
