/** Fill the active list from the pool when blocking removed every active name. */
export function seedActiveWatchlistFromPool(
  pool: string[],
  blocked: string[],
  activeSize: number,
): string[] {
  const blockedSet = new Set(blocked.map((symbol) => symbol.toUpperCase()));
  const size = Math.max(1, Math.round(activeSize));
  return pool
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol && !blockedSet.has(symbol))
    .slice(0, size);
}
