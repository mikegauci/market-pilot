const STORAGE_PREFIX = "mp-dashboard-live-toasts";
const MAX_SEEN_KEYS = 200;

function storageKey(tradingDayStartIso: string): string {
  return `${STORAGE_PREFIX}:${tradingDayStartIso}`;
}

function readSeenKeys(tradingDayStartIso: string): Set<string> {
  if (typeof sessionStorage === "undefined") {
    return new Set();
  }
  try {
    const raw = sessionStorage.getItem(storageKey(tradingDayStartIso));
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function writeSeenKeys(tradingDayStartIso: string, keys: Set<string>): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    const list = [...keys].slice(-MAX_SEEN_KEYS);
    sessionStorage.setItem(storageKey(tradingDayStartIso), JSON.stringify(list));
  } catch {
    // Private mode / quota — dedupe is best-effort only.
  }
}

export function liveToastEventKey(
  kind: "trade-open" | "trade-closed" | "watchlist",
  id: string,
): string {
  return `${kind}:${id}`;
}

export function wasLiveToastShown(tradingDayStartIso: string, eventKey: string): boolean {
  return readSeenKeys(tradingDayStartIso).has(eventKey);
}

export function markLiveToastShown(tradingDayStartIso: string, eventKey: string): void {
  const keys = readSeenKeys(tradingDayStartIso);
  if (keys.has(eventKey)) {
    return;
  }
  keys.add(eventKey);
  writeSeenKeys(tradingDayStartIso, keys);
}

export function watchlistToastEventKey(diff: { added: string[]; removed: string[] }): string {
  const added = [...diff.added].sort().join(",");
  const removed = [...diff.removed].sort().join(",");
  return liveToastEventKey("watchlist", `${added}|${removed}`);
}
