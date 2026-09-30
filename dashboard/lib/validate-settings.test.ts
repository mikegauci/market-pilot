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
  max_hold_minutes: "0",
  min_hold_minutes: "15",
  jev_sell_exit_threshold: "95",
  reentry_cooldown_minutes: "45",
  prediction_horizon_minutes: "15",
  last_entry_cutoff_minutes_before_close: "40",
  eod_closeout_enabled: "on",
  eod_closeout_minutes_before_close: "10",
  eod_flat_verify_minutes_before_close: "5",
  equity_divergence_alert_frac: "5",
  stale_input_gates_enabled: "on",
  max_quote_age_sec: "5",
  kill_stale_quote_sec: "15",
  kill_stale_quote_share_pct: "50",
  quote_age_log_only_sec: "300",
  max_signal_age_sec: "30",
  max_bar_gap_sec: "90",
  max_news_pub_age_sec: "3600",
  max_news_receipt_lag_sec: "600",
  pre_submit_recheck_enabled: "on",
  max_entry_price_drift_bps: "20",
  confirmation_mode: "distinct_bars",
  confirmation_count: "2",
  kill_recover_healthy_sec: "120",
  kill_alert_min_gap_sec: "60",
  jev_transport_fail_rate_kill_pct: "50",
  jev_transport_fail_window_sec: "60",
  jev_timeout_sec: "3",
  jev_max_retries: "1",
  reconcile_interval_sec: "60",
  reconcile_protect_orphans: "on",
  daily_loss_include_unrealized: "on",
  daily_loss_include_fees: "",
  daily_loss_action: "block_entries",
  drawdown_breaker_enabled: "",
  drawdown_max_pct: "10",
  account_capital: "10000",
  min_volume_ratio: "0.5",
  min_share_price: "20",
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

describe("parseSettingsForm eod closeout", () => {
  it("rejects eod_closeout_enabled off", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, eod_closeout_enabled: "" })),
    ).toThrow("End-of-day closeout must stay ON");
  });

  it("parses equity divergence as fraction", () => {
    const parsed = parseSettingsForm(
      form({ ...baseFields, equity_divergence_alert_frac: "5" }),
    );
    expect(parsed.equity_divergence_alert_frac).toBe(0.05);
    expect(parsed.account_capital).toBe(10000);
    expect(parsed.prediction_horizon_minutes).toBe(15);
  });

  it("parses reconcile interval defaults", () => {
    const parsed = parseSettingsForm(form(baseFields));
    expect(parsed.reconcile_interval_sec).toBe(60);
    expect(parsed.reconcile_protect_orphans).toBe(true);
    expect(parsed.daily_loss_include_unrealized).toBe(true);
    expect(parsed.daily_loss_include_fees).toBe(false);
    expect(parsed.daily_loss_action).toBe("block_entries");
    expect(parsed.drawdown_breaker_enabled).toBe(false);
    expect(parsed.drawdown_max_frac).toBe(0.1);
  });

  it("rejects reconcile interval out of range", () => {
    expect(() =>
      parseSettingsForm(form({ ...baseFields, reconcile_interval_sec: "10" })),
    ).toThrow("Reconcile interval must be an integer from 15 to 600 seconds");
  });

  it("parses flatten daily loss action and drawdown", () => {
    const parsed = parseSettingsForm(
      form({
        ...baseFields,
        daily_loss_action: "flatten_and_block",
        drawdown_breaker_enabled: "on",
        drawdown_max_pct: "15",
      }),
    );
    expect(parsed.daily_loss_action).toBe("flatten_and_block");
    expect(parsed.drawdown_breaker_enabled).toBe(true);
    expect(parsed.drawdown_max_frac).toBe(0.15);
  });
});
