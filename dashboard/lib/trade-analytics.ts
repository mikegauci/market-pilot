import { portfolioRangeStartMs, type PortfolioRange } from "@/lib/portfolio-analytics";
import type { Trade } from "@/lib/types/database";

export type TradeStats = {
  closedCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  avgHoldMinutes: number | null;
  totalPnl: number;
  expectancy: number;
};

export type SymbolPnl = {
  symbol: string;
  pnl: number;
  trades: number;
};

export type ExitReasonCount = {
  reason: string;
  label: string;
  count: number;
  pnl: number;
};

export function filterTradesByRange(trades: Trade[], range: PortfolioRange): Trade[] {
  const start = portfolioRangeStartMs(range);
  if (start == null) return trades;
  return trades.filter((trade) => {
    if (trade.status !== "closed" || !trade.exit_time) return false;
    return new Date(trade.exit_time).getTime() >= start;
  });
}

const EXIT_REASON_LABELS: Record<string, string> = {
  stop_loss: "Stop loss",
  take_profit: "Top profit take",
  profit_take: "JEV soft sell / early take",
  time_exit: "Max hold",
  jev_sell: "JEV hard sell",
  demotion_exit: "Demotion exit",
  eod_flatten: "EOD flatten (incl. losers)",
  manual: "Manual close",
  unknown: "Unknown",
};

export function exitReasonLabel(reason: string): string {
  if (reason in EXIT_REASON_LABELS) return EXIT_REASON_LABELS[reason];
  if (reason.startsWith("ibkr_")) return "Broker bracket";
  return reason.replaceAll("_", " ");
}

/** Stable bucket for filters and sort (open, known exit codes, ibkr, unknown). */
export function normalizeExitReasonKey(trade: Trade): string {
  if (trade.status !== "closed") return "open";
  const reason = trade.exit_reason ?? "unknown";
  if (reason.startsWith("ibkr_")) return "ibkr";
  return reason;
}

/** Filter dropdown value (`all`, `open`, known exit buckets, or a raw normalized key). */
export type ExitReasonFilterValue = "all" | "open" | string;

export type ExitReasonFilterOption = {
  value: ExitReasonFilterValue;
  label: string;
};

/** Exit filter choices that exist in the current trade list (always includes `all`). */
export function exitReasonFilterOptions(trades: Trade[] = []): ExitReasonFilterOption[] {
  const options: ExitReasonFilterOption[] = [{ value: "all", label: "All statuses" }];

  if (trades.some((t) => t.status === "open")) {
    options.push({ value: "open", label: "Open positions" });
  }

  const closedByKey = new Map<string, string>();
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    const key = normalizeExitReasonKey(trade);
    if (!closedByKey.has(key)) {
      closedByKey.set(key, exitReasonSortLabel(trade));
    }
  }

  for (const [value, label] of [...closedByKey.entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  )) {
    options.push({ value, label });
  }

  return options;
}

/** Display label for sorting exit reasons A–Z. */
export function exitReasonSortLabel(trade: Trade): string {
  const key = normalizeExitReasonKey(trade);
  if (key === "open") return "Open positions";
  if (key === "ibkr") return exitReasonLabel("ibkr_");
  return exitReasonLabel(key);
}

export function filterTradesByExitReason(
  trades: Trade[],
  value: ExitReasonFilterValue,
): Trade[] {
  if (value === "all") return trades;
  if (value === "open") return trades.filter((t) => t.status === "open");
  return trades.filter(
    (t) => t.status === "closed" && normalizeExitReasonKey(t) === value,
  );
}

/** True when status pills and exit-reason filter cannot match any row. */
export function tradesFiltersConflict(
  statusFilter: "all" | "open" | "closed",
  exitReasonFilter: ExitReasonFilterValue,
): boolean {
  if (exitReasonFilter === "all") return false;
  if (statusFilter === "open") return exitReasonFilter !== "open";
  if (statusFilter === "closed") return exitReasonFilter === "open";
  return false;
}

export function tradesEmptyMessage(
  hasAnyTrades: boolean,
  statusFilter: "all" | "open" | "closed",
  exitReasonFilter: ExitReasonFilterValue,
): string {
  if (!hasAnyTrades) return "No trades";
  if (tradesFiltersConflict(statusFilter, exitReasonFilter)) {
    return "No trades match these filters. Reset the status or exit reason filter.";
  }
  if (statusFilter !== "all" || exitReasonFilter !== "all") {
    return "No trades match these filters.";
  }
  return "No trades";
}

export function computeTradeStats(trades: Trade[]): TradeStats {
  const closed = trades.filter((t) => t.status === "closed");
  const pnls = closed.map((t) => t.net_pnl ?? t.gross_pnl ?? 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWins = wins.reduce((sum, p) => sum + p, 0);
  const grossLosses = Math.abs(losses.reduce((sum, p) => sum + p, 0));

  const holdMinutes: number[] = [];
  for (const trade of closed) {
    if (trade.exit_time) {
      const ms =
        new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime();
      if (ms > 0) holdMinutes.push(ms / 60_000);
    }
  }

  const winRate = closed.length > 0 ? wins.length / closed.length : 0;
  const avgWin = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLosses / losses.length : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  return {
    closedCount: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
    avgHoldMinutes:
      holdMinutes.length > 0
        ? holdMinutes.reduce((a, b) => a + b, 0) / holdMinutes.length
        : null,
    totalPnl: pnls.reduce((sum, p) => sum + p, 0),
    expectancy,
  };
}

export function pnlBySymbol(trades: Trade[]): SymbolPnl[] {
  const map = new Map<string, { pnl: number; trades: number }>();
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    const pnl = trade.net_pnl ?? trade.gross_pnl ?? 0;
    const existing = map.get(trade.symbol) ?? { pnl: 0, trades: 0 };
    map.set(trade.symbol, { pnl: existing.pnl + pnl, trades: existing.trades + 1 });
  }
  return [...map.entries()]
    .map(([symbol, data]) => ({ symbol, ...data }))
    .sort((a, b) => b.pnl - a.pnl);
}

export function exitReasonBreakdown(trades: Trade[]): ExitReasonCount[] {
  const map = new Map<string, { count: number; pnl: number }>();
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    const reason = normalizeExitReasonKey(trade);
    const pnl = trade.net_pnl ?? trade.gross_pnl ?? 0;
    const existing = map.get(reason) ?? { count: 0, pnl: 0 };
    map.set(reason, { count: existing.count + 1, pnl: existing.pnl + pnl });
  }
  return [...map.entries()]
    .map(([reason, data]) => ({
      reason,
      label:
        reason === "ibkr"
          ? exitReasonLabel("ibkr_")
          : exitReasonLabel(reason),
      count: data.count,
      pnl: data.pnl,
    }))
    .sort((a, b) => b.pnl - a.pnl);
}
