import type { Position, Trade } from "@/lib/types/database";

/** Match an open trade to a position row (prefer exact quantity, else newest). */
export function tradeForPosition(position: Position, openTrades: Trade[]): Trade | undefined {
  const candidates = openTrades.filter((t) => t.symbol === position.symbol);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const qtyMatch = candidates.find((t) => t.quantity === position.quantity);
  if (qtyMatch) return qtyMatch;

  return candidates.sort(
    (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime(),
  )[0];
}
