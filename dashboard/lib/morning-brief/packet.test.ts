import { describe, expect, it } from "vitest";
import { buildMorningBriefPacket } from "@/lib/morning-brief/packet";
import { settingsFixture } from "@/lib/test-support/settings";
import type { MarketNewsRow } from "@/lib/types/database";

const now = new Date("2026-10-05T12:00:00.000Z");

function article(overrides: Partial<MarketNewsRow> = {}): MarketNewsRow {
  return {
    id: 1,
    headline: "BABA faces a lawsuit",
    summary: null,
    url: null,
    source: "Finnhub",
    image: null,
    category: "company",
    related: "BABA",
    related_symbols: ["BABA"],
    published_at: "2026-10-05T08:00:00.000Z",
    fetched_at: "2026-10-05T08:05:00.000Z",
    sentiment: -0.4,
    tags: ["lawsuit"],
    ...overrides,
  };
}

describe("buildMorningBriefPacket", () => {
  it("keeps fresh headlines for watchlist names and records picky gates", () => {
    const packet = buildMorningBriefPacket({
      settings: settingsFixture({
        watchlist_dynamic_enabled: false,
        watchlist: ["BABA", "VALE"],
        watchlist_core: ["BABA", "VALE"],
        watchlist_pins: [{ symbol: "BABA", locked: true, protect_demotion: true }],
        watchlist_dismissed: ["PDD"],
        minimum_jev_confidence: 0.85,
        min_volume_ratio: 0.5,
      }),
      articles: [
        article(),
        article({
          id: 2,
          headline: "Old Vale note",
          related_symbols: ["VALE"],
          published_at: "2026-10-01T08:00:00.000Z",
          tags: [],
        }),
        article({
          id: 3,
          headline: "Unrelated market wrap",
          related_symbols: ["SPY"],
          tags: [],
        }),
      ],
      now,
    });

    expect(packet.watchlist.map((row) => row.symbol)).toEqual(["BABA", "VALE"]);
    expect(packet.watchlist[0]).toMatchObject({ pinned: true, locked: true });
    expect(packet.dismissed).toEqual(["PDD"]);
    expect(packet.headlines).toHaveLength(1);
    expect(packet.headlines[0]?.symbols).toEqual(["BABA"]);
    expect(packet.headlines[0]?.headline).toBe("BABA faces a lawsuit");
    expect(packet.fresh_headline_count).toBe(1);
    expect(packet.gates.minimum_jev_confidence_pct).toBe(85);
    expect(packet.gates.min_volume_ratio).toBe(0.5);
    expect(packet.gates.max_spread_pct).toBe(0.15);
  });

  it("leaves headlines empty when nothing in the window matches", () => {
    const packet = buildMorningBriefPacket({
      settings: settingsFixture({ watchlist_dynamic_enabled: false }),
      articles: [],
      now,
    });

    expect(packet.headlines).toEqual([]);
    expect(packet.fresh_headline_count).toBe(0);
  });
});
