/** Uppercase unique symbol list for entry_blocked_symbols settings. */
export function mergeEntryBlockedSymbols(
  current: string[] | null | undefined,
  add: string[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of [...(current ?? []), ...add]) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    ordered.push(symbol);
  }
  return ordered;
}

export function removeEntryBlockedSymbol(
  current: string[] | null | undefined,
  symbol: string,
): string[] {
  const target = symbol.trim().toUpperCase();
  return (current ?? [])
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item && item !== target);
}

export function stampEntryBlockedAt(
  current: Record<string, string> | null | undefined,
  symbols: string[],
  blockedAtIso: string,
): Record<string, string> {
  const next = { ...(current ?? {}) };
  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) continue;
    next[symbol] = blockedAtIso;
  }
  return next;
}

export function clearEntryBlockedAt(
  current: Record<string, string> | null | undefined,
  symbol: string,
): Record<string, string> {
  const target = symbol.trim().toUpperCase();
  const next = { ...(current ?? {}) };
  delete next[target];
  return next;
}
