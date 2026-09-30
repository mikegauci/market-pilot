from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from typing import List, Optional, Sequence, Tuple

from models.types import JevPrediction, MarketState
from strategy.config import StrategyConfig
from strategy.filters import check_entry_filters
from strategy.signals import is_trade_eligible, signal_tier


@dataclass
class ReplaySample:
    buy: float
    hold: float
    sell: float
    forward_return: float
    market: Optional[MarketState] = None


@dataclass(frozen=True)
class ReplayVariant:
    name: str
    config: StrategyConfig
    confirmation_required: bool = True
    buy_hold_margin_enabled: bool = True


@dataclass(frozen=True)
class ReplayMetrics:
    name: str
    n: int
    hit_rate: Optional[float]
    mean_forward: Optional[float]
    ci_low: Optional[float]
    ci_high: Optional[float]


def _bootstrap_mean_ci(
    values: Sequence[float],
    *,
    samples: int = 1000,
    seed: int = 42,
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    if not values:
        return None, None, None
    mean = sum(values) / len(values)
    if len(values) == 1:
        return mean, mean, mean
    rng = random.Random(seed)
    n = len(values)
    means: List[float] = []
    for _ in range(samples):
        total = sum(values[rng.randrange(n)] for _ in range(n))
        means.append(total / n)
    means.sort()
    lo = means[int(0.025 * (len(means) - 1))]
    hi = means[int(0.975 * (len(means) - 1))]
    return mean, lo, hi


def _passes_signal(
    sample: ReplaySample,
    *,
    trade_threshold: float,
    record_threshold: float,
    config: StrategyConfig,
    buy_hold_margin_enabled: bool,
) -> bool:
    pred = JevPrediction(
        symbol="X",
        buy=sample.buy,
        hold=sample.hold,
        sell=sample.sell,
        timestamp=datetime.now(timezone.utc),
    )
    tier = signal_tier(
        pred,
        record_threshold,
        trade_threshold,
        config.min_buy_hold_margin,
        buy_hold_margin_enabled=buy_hold_margin_enabled,
    )
    if not is_trade_eligible(tier):
        return False
    if sample.market is not None:
        result = check_entry_filters(sample.market, config)
        if not result.passed:
            return False
    return True


def replay_variant(
    samples: Sequence[ReplaySample],
    variant: ReplayVariant,
    *,
    trade_threshold: float = 0.85,
    record_threshold: float = 0.80,
) -> ReplayMetrics:
    accepted_returns: List[float] = []
    for sample in samples:
        if _passes_signal(
            sample,
            trade_threshold=trade_threshold,
            record_threshold=record_threshold,
            config=variant.config,
            buy_hold_margin_enabled=variant.buy_hold_margin_enabled,
        ):
            # confirmation_required is recorded for named presets; offline replay
            # treats confirmation as already met (logged signals are per-eval).
            accepted_returns.append(sample.forward_return)

    n = len(accepted_returns)
    if n == 0:
        return ReplayMetrics(variant.name, 0, None, None, None, None)
    hits = sum(1 for r in accepted_returns if r > 0) / n
    mean, lo, hi = _bootstrap_mean_ci(accepted_returns)
    return ReplayMetrics(variant.name, n, hits, mean, lo, hi)


def named_presets(base: Optional[StrategyConfig] = None) -> List[ReplayVariant]:
    cfg = base or StrategyConfig()
    return [
        ReplayVariant("baseline", cfg),
        ReplayVariant(
            "no_rsi",
            replace(cfg, rsi_veto_enabled=False),
        ),
        ReplayVariant(
            "no_margin",
            cfg,
            buy_hold_margin_enabled=False,
        ),
        ReplayVariant(
            "no_confirmation",
            cfg,
            confirmation_required=False,
        ),
        ReplayVariant(
            "no_ema20",
            replace(cfg, ema20_filter_enabled=False),
        ),
        ReplayVariant(
            "no_volume",
            replace(cfg, volume_filter_enabled=False),
        ),
    ]


def replay_all(
    samples: Sequence[ReplaySample],
    variants: Optional[Sequence[ReplayVariant]] = None,
    *,
    trade_threshold: float = 0.85,
    record_threshold: float = 0.80,
) -> List[ReplayMetrics]:
    use = list(variants) if variants is not None else named_presets()
    return [
        replay_variant(
            samples,
            v,
            trade_threshold=trade_threshold,
            record_threshold=record_threshold,
        )
        for v in use
    ]


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Offline filter replay on predictions + forward returns (JSONL)."
    )
    parser.add_argument("--input", "-i", help="JSONL input (stdin if omitted).")
    parser.add_argument("--trade-threshold", type=float, default=0.85)
    parser.add_argument("--record-threshold", type=float, default=0.80)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    raw = open(args.input, encoding="utf-8") if args.input else sys.stdin
    try:
        samples: List[ReplaySample] = []
        for line in raw:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if obj.get("forward_return") is None:
                continue
            samples.append(
                ReplaySample(
                    buy=float(obj["buy"]),
                    hold=float(obj["hold"]),
                    sell=float(obj.get("sell", 0.0)),
                    forward_return=float(obj["forward_return"]),
                )
            )
    finally:
        if args.input:
            raw.close()

    rows = replay_all(
        samples,
        trade_threshold=args.trade_threshold,
        record_threshold=args.record_threshold,
    )
    if args.json:
        print(json.dumps([asdict(r) for r in rows], indent=2))
    else:
        print(f"{'variant':<18} {'n':>5} {'hit%':>7} {'mean':>8} {'CI':>18}")
        for r in rows:
            hit = "—" if r.hit_rate is None else f"{r.hit_rate * 100:5.1f}%"
            mean = "—" if r.mean_forward is None else f"{r.mean_forward:8.4f}"
            ci = (
                "—"
                if r.ci_low is None
                else f"[{r.ci_low:.4f}, {r.ci_high:.4f}]"
            )
            print(f"{r.name:<18} {r.n:5d} {hit:>7} {mean:>8} {ci:>18}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
