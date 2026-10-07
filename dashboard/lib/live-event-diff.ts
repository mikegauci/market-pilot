import type { Trade } from "@/lib/types/database";

export type WatchlistDiff = {
  added: string[];
  removed: string[];
};

export function watchlistDiff(
  previous: readonly string[],
  next: readonly string[],
): WatchlistDiff | null {
  const prevSet = new Set(previous.map((symbol) => symbol.toUpperCase()));
  const nextSet = new Set(next.map((symbol) => symbol.toUpperCase()));
  const added = [...nextSet].filter((symbol) => !prevSet.has(symbol)).sort();
  const removed = [...prevSet].filter((symbol) => !nextSet.has(symbol)).sort();
  if (added.length === 0 && removed.length === 0) {
    return null;
  }
  return { added, removed };
}

export function watchlistToastDescription(diff: WatchlistDiff): string {
  const parts: string[] = [];
  if (diff.added.length) {
    parts.push(`Added ${diff.added.join(", ")}`);
  }
  if (diff.removed.length) {
    parts.push(`Removed ${diff.removed.join(", ")}`);
  }
  return parts.join(". ");
}

export function tradeStatusSnapshot(
  trades: readonly Trade[],
): Map<string, Trade["status"]> {
  return new Map(trades.map((trade) => [trade.id, trade.status]));
}

export function tradeLifecycleDiff(
  previous: ReadonlyMap<string, Trade["status"]>,
  trades: readonly Trade[],
): { opened: Trade[]; closed: Trade[] } {
  const opened: Trade[] = [];
  const closed: Trade[] = [];
  for (const trade of trades) {
    const prior = previous.get(trade.id);
    if (trade.status === "open" && prior !== "open") {
      opened.push(trade);
      continue;
    }
    if (trade.status === "closed" && prior !== "closed") {
      closed.push(trade);
    }
  }
  return { opened, closed };
}
