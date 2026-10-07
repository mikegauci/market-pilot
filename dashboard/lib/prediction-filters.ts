import {
  DEFAULT_ENTRY_EMA_GATE,
  entryEmaFilterName,
  entryEmaWarmupBars,
  normalizeEntryEmaGate,
  type EntryEmaGate,
} from "@/lib/entry-ema-gate";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import type { MarketSnapshot, Settings } from "@/lib/types/database";

export type FilterCheck = {
  name: string;
  pass: boolean | null;
  detail: string;
};

export type EvaluateOptions = {
  minVolumeRatio?: number;
  minSharePrice?: number;
  maxRsi?: number;
  maxSpreadPct?: number;
  benchmarkSymbol?: string;
  entryEmaGate?: EntryEmaGate;
};

function buildEmaFilterCheck(
  snapshot: MarketSnapshot | null | undefined,
  price: number | null,
  gate: EntryEmaGate,
): FilterCheck | null {
  const name = entryEmaFilterName(gate);
  if (!name) {
    return null;
  }
  const ema =
    gate === "ema_9" ? snapshot?.ema_9 ?? null : snapshot?.ema_20 ?? null;
  const warmupBars = entryEmaWarmupBars(gate);
  return {
    name,
    pass:
      price == null
        ? false
        : ema == null
          ? false
          : price > ema,
    detail:
      price != null && ema != null
        ? `${formatPrice(price)} vs ${formatPrice(ema)}`
        : price != null && warmupBars != null
          ? `warming up (need ~${warmupBars}×1m bars)`
          : "—",
  };
}

export function evaluateEntryFilters(
  snapshot: MarketSnapshot | null | undefined,
  options: EvaluateOptions = {},
): FilterCheck[] {
  const thresholds = STRATEGY_FILTER_THRESHOLDS;
  const minVolumeRatio = options.minVolumeRatio ?? thresholds.minVolumeRatio;
  const minSharePrice = options.minSharePrice ?? thresholds.minSharePrice;
  const maxRsi = options.maxRsi ?? thresholds.maxRsi;
  const maxSpreadPct = options.maxSpreadPct ?? thresholds.maxSpreadPct;
  const entryEmaGate = normalizeEntryEmaGate(
    options.entryEmaGate ?? DEFAULT_ENTRY_EMA_GATE,
  );
  const benchmark = (options.benchmarkSymbol ?? "").trim();
  const price = snapshot?.price ?? null;

  const spreadPct =
    snapshot?.spread != null && price != null && price > 0
      ? snapshot.spread / price
      : null;

  const benchmarkChange = benchmark
    ? (snapshot?.benchmark_change_5m ?? snapshot?.spy_change_5m ?? null)
    : null;

  const checks: FilterCheck[] = [
    {
      name: "Share price",
      pass:
        minSharePrice <= 0 || price == null ? null : price >= minSharePrice,
      detail:
        minSharePrice <= 0
          ? "off"
          : price != null
            ? `$${formatPrice(price)} / min $${formatPrice(minSharePrice)}`
            : "—",
    },
    {
      name: "RSI",
      pass: snapshot?.rsi == null ? null : snapshot.rsi <= maxRsi,
      detail:
        snapshot?.rsi != null
          ? `${snapshot.rsi.toFixed(1)} / max ${maxRsi}`
          : "—",
    },
    {
      name: "Spread",
      pass: spreadPct == null ? null : spreadPct <= maxSpreadPct,
      detail:
        spreadPct != null
          ? `${(spreadPct * 100).toFixed(3)}% / max ${(maxSpreadPct * 100).toFixed(2)}%`
          : "—",
    },
    {
      name: "Volume",
      pass:
        minVolumeRatio <= 0 || snapshot?.volume_ratio == null
          ? null
          : snapshot.volume_ratio >= minVolumeRatio,
      detail:
        minVolumeRatio <= 0
          ? "off"
          : snapshot?.volume_ratio != null
            ? `${snapshot.volume_ratio.toFixed(2)} / min ${minVolumeRatio}`
            : "—",
    },
    ...(() => {
      const emaCheck = buildEmaFilterCheck(snapshot, price, entryEmaGate);
      return emaCheck ? [emaCheck] : [];
    })(),
    ...(benchmark
      ? [
          {
            name: `${benchmark} 5m`,
            pass:
              benchmarkChange == null
                ? null
                : benchmarkChange >= thresholds.maxBenchmarkDrop5mPct,
            detail:
              benchmarkChange != null
                ? `${benchmarkChange.toFixed(2)}% / floor ${thresholds.maxBenchmarkDrop5mPct}%`
                : "—",
          } satisfies FilterCheck,
        ]
      : []),
    {
      name: "News",
      pass:
        snapshot?.news_sentiment == null
          ? null
          : snapshot.news_sentiment > thresholds.minNewsSentiment,
      detail:
        snapshot?.news_sentiment != null
          ? `${snapshot.news_sentiment.toFixed(2)} / floor ${thresholds.minNewsSentiment}`
          : "—",
    },
  ];

  if (snapshot?.news_tags?.length) {
    const blocked = snapshot.news_tags.filter((tag) =>
      (thresholds.newsBlockTags as readonly string[]).includes(tag),
    );
    checks.push({
      name: "News tags",
      pass: blocked.length === 0,
      detail: blocked.length > 0 ? blocked.join(", ") : "clear",
    });
  }

  return checks;
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

export function filterSummaryFromSettings(settings: Settings | null | undefined): EvaluateOptions {
  return {
    minVolumeRatio: settings?.min_volume_ratio ?? STRATEGY_FILTER_THRESHOLDS.minVolumeRatio,
    minSharePrice: settings?.min_share_price ?? STRATEGY_FILTER_THRESHOLDS.minSharePrice,
    maxRsi: settings?.max_rsi ?? STRATEGY_FILTER_THRESHOLDS.maxRsi,
    maxSpreadPct: settings?.max_spread_pct ?? STRATEGY_FILTER_THRESHOLDS.maxSpreadPct,
    benchmarkSymbol: settings?.benchmark_symbol ?? "",
    entryEmaGate: normalizeEntryEmaGate(
      settings?.entry_ema_gate ?? DEFAULT_ENTRY_EMA_GATE,
    ),
  };
}
