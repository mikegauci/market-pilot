import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import {
  StrategyDiagram,
  TradeDecisionFlow,
} from "@/components/strategy-diagrams";
import {
  HARD_FILTER_RULES,
  JEV_INDICATORS,
  withBenchmarkSymbol,
  type StrategyIndicator,
} from "@/lib/strategy-indicators";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

type FilterThresholdsProps = {
  benchmarkSymbol?: string;
  minVolumeRatio?: number;
  settingsLink?: boolean;
};

export function FilterThresholds({
  benchmarkSymbol,
  minVolumeRatio,
  settingsLink = true,
}: FilterThresholdsProps) {
  const benchmark = benchmarkSymbol?.trim() || "off";
  const volumeRatio = minVolumeRatio ?? STRATEGY_FILTER_THRESHOLDS.minVolumeRatio;

  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/20 px-3 py-2.5">
      <p className="text-xs font-medium text-zinc-300">Active filter thresholds</p>
      <ul className="mt-2 space-y-1 text-xs text-zinc-400">
        <li>RSI max: {STRATEGY_FILTER_THRESHOLDS.maxRsi}</li>
        <li>
          Spread max: {(STRATEGY_FILTER_THRESHOLDS.maxSpreadPct * 100).toFixed(2)}%
        </li>
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
          {volumeRatio > 0 ? volumeRatio : "off"}
        </li>
      </ul>
      <p className="mt-2 text-[11px] text-zinc-600">
        RSI, spread, EMA-20, benchmark, and news thresholds use trader{" "}
        <code className="text-zinc-500">.env</code> defaults.
        {settingsLink ? (
          <>
            {" "}
            Min volume ratio can be changed in{" "}
            <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
              Settings → Exits & entry filters
            </Link>
            .
          </>
        ) : (
          " Min volume ratio is saved in Settings."
        )}
      </p>
    </div>
  );
}

function diagramVariant(
  item: StrategyIndicator,
  section: "jev" | "filter",
): "default" | "blocked" | "low" | undefined {
  if (section === "filter") {
    if (item.diagram === "rsi") return "default";
    if (item.diagram === "ema") return "blocked";
    if (item.diagram === "volume") return "low";
  }
  return "default";
}

function IndicatorCard({
  item,
  section,
  dense = false,
}: {
  item: StrategyIndicator;
  section: "jev" | "filter";
  dense?: boolean;
}) {
  if (dense) {
    return (
      <li className="leading-relaxed text-xs text-zinc-400">
        <span className="font-medium text-zinc-300">{item.name}</span>
        {" — "}
        {item.usedFor}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-zinc-800/80 bg-zinc-950/30 px-3 py-2.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-200">{item.headline}</p>
          <p className="mt-0.5 text-[11px] text-zinc-600">{item.name}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{item.plainEnglish}</p>
          <p className="mt-1 text-xs text-zinc-500">{item.usedFor}</p>
          {item.learnMoreUrl ? (
            <a
              href={item.learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-500/80 hover:text-emerald-400"
            >
              Learn more
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
        {item.diagram ? (
          <div className="shrink-0 rounded-md border border-zinc-800/60 bg-zinc-950/40 p-2">
            <StrategyDiagram
              type={item.diagram}
              variant={diagramVariant(item, section)}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function IndicatorList({
  items,
  section,
  dense = false,
}: {
  items: StrategyIndicator[];
  section: "jev" | "filter";
  dense?: boolean;
}) {
  if (dense) {
    return (
      <ul className="space-y-1.5">
        {items.map((item) => (
          <IndicatorCard key={item.name} item={item} section={section} dense />
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <IndicatorCard key={item.name} item={item} section={section} dense={false} />
      ))}
    </ul>
  );
}

type StrategyGuideProps = {
  benchmarkSymbol?: string;
  minVolumeRatio?: number;
  variant?: "full" | "reference";
  embedded?: boolean;
  compact?: boolean;
};

export function StrategyGuide({
  benchmarkSymbol,
  minVolumeRatio,
  variant = "full",
  embedded = false,
  compact = false,
}: StrategyGuideProps) {
  const jevIndicators = withBenchmarkSymbol(JEV_INDICATORS, benchmarkSymbol);
  const hardFilters = withBenchmarkSymbol(HARD_FILTER_RULES, benchmarkSymbol);
  const dense = variant === "reference";

  if (compact) {
    return (
      <div className="border-t border-zinc-800/60 pt-3">
        <p className="text-xs text-zinc-500">Strategy</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Jev reads: {jevIndicators.map((item) => item.headline).join(" · ")}
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Safety checks after BUY: RSI, EMA-20, benchmark headwind (if set), spread, news.
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
            Two layers: Jev synthesizes market context, then safety checks veto risky entries.
          </p>
        </>
      ) : null}

      <div className={cn(!embedded && "mt-4", embedded && "space-y-4")}>
        {!dense && !embedded ? (
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/20 px-3 py-3">
            <p className="text-xs font-medium text-zinc-300">How a trade is decided</p>
            <div className="mt-3">
              <TradeDecisionFlow />
            </div>
          </div>
        ) : null}

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-500/80">
            Signals Jev reads
          </p>
          <div className="mt-2">
            <IndicatorList items={jevIndicators} section="jev" dense={dense} />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-amber-500/80">
            Safety checks (after Jev says BUY)
          </p>
          <div className="mt-2">
            <IndicatorList items={hardFilters} section="filter" dense={dense} />
          </div>
        </div>

        <FilterThresholds
          benchmarkSymbol={benchmarkSymbol}
          minVolumeRatio={minVolumeRatio}
          settingsLink={!embedded}
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
