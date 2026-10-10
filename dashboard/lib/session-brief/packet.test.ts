import { describe, expect, it } from "vitest";
import { buildSessionPacket } from "@/lib/session-brief/packet";
import type { SessionBriefStats } from "@/lib/session-brief/stats";
import type { Trade } from "@/lib/types/database";
import { settingsFixture } from "@/lib/test-support/settings";

const stats: SessionBriefStats = {
  total: 100,
  traded: 5,
  skip_reasons: [{ reason: "spread_too_wide", count: 40 }],
  near_misses: [
    {
      symbol: "NVDA",
      buy_probability: 0.82,
      trade_skip_reason: "below_trade_threshold",
      ts: "2026-10-02T15:00:00.000Z",
      price: 100,
    },
  ],
  eligible_blocked: [
    {
      symbol: "AAPL",
      buy_probability: 0.88,
      trade_skip_reason: "max_open_positions",
    },
  ],
};

function makeTrade(index: number): Trade {
  return {
    id: `trade-${index}`,
    symbol: "NVDA",
    side: "buy",
    entry_time: "2026-10-02T14:00:00.000Z",
    entry_price: 100,
    exit_time: "2026-10-02T14:10:00.000Z",
    exit_price: 101,
    quantity: 1,
    position_value: 100,
    stop_loss: 99,
    take_profit: 102,
    gross_pnl: 1,
    net_pnl: 1,
    status: "closed",
    paper_or_live: "paper",
    jev_buy_probability: 0.86,
    execution_mode: "ibkr",
    exit_reason: "take_profit",
    ibkr_account_id: "DU1234567",
    created_at: "2026-10-02T14:00:00.000Z",
  };
}

describe("buildSessionPacket", () => {
  it("maps skip labels and caps trades without account identifiers", () => {
    const trades = Array.from({ length: 35 }, (_, i) => makeTrade(i));
    const packet = buildSessionPacket({
      sessionDate: "2026-10-02",
      stats,
      trades,
      settings: settingsFixture(),
      barsBySymbol: new Map(),
      sessionClose: new Date("2026-10-02T20:00:00Z"),
    });

    expect(packet.predictions.skip_reasons[0]?.label).toBe("Spread too wide");
    expect(packet.trades.closed).toHaveLength(30);
    expect(JSON.stringify(packet)).not.toContain("DU1234567");
    expect(packet.settings.minimum_jev_confidence_pct).toBeGreaterThan(1);
  });

  it("replays skipped names and rolls outcomes up by reason", () => {
    const packet = buildSessionPacket({
      sessionDate: "2026-10-02",
      stats,
      trades: [],
      settings: settingsFixture(),
      barsBySymbol: new Map([
        ["NVDA", [{ ts: "2026-10-02T15:05:00.000Z", high: 150, low: 100, close: 140 }]],
      ]),
      sessionClose: new Date("2026-10-02T20:00:00Z"),
    });

    const nvda = packet.missed_opportunities.rows.find((row) => row.symbol === "NVDA");
    expect(nvda?.outcome).toBe("take_profit");
    const aapl = packet.missed_opportunities.rows.find((row) => row.symbol === "AAPL");
    expect(aapl?.outcome).toBe("no_data");
    const below = packet.missed_opportunities.by_reason.find(
      (row) => row.reason === "below_trade_threshold",
    );
    expect(below).toMatchObject({ tested: 1, take_profit: 1 });
  });
});
