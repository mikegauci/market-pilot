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
  minimum_jev_confidence: "80",
  signal_record_threshold: "75",
  risk_per_trade: "2500",
  max_position_size: "10000",
  max_daily_loss: "10000",
  max_open_positions: "5",
  stop_loss_percentage: "1",
  take_profit_percentage: "1.5",
  watchlist: "AAPL, MSFT",
};

describe("parseSettingsForm risk_profile", () => {
  it("parses valid profiles", () => {
    for (const profile of ["low", "medium", "high"] as const) {
      const parsed = parseSettingsForm(form({ ...baseFields, risk_profile: profile }));
      expect(parsed.risk_profile).toBe(profile);
    }
  });

  it("defaults to medium when missing", () => {
    const parsed = parseSettingsForm(form(baseFields));
    expect(parsed.risk_profile).toBe("medium");
  });

  it("rejects invalid profiles", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, risk_profile: "extreme" })),
    ).toThrow("Risk profile must be low, medium, or high");
  });
});

describe("parseSettingsForm watchlist", () => {
  it("deduplicates symbols", () => {
    const parsed = parseSettingsForm(
      form({ ...baseFields, watchlist: "AAPL, aapl, MSFT" }),
    );
    expect(parsed.watchlist).toEqual(["AAPL", "MSFT"]);
  });

  it("rejects empty watchlist", () => {
    expect(() => parseSettingsForm(form({ ...baseFields, watchlist: "  " }))).toThrow(
      "Watchlist must include at least one symbol",
    );
  });

  it("rejects malformed tickers", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, watchlist: "AAPL, bad ticker" })),
    ).toThrow("Invalid ticker(s): BAD TICKER");
  });
});
