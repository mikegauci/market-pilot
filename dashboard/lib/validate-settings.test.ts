import { describe, expect, it } from "vitest";
import { parseSettingsForm } from "@/lib/validate-settings";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.set(key, value);
  }
  return fd;
}

const baseFields = {
  minimum_jev_confidence: "85",
  signal_record_threshold: "75",
  risk_per_trade: "2500",
  max_position_size: "10000",
  max_daily_loss: "10000",
  max_open_positions: "5",
  stop_loss_percentage: "1",
  take_profit_percentage: "1.5",
  max_hold_minutes: "0",
  min_volume_ratio: "0.5",
  watchlist_core: "AAPL, MSFT",
  benchmark_symbol: "EEM",
  watchlist_dynamic_size: "5",
  watchlist_refresh_minutes: "30",
};

describe("parseSettingsForm risk_profile", () => {
  it("parses valid profiles", () => {
    for (const profile of ["low", "medium", "high"] as const) {
      const parsed = parseSettingsForm(form({ ...baseFields, risk_profile: profile }));
      expect(parsed.risk_profile).toBe(profile);
    }
  });

  it("defaults to low when missing", () => {
    const parsed = parseSettingsForm(form(baseFields));
    expect(parsed.risk_profile).toBe("low");
  });

  it("rejects invalid profiles", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, risk_profile: "extreme" })),
    ).toThrow("Risk profile must be low, medium, or high");
  });
});

describe("parseSettingsForm watchlist", () => {
  it("deduplicates core symbols", () => {
    const parsed = parseSettingsForm(
      form({ ...baseFields, watchlist_core: "AAPL, aapl, MSFT" }),
    );
    expect(parsed.watchlist_core).toEqual(["AAPL", "MSFT"]);
    expect(parsed.watchlist).toEqual(["AAPL", "MSFT"]);
  });

  it("rejects empty core watchlist", () => {
    expect(() => parseSettingsForm(form({ ...baseFields, watchlist_core: "  " }))).toThrow(
      "Core watchlist must include at least one symbol",
    );
  });

  it("rejects malformed tickers", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, watchlist_core: "AAPL, bad ticker" })),
    ).toThrow("Invalid core ticker(s): BAD TICKER");
  });
});

describe("parseSettingsForm max_hold_minutes", () => {
  it("parses zero as disabled", () => {
    const parsed = parseSettingsForm(form({ ...baseFields, max_hold_minutes: "0" }));
    expect(parsed.max_hold_minutes).toBe(0);
  });

  it("rejects negative or fractional values", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, max_hold_minutes: "-1" })),
    ).toThrow("Max hold (minutes) must be a whole number from 0 to 480");
    expect(() =>
      parseSettingsForm(form({ ...baseFields, max_hold_minutes: "15.5" })),
    ).toThrow("Max hold (minutes) must be a whole number from 0 to 480");
  });
});
