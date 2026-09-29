import { Card, CardTitle } from "@/components/ui/card";
import {
  HARD_FILTER_RULES,
  JEV_INDICATORS,
  type StrategyIndicator,
} from "@/lib/strategy-indicators";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";

type Props = {
  compact?: boolean;
  benchmarkSymbol?: string;
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

function IndicatorList({ items }: { items: StrategyIndicator[] }) {
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

function FilterThresholds({ benchmarkSymbol }: { benchmarkSymbol?: string }) {
  const benchmark = benchmarkSymbol ?? "EEM";
  const { minVolumeRatio } = STRATEGY_FILTER_THRESHOLDS;

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/20 px-3 py-2.5">
      <p className="text-xs font-medium text-zinc-300">Entry filter thresholds</p>
      <ul className="mt-2 space-y-1 text-xs text-zinc-400">
        <li>RSI max: {STRATEGY_FILTER_THRESHOLDS.maxRsi}</li>
        <li>Spread max: {STRATEGY_FILTER_THRESHOLDS.maxSpreadPct}%</li>
        <li>Price above EMA-20: {STRATEGY_FILTER_THRESHOLDS.requirePriceAboveEma20 ? "required" : "off"}</li>
        <li>{benchmark} 5m floor: {STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct}%</li>
        <li>News sentiment floor: {STRATEGY_FILTER_THRESHOLDS.minNewsSentiment}</li>
        <li>
          Min volume ratio:{" "}
          {minVolumeRatio > 0 ? minVolumeRatio : "off (set STRATEGY_MIN_VOLUME_RATIO in trader .env)"}
        </li>
      </ul>
      <p className="mt-2 text-[11px] text-zinc-600">
        Configured via trader <code className="text-zinc-500">.env</code>, not Supabase settings.
      </p>
    </div>
  );
}

export function StrategyIndicatorsCard({ compact = false, benchmarkSymbol }: Props) {
  const jevIndicators = withBenchmark(JEV_INDICATORS, benchmarkSymbol);
  const hardFilters = withBenchmark(HARD_FILTER_RULES, benchmarkSymbol);

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

  return (
    <Card>
      <CardTitle>Indicators & filters</CardTitle>
      <p className="mt-1 text-xs text-zinc-500">
        Two layers: Jev synthesizes soft context, then deterministic hard filters veto entries.
      </p>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-500/80">
          Sent to Jev
        </p>
        <div className="mt-2">
          <IndicatorList items={jevIndicators} />
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-amber-500/80">
          Hard filters (after Jev BUY)
        </p>
        <div className="mt-2">
          <IndicatorList items={hardFilters} />
        </div>
      </div>

      <div className="mt-5">
        <FilterThresholds benchmarkSymbol={benchmarkSymbol} />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-zinc-600">
        Intraday indicators use 1-minute bars aggregated from 5-minute IBKR history.
        Jev also receives bid/ask and headline context with each prediction.
        EMA-9 is Jev-only; EMA-20 is used by both Jev and the price &gt; EMA-20 gate.
      </p>
    </Card>
  );
}
