import { describe, expect, it } from "vitest";
import { buildSettingsAiSummaryPacket } from "@/lib/settings-summary/packet";
import { settingsFixture } from "@/lib/test-support/settings";
import type { BotStatus } from "@/lib/types/database";

const botStatus: BotStatus = {
  id: 1,
  enabled: true,
  trading_mode: "paper",
  execution_mode: "ibkr",
  ibkr_connected: true,
  jev_connected: true,
  ibkr_account_id: "DU123",
  last_heartbeat: "2026-10-05T12:00:00.000Z",
  last_error: null,
  updated_at: "2026-10-05T12:00:00.000Z",
};

describe("buildSettingsAiSummaryPacket", () => {
  it("includes effective watchlist and confidence in percent points", () => {
    const packet = buildSettingsAiSummaryPacket({
      settings: settingsFixture({
        watchlist: ["BABA", "VALE"],
        minimum_jev_confidence: 0.85,
        min_volume_ratio: 0.5,
      }),
      baselineEquity: 1000,
      currentEquity: 1050,
      botStatus,
      now: new Date("2026-10-05T12:00:00.000Z"),
    });

    expect(packet.jev_and_signals.minimum_jev_confidence_pct).toBe(85);
    expect(packet.watchlist.effective_symbols).toEqual(["BABA", "VALE"]);
    expect(packet.exits_and_filters.min_volume_ratio).toBe(0.5);
    expect(packet.trader_built_in_gates.require_price_above_ema20).toBe(true);
    expect(packet.equity.current_usd).toBe(1050);
  });
});
