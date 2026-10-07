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
  max_position_size: "5000",
  max_daily_loss: "10000",
  max_open_positions: "5",
  stop_loss_percentage: "1",
  take_profit_percentage: "1.5",
  profit_take_min_fraction: "70",
  profit_take_max_fraction: "80",
  profit_take_min_band_hits: "3",
  profit_take_band_window_cycles: "10",
  profit_take_jev_sell_threshold: "70",
  loss_cut_min_fraction: "70",
  loss_cut_max_fraction: "90",
  loss_cut_min_band_hits: "3",
  loss_cut_band_window_cycles: "10",
  loss_cut_jev_sell_threshold: "0",
  max_hold_minutes: "0",
  min_hold_minutes: "15",
  jev_sell_exit_threshold: "95",
  reentry_cooldown_minutes: "45",
  max_entries_per_symbol_per_day: "3",
  rotation_min_session_change_pct: "0",
  entry_ema_gate: "ema_20",
  confirmation_cycles: "2",
  confirmation_seconds: "30",
  min_volume_ratio: "0.5",
  min_share_price: "20",
  min_dollar_volume: "250000",
  watchlist: "AAPL, MSFT",
  benchmark_symbol: "",
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
  it("deduplicates watchlist symbols", () => {
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

  it("allows empty manual watchlist when rotation is on and pool is set", () => {
    const parsed = parseSettingsForm(
      form({
        ...baseFields,
        watchlist: "  ",
        watchlist_rotation_enabled: "on",
        watchlist_pool: "NVDA, AMD",
      }),
    );
    expect(parsed.watchlist).toEqual([]);
    expect(parsed.watchlist_pool).toEqual(["NVDA", "AMD"]);
    expect(parsed.watchlist_rotation_enabled).toBe(true);
  });

  it("rejects malformed tickers", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, watchlist: "AAPL, bad ticker" })),
    ).toThrow("Invalid ticker(s): BAD TICKER");
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

describe("parseSettingsForm confirmation gate", () => {
  it("parses confirmation cycles and seconds", () => {
    const parsed = parseSettingsForm(
      form({ ...baseFields, confirmation_cycles: "1", confirmation_seconds: "15" }),
    );
    expect(parsed.confirmation_cycles).toBe(1);
    expect(parsed.confirmation_seconds).toBe(15);
  });

  it("rejects invalid confirmation cycles", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, confirmation_cycles: "0" })),
    ).toThrow(/Confirmation cycles/);
  });

  it("rejects non-integer confirmation seconds", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, confirmation_seconds: "15.5" })),
    ).toThrow(/Confirmation seconds/);
  });

  it("rejects confirmation seconds above 300", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, confirmation_seconds: "301" })),
    ).toThrow(/Confirmation seconds/);
  });
});

describe("parseSettingsForm exit tuning", () => {
  it("parses min hold and Jev SELL exit threshold", () => {
    const parsed = parseSettingsForm(
      form({
        ...baseFields,
        min_hold_minutes: "15",
        jev_sell_exit_threshold: "95",
      }),
    );
    expect(parsed.min_hold_minutes).toBe(15);
    expect(parsed.jev_sell_exit_threshold).toBe(0.95);
    expect(parsed.profit_take_min_fraction).toBe(0.7);
    expect(parsed.profit_take_max_fraction).toBe(0.8);
    expect(parsed.profit_take_enabled).toBe(false);
  });

  it("parses profit_take_enabled when checkbox is on", () => {
    const parsed = parseSettingsForm(
      form({ ...baseFields, profit_take_enabled: "on" }),
    );
    expect(parsed.profit_take_enabled).toBe(true);
  });

  it("rejects min hold above max hold when max hold is on", () => {
    expect(() =>
      parseSettingsForm(
        form({
          ...baseFields,
          max_hold_minutes: "10",
          min_hold_minutes: "15",
        }),
      ),
    ).toThrow("Min hold (minutes) must be at or below max hold when max hold is on");
  });

  it("parses blank rotation session floor as off", () => {
    const parsed = parseSettingsForm(
      form({ ...baseFields, rotation_min_session_change_pct: "" }),
    );
    expect(parsed.rotation_min_session_change_pct).toBeNull();
  });
});
