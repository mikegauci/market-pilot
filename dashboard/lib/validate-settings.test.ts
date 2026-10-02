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
  max_hold_minutes: "0",
  min_hold_minutes: "15",
  jev_sell_exit_threshold: "95",
  reentry_cooldown_minutes: "45",
  confirmation_cycles: "2",
  confirmation_seconds: "30",
  min_volume_ratio: "0.5",
  min_share_price: "20",
  min_dollar_volume: "250000",
  watchlist_core: "AAPL, MSFT",
  benchmark_symbol: "EEM",
  watchlist_dynamic_size: "5",
  watchlist_min_buy: "60",
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

describe("parseSettingsForm demotion", () => {
  it("defaults demotion toggles to off when checkboxes are omitted", () => {
    const parsed = parseSettingsForm(
      form({
        ...baseFields,
        watchlist_dynamic_enabled: "on",
        demotion_hold_policy: "tighten",
      }),
    );
    expect(parsed.demotion_exits_enabled).toBe(false);
    expect(parsed.demotion_jev_sell_on_loss).toBe(false);
    expect(parsed.demotion_force_exit).toBe(false);
  });

  it("parses demotion settings when dynamic mode is on", () => {
    const parsed = parseSettingsForm(
      form({
        ...baseFields,
        watchlist_dynamic_enabled: "on",
        demotion_exits_enabled: "on",
        demotion_hold_policy: "tighten",
        demotion_jev_sell_on_loss: "on",
        demotion_force_exit: "on",
      }),
    );
    expect(parsed.demotion_exits_enabled).toBe(true);
    expect(parsed.demotion_max_hold_ratio).toBe(0.5);
    expect(parsed.demotion_jev_sell_max_loss_pct).toBe(0.01);
    expect(parsed.demotion_jev_sell_on_loss).toBe(false);
    expect(parsed.demotion_force_exit).toBe(true);
  });

  it("maps demotion hold policy presets to stored ratios", () => {
    const parsed = parseSettingsForm(
      form({
        ...baseFields,
        watchlist_dynamic_enabled: "on",
        demotion_exits_enabled: "on",
        demotion_hold_policy: "keep",
      }),
    );
    expect(parsed.demotion_max_hold_ratio).toBe(1);
  });
});

describe("parseSettingsForm watchlist min buy", () => {
  it("parses watchlist_min_buy percent", () => {
    const parsed = parseSettingsForm(form({ ...baseFields, watchlist_min_buy: "60" }));
    expect(parsed.watchlist_min_buy).toBe(0.6);
  });

  it("rejects watchlist min buy above trade confidence", () => {
    expect(() =>
      parseSettingsForm(
        form({
          ...baseFields,
          minimum_jev_confidence: "80",
          watchlist_min_buy: "85",
        }),
      ),
    ).toThrow("Watchlist min BUY (%) must be at or below Min Jev confidence (%)");
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
});
