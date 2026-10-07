import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import {
  StrategyDiagram,
  TradeDecisionFlow,
  type StrategyDiagramType,
} from "@/components/strategy-diagrams";
import { StrategyThresholdCards } from "@/components/strategy-threshold-cards";
import {
  HARD_FILTER_RULES,
  JEV_INDICATORS,
  RISK_CAP_RULES,
  ROTATION_RULES,
  withBenchmarkSymbol,
  type StrategyIndicator,
} from "@/lib/strategy-indicators";
import type { Settings } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

function diagramVariant(
  item: StrategyIndicator,
  section: "jev" | "filter" | "risk" | "rotation",
): "default" | "blocked" | "low" | undefined {
  if (section === "filter") {
    if (item.diagram === "rsi") return "default";
    if (item.diagram === "ema") return "blocked";
    if (item.diagram === "volume") return "low";
    if (item.diagram === "emaWarmup") return "blocked";
  }
  if (section === "rotation" && item.diagram === "sessionOpen") {
    return "blocked";
  }
  return "default";
}

function IndicatorCard({
  item,
  section,
  dense = false,
  maxEntrySlots,
}: {
  item: StrategyIndicator;
  section: "jev" | "filter" | "risk" | "rotation";
  dense?: boolean;
  maxEntrySlots?: number;
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
              type={item.diagram as StrategyDiagramType}
              variant={diagramVariant(item, section)}
              maxEntrySlots={maxEntrySlots}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function IndicatorList({
  items,
  section,
  dense = false,
  maxEntrySlots,
}: {
  items: StrategyIndicator[];
  section: "jev" | "filter" | "risk" | "rotation";
  dense?: boolean;
  maxEntrySlots?: number;
}) {
  if (dense) {
    return (
      <ul className="space-y-1.5">
        {items.map((item) => (
          <IndicatorCard
            key={item.name}
            item={item}
            section={section}
            dense
            maxEntrySlots={maxEntrySlots}
          />
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <IndicatorCard
          key={item.name}
          item={item}
          section={section}
          dense={false}
          maxEntrySlots={maxEntrySlots}
        />
      ))}
    </ul>
  );
}

type StrategyGuideProps = {
  settings?: Settings | null;
  benchmarkSymbol?: string;
  minVolumeRatio?: number;
  variant?: "full" | "reference";
  embedded?: boolean;
  compact?: boolean;
};

export function StrategyGuide({
  settings,
  benchmarkSymbol,
  minVolumeRatio: _minVolumeRatio,
  variant = "full",
  embedded = false,
  compact = false,
}: StrategyGuideProps) {
  const benchmark =
    benchmarkSymbol?.trim() || settings?.benchmark_symbol?.trim() || "";
  const jevIndicators = withBenchmarkSymbol(JEV_INDICATORS, benchmark);
  const hardFilters = withBenchmarkSymbol(HARD_FILTER_RULES, benchmark);
  const riskCaps = RISK_CAP_RULES;
  const rotationRules = ROTATION_RULES;
  const dense = variant === "reference";
  const maxEntrySlots = settings?.max_entries_per_symbol_per_day ?? 3;

  if (compact) {
    return (
      <div className="border-t border-zinc-800/60 pt-3">
        <p className="text-xs text-zinc-500">Strategy</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Jev reads: {jevIndicators.map((item) => item.headline).join(" · ")}
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Then entry filters, risk caps (cooldown, daily entries), and rotation session gate when
          enabled.
        </p>
      </div>
    );
  }

  const body = (
    <>
      {!embedded ? (
        <>
          <CardTitle>How the bot decides</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Five steps from live data to a trade or a logged skip reason on Predictions.
          </p>
        </>
      ) : null}

      <div className={cn(!embedded && "mt-4", embedded && "space-y-4")}>
        {!dense && !embedded ? (
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/20 px-3 py-3">
            <TradeDecisionFlow />
          </div>
        ) : null}

        {settings && !dense ? (
          <StrategyThresholdCards settings={settings} />
        ) : null}

        <div id="jev-signals" className="scroll-mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-500/80">
            Signals Jev reads
          </p>
          <div className="mt-2">
            <IndicatorList items={jevIndicators} section="jev" dense={dense} />
          </div>
        </div>

        <div id="entry-filters" className="scroll-mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-500/80">
            Entry filters (after Jev says BUY)
          </p>
          <div className="mt-2">
            <IndicatorList items={hardFilters} section="filter" dense={dense} />
          </div>
        </div>

        <div id="risk-caps" className="scroll-mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-orange-500/80">
            Risk caps
          </p>
          <div className="mt-2">
            <IndicatorList
              items={riskCaps}
              section="risk"
              dense={dense}
              maxEntrySlots={maxEntrySlots > 0 ? maxEntrySlots : 3}
            />
          </div>
        </div>

        <div id="rotation" className="scroll-mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-sky-500/80">
            Watchlist rotation
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            {settings?.watchlist_rotation_enabled
              ? "Rotation is on — session floor and swaps apply to the active list."
              : "Turn on rotation under Settings → Watchlist to use these rules."}{" "}
            <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
              Settings
            </Link>
          </p>
          <div className="mt-2">
            <IndicatorList items={rotationRules} section="rotation" dense={dense} />
          </div>
        </div>

        {!dense ? (
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Intraday indicators use 1-minute bars aggregated from 5-minute IBKR history. EMA-20
            is ~20 minutes of 1m closes. Session % for rotation uses today&apos;s open price once
            the market is open (5-minute bars when available).
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

/** @deprecated Use StrategyGuide with settings — kept for FilterThresholds export */
export function FilterThresholds({
  benchmarkSymbol,
  minVolumeRatio,
}: {
  benchmarkSymbol?: string;
  minVolumeRatio?: number;
  settingsLink?: boolean;
}) {
  void benchmarkSymbol;
  void minVolumeRatio;
  return (
    <p className="text-xs text-zinc-500">
      Threshold cards appear when full settings are passed to StrategyGuide.
    </p>
  );
}
