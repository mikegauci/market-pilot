import type { JevRanking, RankingDelta, WatchlistScreenerHistory } from "@/lib/types/database";

export function computeRankingDeltas(
  current: WatchlistScreenerHistory | null,
  previous: WatchlistScreenerHistory | null,
): RankingDelta[] {
  if (!current) return [];

  const prevBySymbol = new Map<string, number>();
  for (const row of previous?.rankings ?? []) {
    prevBySymbol.set(row.symbol, row.rank);
  }

  return current.rankings
    .map((row) => {
      const previousRank = prevBySymbol.get(row.symbol) ?? null;
      return {
        symbol: row.symbol,
        currentRank: row.rank,
        previousRank,
        delta: previousRank != null ? previousRank - row.rank : null,
        buy: row.buy,
      };
    })
    .sort((a, b) => a.currentRank - b.currentRank);
}

export function newSymbolsInScan(
  current: WatchlistScreenerHistory | null,
  previous: WatchlistScreenerHistory | null,
): string[] {
  if (!current || !previous) return [];
  const prev = new Set(previous.rankings.map((r) => r.symbol));
  return current.rankings.filter((r) => !prev.has(r.symbol)).map((r) => r.symbol);
}

export function droppedSymbolsInScan(
  current: WatchlistScreenerHistory | null,
  previous: WatchlistScreenerHistory | null,
): string[] {
  if (!current || !previous) return [];
  const curr = new Set(current.rankings.map((r) => r.symbol));
  return previous.rankings.filter((r) => !curr.has(r.symbol)).map((r) => r.symbol);
}

export function parseRankings(raw: unknown): JevRanking[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is JevRanking =>
      item != null &&
      typeof item === "object" &&
      typeof (item as JevRanking).symbol === "string",
  );
}
