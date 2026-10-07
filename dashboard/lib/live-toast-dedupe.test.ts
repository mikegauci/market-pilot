import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  liveToastEventKey,
  markLiveToastShown,
  wasLiveToastShown,
  watchlistToastEventKey,
} from "@/lib/live-toast-dedupe";

const DAY = "2026-10-07T04:00:00.000Z";

function createSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("live-toast-dedupe", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createSessionStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tracks seen trade events per trading day", () => {
    const key = liveToastEventKey("trade-closed", "abc-123");
    expect(wasLiveToastShown(DAY, key)).toBe(false);
    markLiveToastShown(DAY, key);
    expect(wasLiveToastShown(DAY, key)).toBe(true);
    expect(wasLiveToastShown("2026-10-08T04:00:00.000Z", key)).toBe(false);
  });

  it("builds stable watchlist keys", () => {
    expect(
      watchlistToastEventKey({ added: ["AMD", "NVDA"], removed: ["TSLA"] }),
    ).toBe("watchlist:AMD,NVDA|TSLA");
  });
});
