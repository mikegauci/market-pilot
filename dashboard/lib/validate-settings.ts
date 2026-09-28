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
  risk_profile: RiskProfile;
  watchlist: string[];
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

  const watchlistRaw = String(formData.get("watchlist") ?? "");
  const watchlist = [
    ...new Set(
      watchlistRaw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (watchlist.length === 0) {
    throw new Error("Watchlist must include at least one symbol");
  }
  const invalidSymbols = watchlist.filter((s) => !/^[A-Z][A-Z0-9.]{0,9}$/.test(s));
  if (invalidSymbols.length > 0) {
    throw new Error(`Invalid ticker(s): ${invalidSymbols.join(", ")}`);
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
    risk_profile: parseRiskProfile(formData),
    watchlist,
  };
}
