import { isRiskProfile, type RiskProfile } from "@/lib/risk-recommendations";

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
    min_volume_ratio: "Min volume ratio",
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
  min_volume_ratio: number;
  risk_profile: RiskProfile;
  watchlist: string[];
  watchlist_core: string[];
  watchlist_dynamic_enabled: boolean;
  watchlist_dynamic_size: number;
  watchlist_refresh_minutes: number;
  benchmark_symbol: string;
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
  const min_volume_ratio = parseRequiredNumber(formData, "min_volume_ratio");

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
  if (min_volume_ratio < 0 || min_volume_ratio > 5) {
    throw new Error("Min volume ratio must be between 0 (off) and 5");
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
    min_volume_ratio,
    risk_profile: parseRiskProfile(formData),
    watchlist: effectiveWatchlist ?? watchlist_core,
    watchlist_core,
    watchlist_dynamic_enabled,
    watchlist_dynamic_size,
    watchlist_refresh_minutes,
    benchmark_symbol,
  };
}
