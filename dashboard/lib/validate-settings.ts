import {
  holdPolicyToRatio,
  type DemotionHoldPolicy,
} from "@/lib/demotion-presets";
import { isRiskProfile, type RiskProfile } from "@/lib/risk-recommendations";

const DEMOTION_HOLD_POLICIES: DemotionHoldPolicy[] = ["exit_now", "tighten", "keep"];

function parseRequiredNumber(formData: FormData, name: string): number {
  const value = Number(formData.get(name));
  if (!Number.isFinite(value)) {
    throw new Error(`${labelFor(name)} must be a valid number`);
  }
  return value;
}

function labelFor(name: string): string {
  const labels: Record<string, string> = {
    minimum_jev_confidence: "Min Jev confidence (%)",
    signal_record_threshold: "Signal record threshold (%)",
    risk_per_trade: "Risk per trade",
    max_position_size: "Max position size",
    max_daily_loss: "Max daily loss",
    max_open_positions: "Max open positions",
    stop_loss_percentage: "Stop loss (%)",
    take_profit_percentage: "Take profit (%)",
    max_hold_minutes: "Max hold (minutes)",
    min_hold_minutes: "Min hold (minutes)",
    jev_sell_exit_threshold: "Jev SELL exit (%)",
    reentry_cooldown_minutes: "Re-entry cooldown (minutes)",
    prediction_horizon_minutes: "Prediction horizon (minutes)",
    last_entry_cutoff_minutes_before_close: "Last-entry cutoff (minutes before close)",
    eod_closeout_minutes_before_close: "EOD closeout (minutes before close)",
    eod_flat_verify_minutes_before_close: "EOD flat-verify (minutes before close)",
    equity_divergence_alert_frac: "Equity divergence alert (%)",
    account_capital: "Account capital ($)",
    watchlist_dynamic_size: "Dynamic top-N",
    watchlist_min_buy: "Watchlist min BUY (%)",
    min_volume_ratio: "Min volume ratio",
    min_share_price: "Min share price ($)",
  };
  return labels[name] ?? name;
}

export type ParsedSettings = {
  minimum_jev_confidence: number;
  signal_record_threshold: number;
  risk_per_trade: number;
  max_position_size: number;
  max_daily_loss: number;
  max_open_positions: number;
  stop_loss_percentage: number;
  take_profit_percentage: number;
  max_hold_minutes: number;
  min_hold_minutes: number;
  jev_sell_exit_threshold: number;
  reentry_cooldown_minutes: number;
  prediction_horizon_minutes: number;
  last_entry_cutoff_minutes_before_close: number;
  eod_closeout_enabled: boolean;
  eod_closeout_minutes_before_close: number;
  eod_flat_verify_minutes_before_close: number;
  equity_divergence_alert_frac: number;
  account_capital: number;
  min_volume_ratio: number;
  min_share_price: number;
  risk_profile: RiskProfile;
  watchlist: string[];
  watchlist_core: string[];
  watchlist_dynamic_enabled: boolean;
  watchlist_dynamic_size: number;
  watchlist_min_buy: number;
  watchlist_refresh_minutes: number;
  benchmark_symbol: string;
  demotion_exits_enabled: boolean;
  demotion_max_hold_ratio: number;
  demotion_jev_sell_on_loss: boolean;
  demotion_jev_sell_max_loss_pct: number;
  demotion_force_exit: boolean;
};

function parseRiskProfile(formData: FormData): RiskProfile {
  const raw = String(formData.get("risk_profile") ?? "low");
  if (!isRiskProfile(raw)) {
    throw new Error("Risk profile must be low, medium, or high");
  }
  return raw;
}

function parseConfidencePercent(formData: FormData, name: string): number {
  const pct = parseRequiredNumber(formData, name);
  if (pct <= 0 || pct > 100) {
    throw new Error(`${labelFor(name)} must be between 1 and 100`);
  }
  return pct / 100;
}

function parseStrategyPercent(formData: FormData, name: string): number {
  const pct = parseRequiredNumber(formData, name);
  if (pct < 0.1 || pct > 25) {
    throw new Error(`${labelFor(name)} must be between 0.1 and 25`);
  }
  return pct / 100;
}

export function parseSettingsForm(formData: FormData): ParsedSettings {
  const minimum_jev_confidence = parseConfidencePercent(formData, "minimum_jev_confidence");
  const signal_record_threshold = parseConfidencePercent(formData, "signal_record_threshold");
  const risk_per_trade = parseRequiredNumber(formData, "risk_per_trade");
  const max_position_size = parseRequiredNumber(formData, "max_position_size");
  const max_daily_loss = parseRequiredNumber(formData, "max_daily_loss");
  const max_open_positions = parseRequiredNumber(formData, "max_open_positions");
  const stop_loss_percentage = parseStrategyPercent(formData, "stop_loss_percentage");
  const take_profit_percentage = parseStrategyPercent(formData, "take_profit_percentage");
  const max_hold_minutes = parseRequiredNumber(formData, "max_hold_minutes");
  const min_hold_minutes = parseRequiredNumber(formData, "min_hold_minutes");
  const jev_sell_exit_threshold = parseConfidencePercent(
    formData,
    "jev_sell_exit_threshold",
  );
  const reentry_cooldown_minutes = parseRequiredNumber(
    formData,
    "reentry_cooldown_minutes",
  );
  const prediction_horizon_minutes = parseRequiredNumber(
    formData,
    "prediction_horizon_minutes",
  );
  const last_entry_cutoff_minutes_before_close = parseRequiredNumber(
    formData,
    "last_entry_cutoff_minutes_before_close",
  );
  const eod_closeout_enabled =
    String(formData.get("eod_closeout_enabled") ?? "on") === "on";
  const eod_closeout_minutes_before_close = parseRequiredNumber(
    formData,
    "eod_closeout_minutes_before_close",
  );
  const eod_flat_verify_minutes_before_close = parseRequiredNumber(
    formData,
    "eod_flat_verify_minutes_before_close",
  );
  const equity_divergence_alert_pct = parseRequiredNumber(
    formData,
    "equity_divergence_alert_frac",
  );
  const equity_divergence_alert_frac = equity_divergence_alert_pct / 100;
  const account_capital = parseRequiredNumber(formData, "account_capital");
  const min_volume_ratio = parseRequiredNumber(formData, "min_volume_ratio");
  const min_share_price = parseRequiredNumber(formData, "min_share_price");

  if (signal_record_threshold > minimum_jev_confidence) {
    throw new Error("Signal record threshold (%) must be at or below Min Jev confidence (%)");
  }
  if (risk_per_trade <= 0) {
    throw new Error("Risk per trade must be greater than 0");
  }
  if (max_position_size <= 0) {
    throw new Error("Max position size must be greater than 0");
  }
  if (max_daily_loss <= 0) {
    throw new Error("Max daily loss must be greater than 0");
  }
  if (account_capital <= 0) {
    throw new Error("Account capital must be greater than 0");
  }
  if (!Number.isInteger(max_open_positions) || max_open_positions < 1) {
    throw new Error("Max open positions must be a whole number of at least 1");
  }
  if (take_profit_percentage <= stop_loss_percentage) {
    throw new Error("Take profit (%) must be greater than stop loss (%)");
  }
  if (!Number.isInteger(max_hold_minutes) || max_hold_minutes < 0 || max_hold_minutes > 480) {
    throw new Error("Max hold (minutes) must be a whole number from 0 to 480");
  }
  if (!Number.isInteger(min_hold_minutes) || min_hold_minutes < 0 || min_hold_minutes > 480) {
    throw new Error("Min hold (minutes) must be a whole number from 0 to 480");
  }
  if (max_hold_minutes > 0 && min_hold_minutes > max_hold_minutes) {
    throw new Error("Min hold (minutes) must be at or below max hold when max hold is on");
  }
  if (
    !Number.isInteger(prediction_horizon_minutes) ||
    prediction_horizon_minutes < 1 ||
    prediction_horizon_minutes > 480
  ) {
    throw new Error("Prediction horizon (minutes) must be a whole number from 1 to 480");
  }
  if (
    !Number.isInteger(last_entry_cutoff_minutes_before_close) ||
    last_entry_cutoff_minutes_before_close < 1 ||
    last_entry_cutoff_minutes_before_close > 120
  ) {
    throw new Error("Last-entry cutoff must be a whole number from 1 to 120");
  }
  if (!eod_closeout_enabled) {
    throw new Error(
      "End-of-day closeout must stay ON while overnight holding is not supported",
    );
  }
  if (
    !Number.isInteger(eod_closeout_minutes_before_close) ||
    eod_closeout_minutes_before_close < 5 ||
    eod_closeout_minutes_before_close > 15
  ) {
    throw new Error("EOD closeout must be a whole number from 5 to 15");
  }
  if (
    !Number.isInteger(eod_flat_verify_minutes_before_close) ||
    eod_flat_verify_minutes_before_close < 1 ||
    eod_flat_verify_minutes_before_close > 10
  ) {
    throw new Error("EOD flat-verify must be a whole number from 1 to 10");
  }
  if (eod_flat_verify_minutes_before_close >= eod_closeout_minutes_before_close) {
    throw new Error("EOD flat-verify must be less than EOD closeout minutes");
  }
  if (last_entry_cutoff_minutes_before_close < eod_closeout_minutes_before_close) {
    throw new Error("Last-entry cutoff must be at or above EOD closeout minutes");
  }
  if (equity_divergence_alert_frac < 0.01 || equity_divergence_alert_frac > 0.5) {
    throw new Error("Equity divergence alert (%) must be between 1 and 50");
  }
  if (jev_sell_exit_threshold < 0.5) {
    throw new Error("Jev SELL exit (%) must be at least 50");
  }
  if (
    !Number.isInteger(reentry_cooldown_minutes) ||
    reentry_cooldown_minutes < 0 ||
    reentry_cooldown_minutes > 480
  ) {
    throw new Error("Re-entry cooldown (minutes) must be a whole number from 0 to 480");
  }
  if (min_volume_ratio < 0 || min_volume_ratio > 5) {
    throw new Error("Min volume ratio must be between 0 (off) and 5");
  }
  if (min_share_price < 0 || min_share_price > 10000) {
    throw new Error("Min share price must be between 0 (off) and 10000");
  }

  const watchlistCoreRaw = String(formData.get("watchlist_core") ?? "");
  const watchlist_core = [
    ...new Set(
      watchlistCoreRaw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (watchlist_core.length === 0) {
    throw new Error("Core watchlist must include at least one symbol");
  }
  const invalidCore = watchlist_core.filter((s) => !/^[A-Z][A-Z0-9.]{0,9}$/.test(s));
  if (invalidCore.length > 0) {
    throw new Error(`Invalid core ticker(s): ${invalidCore.join(", ")}`);
  }

  const watchlist_dynamic_enabled =
    String(formData.get("watchlist_dynamic_enabled") ?? "") === "on";
  const watchlist_dynamic_size = Number(formData.get("watchlist_dynamic_size") ?? 5);
  if (
    !Number.isInteger(watchlist_dynamic_size) ||
    watchlist_dynamic_size < 0 ||
    watchlist_dynamic_size > 20
  ) {
    throw new Error("Dynamic watchlist size must be a whole number from 0 to 20");
  }
  const watchlist_min_buy = parseConfidencePercent(formData, "watchlist_min_buy");
  if (watchlist_min_buy > minimum_jev_confidence) {
    throw new Error("Watchlist min BUY (%) must be at or below Min Jev confidence (%)");
  }
  const watchlist_refresh_minutes = Number(formData.get("watchlist_refresh_minutes") ?? 30);
  if (
    !Number.isInteger(watchlist_refresh_minutes) ||
    watchlist_refresh_minutes < 5 ||
    watchlist_refresh_minutes > 240
  ) {
    throw new Error("Jev scan interval must be a whole number from 5 to 240 minutes");
  }
  const benchmark_symbol = String(formData.get("benchmark_symbol") ?? "EEM")
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(benchmark_symbol)) {
    throw new Error("Benchmark symbol is invalid");
  }

  const effectiveWatchlist = watchlist_dynamic_enabled ? undefined : watchlist_core;

  const demotion_exits_enabled =
    String(formData.get("demotion_exits_enabled") ?? "") === "on";
  const demotion_force_exit = String(formData.get("demotion_force_exit") ?? "") === "on";
  const holdPolicyRaw = String(formData.get("demotion_hold_policy") ?? "");
  let demotion_max_hold_ratio: number;
  if (DEMOTION_HOLD_POLICIES.includes(holdPolicyRaw as DemotionHoldPolicy)) {
    demotion_max_hold_ratio = holdPolicyToRatio(holdPolicyRaw as DemotionHoldPolicy);
  } else {
    demotion_max_hold_ratio = Number(formData.get("demotion_max_hold_ratio") ?? 0.5);
    if (
      !Number.isFinite(demotion_max_hold_ratio) ||
      demotion_max_hold_ratio < 0 ||
      demotion_max_hold_ratio > 1
    ) {
      throw new Error("Demotion max-hold ratio must be between 0 and 1");
    }
  }
  const demotion_jev_sell_on_loss =
    demotion_force_exit
      ? false
      : String(formData.get("demotion_jev_sell_on_loss") ?? "") === "on";
  const demotion_jev_sell_max_loss_pct = stop_loss_percentage;

  return {
    minimum_jev_confidence,
    signal_record_threshold,
    risk_per_trade,
    max_position_size,
    max_daily_loss,
    max_open_positions,
    stop_loss_percentage,
    take_profit_percentage,
    max_hold_minutes,
    min_hold_minutes,
    jev_sell_exit_threshold,
    reentry_cooldown_minutes,
    prediction_horizon_minutes,
    last_entry_cutoff_minutes_before_close,
    eod_closeout_enabled,
    eod_closeout_minutes_before_close,
    eod_flat_verify_minutes_before_close,
    equity_divergence_alert_frac,
    account_capital,
    min_volume_ratio,
    min_share_price,
    risk_profile: parseRiskProfile(formData),
    watchlist: effectiveWatchlist ?? watchlist_core,
    watchlist_core,
    watchlist_dynamic_enabled,
    watchlist_dynamic_size,
    watchlist_min_buy,
    watchlist_refresh_minutes,
    benchmark_symbol,
    demotion_exits_enabled,
    demotion_max_hold_ratio,
    demotion_jev_sell_on_loss,
    demotion_jev_sell_max_loss_pct,
    demotion_force_exit,
  };
}
