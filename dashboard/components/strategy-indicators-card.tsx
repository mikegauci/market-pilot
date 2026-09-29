import { Card, CardTitle } from "@/components/ui/card";
import {
  HARD_FILTER_RULES,
  JEV_INDICATORS,
  type StrategyIndicator,
} from "@/lib/strategy-indicators";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import { cn } from "@/lib/utils";

type Props = {
  compact?: boolean;
  variant?: "full" | "reference";
  embedded?: boolean;
  benchmarkSymbol?: string;
  minVolumeRatio?: number;
};

function withBenchmark(
  items: StrategyIndicator[],
  benchmarkSymbol?: string,
): StrategyIndicator[] {
  if (!benchmarkSymbol) return items;
  return items.map((item) =>
    item.name === "Benchmark 5m change" || item.name === "Benchmark headwind"
      ? { ...item, detail: item.detail.replace(/default EEM/g, benchmarkSymbol) }
      : item,
  );
}

function IndicatorList({
  items,
  dense = false,
}: {
  items: StrategyIndicator[];
  dense?: boolean;
}) {
  if (dense) {
    return (
      <ul className="space-y-1.5 text-xs text-zinc-400">
        {items.map((item) => (
          <li key={item.name} className="leading-relaxed">
            <span className="font-medium text-zinc-300">{item.name}</span>
            {" — "}
            {item.usedFor}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li
          key={item.name}
          className="rounded-lg border border-zinc-800/80 bg-zinc-950/30 px-3 py-2.5"
        >
          <p className="text-sm font-medium text-zinc-200">{item.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{item.detail}</p>
          <p className="mt-1 text-xs text-zinc-400">{item.usedFor}</p>
        </li>
      ))}
    </ul>
  );
}

function FilterThresholds({
  benchmarkSymbol,
  minVolumeRatio,
}: {
  benchmarkSymbol?: string;
  minVolumeRatio?: number;
}) {
  const benchmark = benchmarkSymbol ?? "EEM";
  const volumeRatio = minVolumeRatio ?? STRATEGY_FILTER_THRESHOLDS.minVolumeRatio;

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/20 px-3 py-2.5">
      <p className="text-xs font-medium text-zinc-300">Entry filter thresholds</p>
      <ul className="mt-2 space-y-1 text-xs text-zinc-400">
        <li>RSI max: {STRATEGY_FILTER_THRESHOLDS.maxRsi}</li>
        <li>Spread max: {STRATEGY_FILTER_THRESHOLDS.maxSpreadPct}%</li>
        <li>
          Price above EMA-20:{" "}
          {STRATEGY_FILTER_THRESHOLDS.requirePriceAboveEma20 ? "required" : "off"}
        </li>
        <li>
          {benchmark} 5m floor: {STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct}%
        </li>
        <li>News sentiment floor: {STRATEGY_FILTER_THRESHOLDS.minNewsSentiment}</li>
        <li>
          Min volume ratio:{" "}
          {volumeRatio > 0 ? volumeRatio : "off (set in Exits & entry filters above)"}
        </li>
      </ul>
      <p className="mt-2 text-[11px] text-zinc-600">
        RSI, spread, EMA-20, benchmark, and news thresholds use trader{" "}
        <code className="text-zinc-500">.env</code> defaults. Min volume ratio is saved in
        Settings.
      </p>
    </div>
  );
}

export function StrategyIndicatorsCard({
  compact = false,
  variant = "full",
  embedded = false,
  benchmarkSymbol,
  minVolumeRatio,
}: Props) {
  const jevIndicators = withBenchmark(JEV_INDICATORS, benchmarkSymbol);
  const hardFilters = withBenchmark(HARD_FILTER_RULES, benchmarkSymbol);
  const dense = variant === "reference";

  if (compact) {
    return (
      <div className="border-t border-zinc-800/60 pt-3">
        <p className="text-xs text-zinc-500">Indicators</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Jev: {jevIndicators.map((item) => item.name).join(" · ")}
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Hard filters after BUY: RSI, EMA-20, {benchmarkSymbol ?? "EEM"}, spread, news.
        </p>
      </div>
    );
  }

  const body = (
    <>
      {!embedded ? (
        <>
          <CardTitle>Indicators & filters</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Two layers: Jev synthesizes soft context, then deterministic hard filters veto
            entries.
          </p>
        </>
      ) : null}

      <div className={cn(!embedded && "mt-4", embedded && "space-y-4")}>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-500/80">
            Sent to Jev
          </p>
          <div className="mt-2">
            <IndicatorList items={jevIndicators} dense={dense} />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-amber-500/80">
            Hard filters (after Jev BUY)
          </p>
          <div className="mt-2">
            <IndicatorList items={hardFilters} dense={dense} />
          </div>
        </div>

        <FilterThresholds
          benchmarkSymbol={benchmarkSymbol}
          minVolumeRatio={minVolumeRatio}
        />

        {!dense ? (
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Intraday indicators use 1-minute bars aggregated from 5-minute IBKR history. Jev
            also receives bid/ask and headline context with each prediction. EMA-9 is
            Jev-only; EMA-20 is used by both Jev and the price &gt; EMA-20 gate.
          </p>
        ) : null}
      </div>
    </>
  );

  if (embedded) {
    return <div>{body}</div>;
  }

  return <Card>{body}</Card>;
}
