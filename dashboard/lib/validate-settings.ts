import {
  ENTRY_EMA_GATE_VALUES,
  normalizeEntryEmaGate,
  type EntryEmaGate,
} from "@/lib/entry-ema-gate";
import { isRiskProfile, type RiskProfile } from "@/lib/risk-recommendations";

const WATCHLIST_SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;

/** Normalize and validate watchlist tickers (comma-separated string or array). */
export function parseWatchlistSymbols(
  raw: string | string[],
  options?: { allowEmpty?: boolean },
): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const watchlist = [
    ...new Set(
      parts
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (watchlist.length === 0 && !options?.allowEmpty) {
    throw new Error("Watchlist must include at least one symbol");
  }
  const invalidWatchlist = watchlist.filter((s) => !WATCHLIST_SYMBOL_PATTERN.test(s));
  if (invalidWatchlist.length > 0) {
    throw new Error(`Invalid ticker(s): ${invalidWatchlist.join(", ")}`);
  }
  return watchlist;
}

function parseEntryEmaGate(formData: FormData): EntryEmaGate {
  const raw = String(formData.get("entry_ema_gate") ?? "ema_20").trim().toLowerCase();
  const gate = normalizeEntryEmaGate(raw);
  if (!ENTRY_EMA_GATE_VALUES.includes(gate)) {
    throw new Error(`${labelFor("entry_ema_gate")} must be off, EMA-9, or EMA-20`);
  }
  return gate;
}

function parseRequiredNumber(formData: FormData, name: string): number {
  const value = Number(formData.get(name));
  if (!Number.isFinite(value)) {
    throw new Error(`${labelFor(name)} must be a valid number`);
  }
  return value;
}

function parseOptionalRotationSessionPct(formData: FormData): number | null {
  const raw = String(formData.get("rotation_min_session_change_pct") ?? "").trim();
  if (raw === "" || raw.toLowerCase() === "off") {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < -5 || value > 5) {
    throw new Error(
      `${labelFor("rotation_min_session_change_pct")} must be from -5 to 5, or leave blank for off`,
    );
  }
  return value;
}

export function settingsFieldLabel(name: string): string {
  return labelFor(name);
}

function labelFor(name: string): string {
  const labels: Record<string, string> = {
    risk_profile: "Risk profile",
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
    profit_take_min_fraction: "Early take profit min (% of target)",
    profit_take_max_fraction: "Early take profit max (% of target)",
    profit_take_min_band_hits: "Early take profit band touches",
    profit_take_band_window_cycles: "Early take profit lookback (cycles)",
    profit_take_jev_sell_threshold: "Early take profit Jev SELL (%)",
    loss_cut_min_fraction: "Early loss cut min (% toward stop)",
    loss_cut_max_fraction: "Early loss cut max (% toward stop)",
    loss_cut_min_band_hits: "Early loss cut band touches",
    loss_cut_band_window_cycles: "Early loss cut lookback (cycles)",
    loss_cut_jev_sell_threshold: "Early loss cut Jev SELL (%)",
    reentry_cooldown_minutes: "Re-entry cooldown (minutes)",
    max_entries_per_symbol_per_day: "Max entries per symbol (day)",
    rotation_min_session_change_pct: "Rotation session % floor",
    confirmation_cycles: "Confirmation cycles",
    confirmation_seconds: "Confirmation seconds",
    watchlist: "Watchlist",
    watchlist_pool: "Candidate pool",
    watchlist_active_size: "Active list size",
    watchlist_rotation_interval_minutes: "Rotation interval (minutes)",
    watchlist_max_swaps_per_rotation: "Max swaps",
    benchmark_symbol: "Benchmark",
    min_volume_ratio: "Min volume ratio",
    min_share_price: "Min share price ($)",
    min_dollar_volume: "Min dollar volume ($)",
    entry_ema_gate: "Trend filter (EMA)",
    max_rsi: "Max RSI",
    max_spread_pct: "Max spread (%)",
    breakout_enabled: "Breakout promotion",
    breakout_max_rsi: "Breakout max RSI",
    breakout_window_minutes: "Breakout window (minutes)",
    breakout_max_promotions_per_cycle: "Breakout max promotions per cycle",
    breakout_lookback_minutes: "Breakout lookback (minutes)",
    breakout_min_volume_ratio: "Breakout min volume ratio",
    breakout_min_change_5m_pct: "Breakout min 5m change (%)",
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
  max_entries_per_symbol_per_day: number;
  rotation_min_session_change_pct: number | null;
  entry_ema_gate: EntryEmaGate;
  max_rsi: number;
  max_spread_pct: number;
  confirmation_cycles: number;
  confirmation_seconds: number;
  min_volume_ratio: number;
  min_share_price: number;
  min_dollar_volume: number;
  risk_profile: RiskProfile;
  watchlist: string[];
  benchmark_symbol: string;
  watchlist_pool: string[];
  watchlist_rotation_enabled: boolean;
  watchlist_active_size: number;
  watchlist_rotation_interval_minutes: number;
  watchlist_max_swaps_per_rotation: number;
  breakout_enabled: boolean;
  breakout_max_rsi: number;
  breakout_window_minutes: number;
  breakout_max_promotions_per_cycle: number;
  breakout_lookback_minutes: number;
  breakout_min_volume_ratio: number;
  breakout_min_change_5m_pct: number;
  profit_take_enabled: boolean;
  profit_take_min_fraction: number;
  profit_take_max_fraction: number;
  profit_take_min_band_hits: number;
  profit_take_band_window_cycles: number;
  profit_take_jev_sell_threshold: number;
  loss_cut_enabled: boolean;
  loss_cut_min_fraction: number;
  loss_cut_max_fraction: number;
  loss_cut_min_band_hits: number;
  loss_cut_band_window_cycles: number;
  loss_cut_jev_sell_threshold: number;
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

function parseTargetPathPercent(formData: FormData, name: string): number {
  const pct = parseRequiredNumber(formData, name);
  if (pct <= 0 || pct > 100) {
    throw new Error(`${labelFor(name)} must be between 1 and 100`);
  }
  return pct / 100;
}

function parseMaxSpreadPercent(formData: FormData): number {
  const pct = parseRequiredNumber(formData, "max_spread_pct");
  if (pct < 0.01 || pct > 5) {
    throw new Error(`${labelFor("max_spread_pct")} must be between 0.01 and 5`);
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
  const max_entries_per_symbol_per_day = parseRequiredNumber(
    formData,
    "max_entries_per_symbol_per_day",
  );
  const rotation_min_session_change_pct = parseOptionalRotationSessionPct(formData);
  const entry_ema_gate = parseEntryEmaGate(formData);
  const max_rsi = parseRequiredNumber(formData, "max_rsi");
  const max_spread_pct = parseMaxSpreadPercent(formData);
  const confirmation_cycles = parseRequiredNumber(formData, "confirmation_cycles");
  const confirmation_seconds = parseRequiredNumber(formData, "confirmation_seconds");
  const min_volume_ratio = parseRequiredNumber(formData, "min_volume_ratio");
  const min_share_price = parseRequiredNumber(formData, "min_share_price");
  const min_dollar_volume = parseRequiredNumber(formData, "min_dollar_volume");

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
  if (jev_sell_exit_threshold < 0.5) {
    throw new Error("Jev SELL exit (%) must be at least 50");
  }
  const profit_take_enabled =
    String(formData.get("profit_take_enabled") ?? "") === "on";
  const profit_take_min_fraction = parseTargetPathPercent(
    formData,
    "profit_take_min_fraction",
  );
  const profit_take_max_fraction = parseTargetPathPercent(
    formData,
    "profit_take_max_fraction",
  );
  if (profit_take_max_fraction <= profit_take_min_fraction) {
    throw new Error(
      "Early take profit max (% of target) must be greater than min (% of target)",
    );
  }
  const profit_take_min_band_hits = Number(
    formData.get("profit_take_min_band_hits") ?? 3,
  );
  if (
    !Number.isInteger(profit_take_min_band_hits) ||
    profit_take_min_band_hits < 1 ||
    profit_take_min_band_hits > 20
  ) {
    throw new Error("Early take profit band touches must be a whole number from 1 to 20");
  }
  const profit_take_band_window_cycles = Number(
    formData.get("profit_take_band_window_cycles") ?? 10,
  );
  if (
    !Number.isInteger(profit_take_band_window_cycles) ||
    profit_take_band_window_cycles < 1 ||
    profit_take_band_window_cycles > 30
  ) {
    throw new Error(
      "Early take profit lookback (cycles) must be a whole number from 1 to 30",
    );
  }
  if (profit_take_min_band_hits > profit_take_band_window_cycles) {
    throw new Error(
      "Early take profit band touches must be at most the lookback window",
    );
  }
  const profit_take_jev_sell_pct = Number(
    formData.get("profit_take_jev_sell_threshold") ?? 70,
  );
  if (
    !Number.isFinite(profit_take_jev_sell_pct) ||
    profit_take_jev_sell_pct < 0 ||
    profit_take_jev_sell_pct > 100
  ) {
    throw new Error("Early take profit Jev SELL (%) must be from 0 (off) to 100");
  }
  const profit_take_jev_sell_threshold =
    profit_take_jev_sell_pct <= 0 ? 0 : profit_take_jev_sell_pct / 100;
  const loss_cut_enabled =
    String(formData.get("loss_cut_enabled") ?? "") === "on";
  const loss_cut_min_fraction = parseTargetPathPercent(
    formData,
    "loss_cut_min_fraction",
  );
  const loss_cut_max_fraction = parseTargetPathPercent(
    formData,
    "loss_cut_max_fraction",
  );
  if (loss_cut_max_fraction <= loss_cut_min_fraction) {
    throw new Error(
      "Early loss cut max (% toward stop) must be greater than min (% toward stop)",
    );
  }
  const loss_cut_min_band_hits = Number(
    formData.get("loss_cut_min_band_hits") ?? 3,
  );
  if (
    !Number.isInteger(loss_cut_min_band_hits) ||
    loss_cut_min_band_hits < 1 ||
    loss_cut_min_band_hits > 20
  ) {
    throw new Error("Early loss cut band touches must be a whole number from 1 to 20");
  }
  const loss_cut_band_window_cycles = Number(
    formData.get("loss_cut_band_window_cycles") ?? 10,
  );
  if (
    !Number.isInteger(loss_cut_band_window_cycles) ||
    loss_cut_band_window_cycles < 1 ||
    loss_cut_band_window_cycles > 30
  ) {
    throw new Error(
      "Early loss cut lookback (cycles) must be a whole number from 1 to 30",
    );
  }
  if (loss_cut_min_band_hits > loss_cut_band_window_cycles) {
    throw new Error(
      "Early loss cut band touches must be at most the lookback window",
    );
  }
  const loss_cut_jev_sell_pct = Number(
    formData.get("loss_cut_jev_sell_threshold") ?? 0,
  );
  if (
    !Number.isFinite(loss_cut_jev_sell_pct) ||
    loss_cut_jev_sell_pct < 0 ||
    loss_cut_jev_sell_pct > 100
  ) {
    throw new Error("Early loss cut Jev SELL (%) must be from 0 (off) to 100");
  }
  const loss_cut_jev_sell_threshold =
    loss_cut_jev_sell_pct <= 0 ? 0 : loss_cut_jev_sell_pct / 100;
  if (
    !Number.isInteger(reentry_cooldown_minutes) ||
    reentry_cooldown_minutes < 0 ||
    reentry_cooldown_minutes > 480
  ) {
    throw new Error("Re-entry cooldown (minutes) must be a whole number from 0 to 480");
  }
  if (
    !Number.isInteger(max_entries_per_symbol_per_day) ||
    max_entries_per_symbol_per_day < 0 ||
    max_entries_per_symbol_per_day > 20
  ) {
    throw new Error("Max entries per symbol (day) must be a whole number from 0 to 20");
  }
  if (!Number.isInteger(confirmation_cycles) || confirmation_cycles < 1 || confirmation_cycles > 10) {
    throw new Error("Confirmation cycles must be a whole number from 1 to 10");
  }
  if (
    !Number.isInteger(confirmation_seconds) ||
    confirmation_seconds < 0 ||
    confirmation_seconds > 300
  ) {
    throw new Error("Confirmation seconds must be a whole number from 0 to 300");
  }
  if (!Number.isInteger(max_rsi) || max_rsi < 1 || max_rsi > 100) {
    throw new Error(`${labelFor("max_rsi")} must be a whole number from 1 to 100`);
  }
  if (min_volume_ratio < 0 || min_volume_ratio > 5) {
    throw new Error("Min volume ratio must be between 0 (off) and 5");
  }
  if (min_share_price < 0 || min_share_price > 10000) {
    throw new Error("Min share price must be between 0 (off) and 10000");
  }
  if (min_dollar_volume < 0 || min_dollar_volume > 1_000_000_000) {
    throw new Error("Min dollar volume must be between 0 (off) and 1,000,000,000");
  }

  const watchlist_rotation_enabled =
    String(formData.get("watchlist_rotation_enabled") ?? "") === "on";

  const watchlistRaw = String(formData.get("watchlist") ?? "");
  const watchlist = parseWatchlistSymbols(watchlistRaw, {
    allowEmpty: watchlist_rotation_enabled,
  });

  const poolRaw = String(formData.get("watchlist_pool") ?? "");
  const watchlist_pool = poolRaw.trim() ? parseWatchlistSymbols(poolRaw) : [];
  if (watchlist_rotation_enabled && watchlist_pool.length === 0) {
    throw new Error("Add at least one symbol to the candidate pool");
  }

  const watchlist_active_size = Math.round(
    Number(formData.get("watchlist_active_size") ?? 12),
  );
  const watchlist_rotation_interval_minutes = Math.round(
    Number(formData.get("watchlist_rotation_interval_minutes") ?? 15),
  );
  const watchlist_max_swaps_per_rotation = Math.round(
    Number(formData.get("watchlist_max_swaps_per_rotation") ?? 2),
  );
  if (!Number.isInteger(watchlist_active_size) || watchlist_active_size < 1 || watchlist_active_size > 20) {
    throw new Error("Active list size must be between 1 and 20");
  }
  if (
    !Number.isInteger(watchlist_rotation_interval_minutes) ||
    watchlist_rotation_interval_minutes < 5 ||
    watchlist_rotation_interval_minutes > 120
  ) {
    throw new Error("Rotation interval must be between 5 and 120 minutes");
  }
  if (
    !Number.isInteger(watchlist_max_swaps_per_rotation) ||
    watchlist_max_swaps_per_rotation < 1 ||
    watchlist_max_swaps_per_rotation > 5
  ) {
    throw new Error("Max swaps must be between 1 and 5");
  }

  const benchmark_symbol = String(formData.get("benchmark_symbol") ?? "")
    .trim()
    .toUpperCase();
  if (
    benchmark_symbol &&
    !/^[A-Z][A-Z0-9.]{0,9}$/.test(benchmark_symbol)
  ) {
    throw new Error("Benchmark symbol is invalid");
  }

  const breakout_enabled =
    String(formData.get("breakout_enabled") ?? "") === "on";
  const breakout_max_rsi = parseRequiredNumber(formData, "breakout_max_rsi");
  const breakout_window_minutes = parseRequiredNumber(
    formData,
    "breakout_window_minutes",
  );
  const breakout_max_promotions_per_cycle = parseRequiredNumber(
    formData,
    "breakout_max_promotions_per_cycle",
  );
  const breakout_lookback_minutes = parseRequiredNumber(
    formData,
    "breakout_lookback_minutes",
  );
  const breakout_min_volume_ratio = parseRequiredNumber(
    formData,
    "breakout_min_volume_ratio",
  );
  const breakout_min_change_5m_pct = parseRequiredNumber(
    formData,
    "breakout_min_change_5m_pct",
  );

  if (!Number.isInteger(breakout_max_rsi) || breakout_max_rsi < 1 || breakout_max_rsi > 100) {
    throw new Error(`${labelFor("breakout_max_rsi")} must be a whole number from 1 to 100`);
  }
  if (
    watchlist_rotation_enabled &&
    breakout_enabled &&
    breakout_max_rsi <= max_rsi
  ) {
    throw new Error(
      `${labelFor("breakout_max_rsi")} must be higher than ${labelFor("max_rsi")} (${max_rsi})`,
    );
  }
  if (
    !Number.isFinite(breakout_window_minutes) ||
    breakout_window_minutes < 1 ||
    breakout_window_minutes > 60
  ) {
    throw new Error(`${labelFor("breakout_window_minutes")} must be between 1 and 60`);
  }
  if (
    !Number.isInteger(breakout_max_promotions_per_cycle) ||
    breakout_max_promotions_per_cycle < 0 ||
    breakout_max_promotions_per_cycle > 5
  ) {
    throw new Error(
      `${labelFor("breakout_max_promotions_per_cycle")} must be a whole number from 0 to 5`,
    );
  }
  if (
    !Number.isInteger(breakout_lookback_minutes) ||
    breakout_lookback_minutes < 2 ||
    breakout_lookback_minutes > 60
  ) {
    throw new Error(`${labelFor("breakout_lookback_minutes")} must be between 2 and 60`);
  }
  if (
    !Number.isFinite(breakout_min_volume_ratio) ||
    breakout_min_volume_ratio < 0 ||
    breakout_min_volume_ratio > 10
  ) {
    throw new Error(`${labelFor("breakout_min_volume_ratio")} must be between 0 and 10`);
  }
  if (
    !Number.isFinite(breakout_min_change_5m_pct) ||
    breakout_min_change_5m_pct < 0 ||
    breakout_min_change_5m_pct > 5
  ) {
    throw new Error(`${labelFor("breakout_min_change_5m_pct")} must be between 0 and 5`);
  }

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
    max_entries_per_symbol_per_day,
    rotation_min_session_change_pct,
    entry_ema_gate,
    max_rsi,
    max_spread_pct,
    confirmation_cycles,
    confirmation_seconds,
    min_volume_ratio,
    min_share_price,
    min_dollar_volume,
    risk_profile: parseRiskProfile(formData),
    watchlist,
    benchmark_symbol,
    watchlist_pool,
    watchlist_rotation_enabled,
    watchlist_active_size,
    watchlist_rotation_interval_minutes,
    watchlist_max_swaps_per_rotation,
    breakout_enabled,
    breakout_max_rsi,
    breakout_window_minutes,
    breakout_max_promotions_per_cycle,
    breakout_lookback_minutes,
    breakout_min_volume_ratio,
    breakout_min_change_5m_pct,
    profit_take_enabled,
    profit_take_min_fraction,
    profit_take_max_fraction,
    profit_take_min_band_hits,
    profit_take_band_window_cycles,
    profit_take_jev_sell_threshold,
    loss_cut_enabled,
    loss_cut_min_fraction,
    loss_cut_max_fraction,
    loss_cut_min_band_hits,
    loss_cut_band_window_cycles,
    loss_cut_jev_sell_threshold,
  };
}
