import type { Trade } from "@/lib/types/database";

export type SlippageBucket = {
  label: string;
  lo: number;
  hi: number;
  count: number;
};

export type MaeMfePoint = {
  tradeId: string;
  symbol: string;
  mae: number;
  mfe: number;
  win: boolean;
  pnl: number;
};

function tradePnl(trade: Trade): number {
  return trade.net_pnl ?? trade.gross_pnl ?? 0;
}

export function slippageHistogram(
  trades: Trade[],
  bucketWidth = 1,
): SlippageBucket[] {
  const values: number[] = [];
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    if (trade.slippage == null || !Number.isFinite(trade.slippage)) continue;
    values.push(trade.slippage);
  }
  if (values.length === 0) return [];

  const min = Math.floor(Math.min(...values) / bucketWidth) * bucketWidth;
  const max = Math.ceil(Math.max(...values) / bucketWidth) * bucketWidth;
  const buckets: SlippageBucket[] = [];
  for (let lo = min; lo < max || buckets.length === 0; lo += bucketWidth) {
    const hi = lo + bucketWidth;
    const count = values.filter((v) => v >= lo && v < hi).length;
    // Include last edge equals max
    const countAdj =
      hi >= max
        ? values.filter((v) => v >= lo && v <= max).length
        : count;
    buckets.push({
      label: `${lo.toFixed(1)}…${hi.toFixed(1)}`,
      lo,
      hi,
      count: countAdj,
    });
    if (hi >= max) break;
    if (buckets.length > 40) break;
  }
  return buckets;
}

export function maeMfeScatter(trades: Trade[]): MaeMfePoint[] {
  const out: MaeMfePoint[] = [];
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    if (trade.mae == null || trade.mfe == null) continue;
    if (!Number.isFinite(trade.mae) || !Number.isFinite(trade.mfe)) continue;
    const pnl = tradePnl(trade);
    out.push({
      tradeId: trade.id,
      symbol: trade.symbol,
      mae: trade.mae,
      mfe: trade.mfe,
      win: pnl > 0,
      pnl,
    });
  }
  return out;
}

export function totalExecutionCost(trades: Trade[]): {
  slippageAbs: number;
  commission: number;
  total: number;
  nWithSlippage: number;
} {
  let slippageAbs = 0;
  let commission = 0;
  let nWithSlippage = 0;
  for (const trade of trades) {
    if (trade.status !== "closed") continue;
    if (trade.slippage != null && Number.isFinite(trade.slippage)) {
      slippageAbs += Math.abs(trade.slippage);
      nWithSlippage += 1;
    }
    commission += Math.abs(trade.commission ?? 0);
  }
  return {
    slippageAbs,
    commission,
    total: slippageAbs + commission,
    nWithSlippage,
  };
}
