import { formatSkipReason } from "@/lib/prediction-skip-reason";
import type { Prediction } from "@/lib/types/database";

function percentPoints(decimal: number): number {
  return Math.round(decimal * 1000) / 10;
}

export type SymbolDayExplainPacket = {
  note: string;
  symbol: string;
  session_start: string;
  totals: {
    predictions: number;
    trades_opened: number;
    skipped: number;
  };
  skip_reason_counts: { reason: string; label: string; count: number }[];
  near_miss_buy_rows: {
    timestamp: string;
    buy_pct: number;
    skip_reason: string;
    skip_label: string;
  }[];
  sample_fills: { timestamp: string; buy_pct: number }[];
};

export function buildSymbolDayExplainPacket(
  symbol: string,
  predictions: Prediction[],
  sessionStartIso: string,
  recordThreshold: number,
  minConfidence: number,
): SymbolDayExplainPacket {
  const sym = symbol.trim().toUpperCase();
  const startMs = new Date(sessionStartIso).getTime();
  const rows = predictions.filter(
    (row) =>
      row.symbol.toUpperCase() === sym &&
      new Date(row.timestamp).getTime() >= startMs,
  );

  const skipCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.trade_created) continue;
    const reason = row.trade_skip_reason?.trim() || "unknown";
    skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
  }

  const skip_reason_counts = [...skipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({
      reason,
      label: formatSkipReason(reason) ?? reason,
      count,
    }));

  const near_miss_buy_rows = rows
    .filter((row) => {
      if (row.trade_created) return false;
      const buy = row.buy_probability;
      return buy >= recordThreshold && buy < minConfidence;
    })
    .slice(0, 6)
    .map((row) => ({
      timestamp: row.timestamp,
      buy_pct: percentPoints(row.buy_probability),
      skip_reason: row.trade_skip_reason?.trim() || "unknown",
      skip_label: formatSkipReason(row.trade_skip_reason) ?? "unknown",
    }));

  const sample_fills = rows
    .filter((row) => row.trade_created)
    .slice(0, 5)
    .map((row) => ({
      timestamp: row.timestamp,
      buy_pct: percentPoints(row.buy_probability),
    }));

  return {
    note:
      "Summarize why the bot did or did not trade this symbol today. Use only counts and rows in this packet. Percents are already in percent.",
    symbol: sym,
    session_start: sessionStartIso,
    totals: {
      predictions: rows.length,
      trades_opened: rows.filter((row) => row.trade_created).length,
      skipped: rows.filter((row) => !row.trade_created && row.trade_skip_reason).length,
    },
    skip_reason_counts,
    near_miss_buy_rows,
    sample_fills,
  };
}
