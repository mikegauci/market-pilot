import type { Trade } from "@/lib/types/database";

/** Watch-only momentum check logged by the trader on each prediction. Never changes trades. */
export type MomentumShadowVerdict = "would_keep" | "would_block";

export type MomentumShadowEntry = {
  verdict: MomentumShadowVerdict;
  note: string | null;
};

/** Row shape from the entry-prediction lookup (snapshot fields pulled out by PostgREST). */
export type MomentumShadowPredictionRow = {
  symbol: string;
  timestamp: string;
  momentum_shadow_verdict: string | null;
  momentum_shadow_note: string | null;
};

/** Entry prediction is logged in the same cycle as the trade; allow for clock skew. */
const MATCH_BEFORE_MS = 30_000;
const MATCH_AFTER_MS = 5_000;

export const MOMENTUM_SHADOW_TITLE = "Momentum check (watch only)";
export const MOMENTUM_SHADOW_DISCLAIMER =
  "Logged with the prediction; does not change trades.";

export function parseMomentumShadowVerdict(
  value: string | null | undefined,
): MomentumShadowVerdict | null {
  return value === "would_keep" || value === "would_block" ? value : null;
}

export function momentumShadowLabel(verdict: MomentumShadowVerdict): string {
  return verdict === "would_keep" ? "Would keep" : "Would block";
}

/** Match each trade to the prediction that opened it (same symbol, nearest time). */
export function matchTradeMomentumShadow(
  trades: Pick<Trade, "id" | "symbol" | "entry_time">[],
  rows: MomentumShadowPredictionRow[],
): Map<string, MomentumShadowEntry> {
  const bySymbol = new Map<string, MomentumShadowPredictionRow[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push(row);
    bySymbol.set(row.symbol, list);
  }

  const result = new Map<string, MomentumShadowEntry>();
  for (const trade of trades) {
    const entryMs = Date.parse(trade.entry_time);
    if (Number.isNaN(entryMs)) continue;
    let best: MomentumShadowPredictionRow | null = null;
    let bestGap = Infinity;
    for (const row of bySymbol.get(trade.symbol) ?? []) {
      const offset = Date.parse(row.timestamp) - entryMs;
      if (offset < -MATCH_BEFORE_MS || offset > MATCH_AFTER_MS) continue;
      if (Math.abs(offset) < bestGap) {
        best = row;
        bestGap = Math.abs(offset);
      }
    }
    const verdict = parseMomentumShadowVerdict(best?.momentum_shadow_verdict);
    if (best && verdict) {
      result.set(trade.id, { verdict, note: best.momentum_shadow_note });
    }
  }
  return result;
}

export type MomentumShadowGroup = { count: number; wins: number; netPnl: number };

export type MomentumShadowSummary = {
  keep: MomentumShadowGroup;
  block: MomentumShadowGroup;
};

/** Closed trades with a logged verdict, split by what the check would have done. */
export function summarizeMomentumShadow(
  trades: Pick<Trade, "id" | "status" | "net_pnl">[],
  verdicts: Map<string, MomentumShadowEntry>,
): MomentumShadowSummary | null {
  const empty = (): MomentumShadowGroup => ({ count: 0, wins: 0, netPnl: 0 });
  const summary: MomentumShadowSummary = { keep: empty(), block: empty() };
  for (const trade of trades) {
    const entry = verdicts.get(trade.id);
    if (!entry || trade.status !== "closed" || trade.net_pnl == null) continue;
    const group = entry.verdict === "would_keep" ? summary.keep : summary.block;
    group.count += 1;
    group.netPnl += trade.net_pnl;
    if (trade.net_pnl > 0) group.wins += 1;
  }
  return summary.keep.count + summary.block.count > 0 ? summary : null;
}
