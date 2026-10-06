import type { PortfolioSnapshot } from "@/lib/types/database";

export type TradingMode = "paper" | "live";

/** Paper: NetLiquidation minus AccruedCash. Live: full NetLiquidation. */
export function tradingEquityFromSnapshot(
  row: Pick<PortfolioSnapshot, "equity" | "ibkr_accrued_cash">,
  tradingMode: TradingMode = "paper",
): number {
  if (tradingMode === "live") {
    return row.equity;
  }
  const accrued = row.ibkr_accrued_cash ?? 0;
  return row.equity - accrued;
}
