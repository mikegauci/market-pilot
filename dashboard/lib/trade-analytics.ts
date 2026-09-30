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
};

const EXIT_REASON_LABELS: Record<string, string> = {
  stop_loss: "Stop loss",
  take_profit: "Take profit",
  time_exit: "Max hold",
  jev_sell: "Jev SELL",
  demotion_exit: "Demotion exit",
  eod_flatten: "EOD flatten (incl. losers)",
  manual: "Manual close",
};

export function exitReasonLabel(reason: string): string {
  if (reason in EXIT_REASON_LABELS) return EXIT_REASON_LABELS[reason];
  if (reason.startsWith("ibkr_")) return "Broker bracket";
  return reason.replaceAll("_", " ");
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

  return {
    closedCount: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    avgWin: wins.length > 0 ? grossWins / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLosses / losses.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
    avgHoldMinutes:
      holdMinutes.length > 0
        ? holdMinutes.reduce((a, b) => a + b, 0) / holdMinutes.length
        : null,
    totalPnl: pnls.reduce((sum, p) => sum + p, 0),
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
  const map = new Map<string, number>();
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    const reason = trade.exit_reason ?? "unknown";
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, label: exitReasonLabel(reason), count }))
    .sort((a, b) => b.count - a.count);
}
