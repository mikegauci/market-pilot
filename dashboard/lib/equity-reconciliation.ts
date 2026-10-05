import {
  filterPortfolioByRange,
  portfolioRangeStartMs,
  type PortfolioRange,
} from "@/lib/portfolio-analytics";
import type { PortfolioSnapshot, Trade } from "@/lib/types/database";

/** IBKR AccruedCash when stored on the snapshot (interest, dividends, etc.). */
export function snapshotAccruedCash(row: PortfolioSnapshot): number | null {
  return row.ibkr_accrued_cash ?? null;
}

function accruedCashDelta(start: PortfolioSnapshot, end: PortfolioSnapshot): number | null {
  const startAccrued = snapshotAccruedCash(start);
  const endAccrued = snapshotAccruedCash(end);
  if (startAccrued == null || endAccrued == null) return null;
  return endAccrued - startAccrued;
}

function openOrOtherChange(
  equityChange: number,
  balanceChange: number,
  accruedCashChange: number | null,
): number {
  if (accruedCashChange != null) {
    return equityChange - balanceChange - accruedCashChange;
  }
  return equityChange - balanceChange;
}

export type OfflineEquityGap = {
  fromTimestamp: string;
  toTimestamp: string;
  gapHours: number;
  equityChange: number;
  accruedCashChange: number | null;
  balanceChange: number;
  closedTradePnl: number;
};

export type EquityReconciliation = {
  startTimestamp: string;
  endTimestamp: string;
  startEquity: number;
  endEquity: number;
  equityChange: number;
  closedTradePnl: number;
  accruedCashChange: number | null;
  balanceChange: number;
  /** Equity not explained by accrued + cash (usually open-position marks). */
  unexplained: number;
  offlineGaps: OfflineEquityGap[];
};

const OFFLINE_GAP_MS = 8 * 60 * 60 * 1000;

function closedTradePnlBetween(trades: Trade[], fromMs: number, toMs: number): number {
  let sum = 0;
  for (const trade of trades) {
    if (trade.status !== "closed" || !trade.exit_time) continue;
    const exitMs = new Date(trade.exit_time).getTime();
    if (exitMs < fromMs || exitMs > toMs) continue;
    sum += trade.net_pnl ?? trade.gross_pnl ?? 0;
  }
  return sum;
}

function closedTradePnlInRange(trades: Trade[], range: PortfolioRange, now = Date.now()): number {
  const start = portfolioRangeStartMs(range, now);
  let sum = 0;
  for (const trade of trades) {
    if (trade.status !== "closed" || !trade.exit_time) continue;
    const exitMs = new Date(trade.exit_time).getTime();
    if (start != null && exitMs < start) continue;
    sum += trade.net_pnl ?? trade.gross_pnl ?? 0;
  }
  return sum;
}

export function findOfflineEquityGaps(
  history: PortfolioSnapshot[],
  trades: Trade[],
  minGapMs = OFFLINE_GAP_MS,
): OfflineEquityGap[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const gaps: OfflineEquityGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const fromMs = new Date(prev.timestamp).getTime();
    const toMs = new Date(curr.timestamp).getTime();
    const gapMs = toMs - fromMs;
    if (gapMs < minGapMs) continue;
    gaps.push({
      fromTimestamp: prev.timestamp,
      toTimestamp: curr.timestamp,
      gapHours: gapMs / 3_600_000,
      equityChange: (curr.equity ?? 0) - (prev.equity ?? 0),
      accruedCashChange: accruedCashDelta(prev, curr),
      balanceChange: (curr.balance ?? 0) - (prev.balance ?? 0),
      closedTradePnl: closedTradePnlBetween(trades, fromMs, toMs),
    });
  }
  return gaps;
}

export function buildEquityReconciliation(
  history: PortfolioSnapshot[],
  trades: Trade[],
  range: PortfolioRange,
  now = Date.now(),
): EquityReconciliation | null {
  const filtered = filterPortfolioByRange(history, range);
  if (filtered.length === 0) return null;

  const sorted = [...filtered].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const start = sorted[0]!;
  const end = sorted[sorted.length - 1]!;

  const startEquity = start.equity ?? 0;
  const endEquity = end.equity ?? 0;
  const equityChange = endEquity - startEquity;
  const accruedCashChange = accruedCashDelta(start, end);
  const balanceChange = (end.balance ?? 0) - (start.balance ?? 0);
  const closedTradePnl = closedTradePnlInRange(trades, range, now);
  const unexplained = openOrOtherChange(equityChange, balanceChange, accruedCashChange);

  return {
    startTimestamp: start.timestamp,
    endTimestamp: end.timestamp,
    startEquity,
    endEquity,
    equityChange,
    closedTradePnl,
    accruedCashChange,
    balanceChange,
    unexplained,
    offlineGaps: findOfflineEquityGaps(sorted, trades),
  };
}
