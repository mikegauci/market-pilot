import Link from "next/link";
import { StrategyDiagram } from "@/components/strategy-diagrams";
import { formatRotationSessionPct } from "@/lib/format-rotation-session";
import { entryEmaGateLabel, normalizeEntryEmaGate } from "@/lib/entry-ema-gate";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import type { Settings } from "@/lib/types/database";

type CardSource = "settings" | "env";

type Card = {
  title: string;
  value: string;
  blurb: string;
  source: CardSource;
  diagram?: Parameters<typeof StrategyDiagram>[0]["type"];
  diagramVariant?: "default" | "blocked" | "low";
  maxEntrySlots?: number;
};

function buildCards(settings: Settings, benchmark: string): Card[] {
  const volumeRatio = settings.min_volume_ratio ?? STRATEGY_FILTER_THRESHOLDS.minVolumeRatio;
  const rotation = settings.rotation_min_session_change_pct;
  const maxEntries =
    settings.max_entries_per_symbol_per_day ??
    STRATEGY_FILTER_THRESHOLDS.maxEntriesPerSymbolPerDay;

  return [
    {
      title: "RSI max",
      value: String(settings.max_rsi ?? STRATEGY_FILTER_THRESHOLDS.maxRsi),
      blurb: "Blocks overbought entries",
      source: "settings",
      diagram: "rsi",
    },
    {
      title: "Spread max",
      value: `${((settings.max_spread_pct ?? STRATEGY_FILTER_THRESHOLDS.maxSpreadPct) * 100).toFixed(2)}%`,
      blurb: "Skips wide quotes",
      source: "settings",
    },
    {
      title: "Trend (EMA)",
      value: entryEmaGateLabel(normalizeEntryEmaGate(settings.entry_ema_gate)),
      blurb: "Price above EMA gate from Settings",
      source: "settings",
      diagram: "ema",
    },
    {
      title: benchmark ? `${benchmark} 5m floor` : "Benchmark 5m",
      value: benchmark
        ? `${STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct}%`
        : "Off (no benchmark)",
      blurb: benchmark ? "Broad-market headwind gate" : "Set benchmark in Settings",
      source: "settings",
    },
    {
      title: "Min volume ratio",
      value: volumeRatio > 0 ? String(volumeRatio) : "Off",
      blurb: "Thin volume filter",
      source: "settings",
      diagram: "volume",
      diagramVariant: "low",
    },
    {
      title: "Re-entry cooldown",
      value:
        settings.reentry_cooldown_minutes > 0
          ? `${settings.reentry_cooldown_minutes} min`
          : "Off",
      blurb: "After exit, same symbol",
      source: "settings",
      diagram: "reentry",
    },
    {
      title: "Max entries / symbol / day",
      value: maxEntries > 0 ? String(maxEntries) : "Off",
      blurb: "Stops repeat stop churn",
      source: "settings",
      diagram: "maxEntries",
      maxEntrySlots: maxEntries > 0 ? maxEntries : 3,
    },
    {
      title: "Rotation session floor",
      value: formatRotationSessionPct(rotation),
      blurb: settings.watchlist_rotation_enabled
        ? "Active list session gate"
        : "Rotation off in Settings",
      source: "settings",
      diagram: "sessionOpen",
      diagramVariant: rotation != null ? "default" : undefined,
    },
  ];
}

export function StrategyThresholdCards({ settings }: { settings: Settings }) {
  const benchmark = (settings.benchmark_symbol ?? "").trim();
  const cards = buildCards(settings, benchmark);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-zinc-300">Live thresholds</p>
        <Link href="/settings" className="text-[11px] text-emerald-500/80 hover:text-emerald-400">
          Edit in Settings
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {cards.map((card) => (
          <div
            key={card.title}
            className="flex gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/30 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-medium text-zinc-300">{card.title}</p>
                <span
                  className={
                    card.source === "settings"
                      ? "rounded border border-emerald-900/40 bg-emerald-950/30 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-emerald-400/90"
                      : "rounded border border-zinc-700/80 bg-zinc-900/50 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-zinc-500"
                  }
                >
                  {card.source === "settings" ? "Settings" : "Trader .env"}
                </span>
              </div>
              <p className="mt-0.5 text-sm tabular-nums text-zinc-100">{card.value}</p>
              <p className="mt-1 text-[11px] text-zinc-500">{card.blurb}</p>
            </div>
            {card.diagram ? (
              <div className="hidden shrink-0 sm:block">
                <StrategyDiagram
                  type={card.diagram}
                  variant={card.diagramVariant}
                  maxEntrySlots={card.maxEntrySlots}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-zinc-600">
        RSI, spread, EMA requirement, and news tags still follow trader{" "}
        <code className="text-zinc-500">.env</code> defaults unless noted above.
      </p>
    </div>
  );
}
