import type { Trade } from "@/lib/types/database";

export type PriceTick = {
  price: number;
  created_at: string;
};

export type InTradePeak = {
  peak_price: number;
  peak_at: string;
  peak_pct_from_entry: number;
  peak_pct_of_take_profit_path: number | null;
  peak_unrealized_dollars: number | null;
  sample_note: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Best favorable price from bot quote snapshots while the trade was open (long only). */
export function computeInTradePeak(
  trade: Pick<Trade, "entry_price" | "take_profit" | "quantity" | "side">,
  ticks: PriceTick[],
): InTradePeak | null {
  if (trade.side !== "buy" || trade.entry_price <= 0 || ticks.length === 0) {
    return null;
  }

  let peakPrice = trade.entry_price;
  let peakAt = ticks[0]!.created_at;
  for (const tick of ticks) {
    if (tick.price > peakPrice) {
      peakPrice = tick.price;
      peakAt = tick.created_at;
    }
  }

  if (peakPrice <= trade.entry_price) {
    return null;
  }

  const peakPctFromEntry = round1(((peakPrice - trade.entry_price) / trade.entry_price) * 100);

  let peakPctOfTakeProfitPath: number | null = null;
  const tp = trade.take_profit;
  if (tp != null && tp > trade.entry_price) {
    peakPctOfTakeProfitPath = round1(
      ((peakPrice - trade.entry_price) / (tp - trade.entry_price)) * 100,
    );
  }

  const qty = trade.quantity;
  const peakUnrealized =
    qty != null && qty > 0 ? round2((peakPrice - trade.entry_price) * qty) : null;

  return {
    peak_price: peakPrice,
    peak_at: peakAt,
    peak_pct_from_entry: peakPctFromEntry,
    peak_pct_of_take_profit_path: peakPctOfTakeProfitPath,
    peak_unrealized_dollars: peakUnrealized,
    sample_note:
      "Peak from bot quote snapshots during the trade (typically ~15s apart; may miss the exact tick high).",
  };
}

export function closedTradeIsLoss(trade: Trade): boolean {
  if (trade.status !== "closed") return false;
  const pnl = trade.net_pnl ?? trade.gross_pnl;
  return pnl != null && pnl < 0;
}
