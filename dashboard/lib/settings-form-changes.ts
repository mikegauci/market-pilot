import { entryEmaGateLabel, normalizeEntryEmaGate } from "@/lib/entry-ema-gate";
import { parseRotationSessionPctInput } from "@/lib/format-rotation-session";
import { resolveRiskProfile, type RiskProfile } from "@/lib/risk-recommendations";
import {
  displayPercentToFraction,
  fractionToDisplayPercent,
  formatStrategyPercent,
} from "@/lib/strategy-recommendations";
import type { Settings } from "@/lib/types/database";
import { normalizeWatchlistSymbols } from "@/lib/watchlist-symbols";
import { formatCurrency } from "@/lib/utils";
import type { ParsedSettings } from "@/lib/validate-settings";
import { settingsFieldLabel } from "@/lib/validate-settings";

export type SettingsFormDraft = ParsedSettings;

export type SettingsFormChange = {
  key: string;
  label: string;
  fromLabel: string;
  toLabel: string;
};

function nearlyEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function sortedSymbols(symbols: string[]): string[] {
  return [...symbols].map((s) => s.toUpperCase()).sort();
}

function symbolsEqual(a: string[], b: string[]): boolean {
  const left = sortedSymbols(a);
  const right = sortedSymbols(b);
  if (left.length !== right.length) return false;
  return left.every((symbol, index) => symbol === right[index]);
}

function formatWatchlist(symbols: string[]): string {
  const list = sortedSymbols(symbols);
  if (list.length === 0) return "—";
  if (list.length <= 6) return list.join(", ");
  return `${list.length} symbols (${list.slice(0, 4).join(", ")}…)`;
}

function formatDraftValue(
  key: keyof SettingsFormDraft,
  value: SettingsFormDraft[keyof SettingsFormDraft],
  currency: string,
): string {
  switch (key) {
    case "minimum_jev_confidence":
    case "signal_record_threshold":
    case "jev_sell_exit_threshold":
      return `${fractionToDisplayPercent(value as number)}%`;
    case "stop_loss_percentage":
    case "take_profit_percentage":
      return formatStrategyPercent(value as number);
    case "profit_take_min_fraction":
    case "profit_take_max_fraction":
    case "loss_cut_min_fraction":
    case "loss_cut_max_fraction":
      return `${fractionToDisplayPercent(value as number)}% of path`;
    case "profit_take_jev_sell_threshold":
    case "loss_cut_jev_sell_threshold": {
      const fraction = value as number;
      return fraction <= 0 ? "off" : `${fractionToDisplayPercent(fraction)}%`;
    }
    case "profit_take_enabled":
    case "loss_cut_enabled":
    case "watchlist_rotation_enabled":
      return value ? "On" : "Off";
    case "risk_profile":
      return String(value).charAt(0).toUpperCase() + String(value).slice(1);
    case "risk_per_trade":
    case "max_position_size":
    case "max_daily_loss":
      return formatCurrency(value as number, currency);
    case "min_share_price":
    case "min_dollar_volume":
      return (value as number) <= 0 ? "off" : formatCurrency(value as number, currency);
    case "min_volume_ratio":
      return (value as number) <= 0 ? "off" : String(value);
    case "entry_ema_gate":
      return entryEmaGateLabel(normalizeEntryEmaGate(value));
    case "max_rsi":
      return String(value);
    case "max_spread_pct":
      return formatStrategyPercent(value as number);
    case "rotation_min_session_change_pct": {
      const pct = value as number | null;
      if (pct == null) return "off";
      return `${pct}% since open`;
    }
    case "max_hold_minutes":
    case "min_hold_minutes":
    case "reentry_cooldown_minutes":
      return (value as number) <= 0 ? "off" : `${value} min`;
    case "watchlist":
    case "watchlist_pool":
      return formatWatchlist(value as string[]);
    case "benchmark_symbol":
      return (value as string) || "off";
    default:
      return String(value);
  }
}

export function settingsToFormDraft(settings: Settings): SettingsFormDraft {
  return {
    minimum_jev_confidence: settings.minimum_jev_confidence,
    signal_record_threshold: settings.signal_record_threshold,
    risk_per_trade: settings.risk_per_trade,
    max_position_size: settings.max_position_size,
    max_daily_loss: settings.max_daily_loss,
    max_open_positions: settings.max_open_positions,
    stop_loss_percentage: settings.stop_loss_percentage,
    take_profit_percentage: settings.take_profit_percentage,
    max_hold_minutes: settings.max_hold_minutes ?? 0,
    min_hold_minutes: settings.min_hold_minutes ?? 15,
    jev_sell_exit_threshold: settings.jev_sell_exit_threshold ?? 0.95,
    reentry_cooldown_minutes: settings.reentry_cooldown_minutes ?? 45,
    max_entries_per_symbol_per_day: settings.max_entries_per_symbol_per_day ?? 3,
    rotation_min_session_change_pct: settings.rotation_min_session_change_pct ?? null,
    entry_ema_gate: normalizeEntryEmaGate(settings.entry_ema_gate),
    max_rsi: settings.max_rsi ?? 70,
    max_spread_pct: settings.max_spread_pct ?? 0.0015,
    confirmation_cycles: settings.confirmation_cycles ?? 2,
    confirmation_seconds: settings.confirmation_seconds ?? 30,
    min_volume_ratio: settings.min_volume_ratio ?? 0,
    min_share_price: settings.min_share_price ?? 20,
    min_dollar_volume: settings.min_dollar_volume ?? 250_000,
    risk_profile: resolveRiskProfile(settings.risk_profile),
    watchlist: normalizeWatchlistSymbols(settings.watchlist ?? []),
    benchmark_symbol: (settings.benchmark_symbol ?? "").trim().toUpperCase(),
    watchlist_pool: normalizeWatchlistSymbols(settings.watchlist_pool ?? []),
    watchlist_rotation_enabled: Boolean(settings.watchlist_rotation_enabled),
    watchlist_active_size: settings.watchlist_active_size ?? 12,
    watchlist_rotation_interval_minutes: settings.watchlist_rotation_interval_minutes ?? 15,
    watchlist_max_swaps_per_rotation: settings.watchlist_max_swaps_per_rotation ?? 2,
    profit_take_enabled: settings.profit_take_enabled ?? false,
    profit_take_min_fraction: settings.profit_take_min_fraction ?? 0.7,
    profit_take_max_fraction: settings.profit_take_max_fraction ?? 0.8,
    profit_take_min_band_hits: settings.profit_take_min_band_hits ?? 3,
    profit_take_band_window_cycles: settings.profit_take_band_window_cycles ?? 10,
    profit_take_jev_sell_threshold: settings.profit_take_jev_sell_threshold ?? 0.7,
    loss_cut_enabled: settings.loss_cut_enabled ?? false,
    loss_cut_min_fraction: settings.loss_cut_min_fraction ?? 0.7,
    loss_cut_max_fraction: settings.loss_cut_max_fraction ?? 0.9,
    loss_cut_min_band_hits: settings.loss_cut_min_band_hits ?? 3,
    loss_cut_band_window_cycles: settings.loss_cut_band_window_cycles ?? 10,
    loss_cut_jev_sell_threshold: settings.loss_cut_jev_sell_threshold ?? 0,
  };
}

export type WatchlistFormDraftSlice = Pick<
  SettingsFormDraft,
  | "watchlist_rotation_enabled"
  | "watchlist"
  | "watchlist_pool"
  | "benchmark_symbol"
  | "watchlist_active_size"
  | "watchlist_rotation_interval_minutes"
  | "watchlist_max_swaps_per_rotation"
  | "rotation_min_session_change_pct"
>;

export function watchlistDraftFromSettings(settings: Settings): WatchlistFormDraftSlice {
  const draft = settingsToFormDraft(settings);
  return {
    watchlist_rotation_enabled: draft.watchlist_rotation_enabled,
    watchlist: draft.watchlist,
    watchlist_pool: draft.watchlist_pool,
    benchmark_symbol: draft.benchmark_symbol,
    watchlist_active_size: draft.watchlist_active_size,
    watchlist_rotation_interval_minutes: draft.watchlist_rotation_interval_minutes,
    watchlist_max_swaps_per_rotation: draft.watchlist_max_swaps_per_rotation,
    rotation_min_session_change_pct: draft.rotation_min_session_change_pct,
  };
}

export function parseWatchlistFormDraft(input: {
  rotating: boolean;
  manualWatchlist: string[];
  poolSymbols: string[];
  benchmarkSymbol: string;
  activeSize: number;
  rotationIntervalMinutes: number;
  maxSwaps: number;
  rotationSessionPctRaw: string;
  saved: Settings;
}): WatchlistFormDraftSlice {
  const savedDraft = settingsToFormDraft(input.saved);
  if (!input.rotating) {
    return {
      watchlist_rotation_enabled: false,
      watchlist: normalizeWatchlistSymbols(input.manualWatchlist),
      watchlist_pool: normalizeWatchlistSymbols(input.poolSymbols),
      benchmark_symbol: input.benchmarkSymbol.trim().toUpperCase(),
      watchlist_active_size: savedDraft.watchlist_active_size,
      watchlist_rotation_interval_minutes: savedDraft.watchlist_rotation_interval_minutes,
      watchlist_max_swaps_per_rotation: savedDraft.watchlist_max_swaps_per_rotation,
      rotation_min_session_change_pct: savedDraft.rotation_min_session_change_pct,
    };
  }

  return {
    watchlist_rotation_enabled: true,
    watchlist: normalizeWatchlistSymbols(input.manualWatchlist),
    watchlist_pool: normalizeWatchlistSymbols(input.poolSymbols),
    benchmark_symbol: input.benchmarkSymbol.trim().toUpperCase(),
    watchlist_active_size: input.activeSize,
    watchlist_rotation_interval_minutes: input.rotationIntervalMinutes,
    watchlist_max_swaps_per_rotation: input.maxSwaps,
    rotation_min_session_change_pct: parseRotationSessionPctInput(input.rotationSessionPctRaw),
  };
}

const DRAFT_KEYS = [
  "minimum_jev_confidence",
  "signal_record_threshold",
  "confirmation_cycles",
  "confirmation_seconds",
  "risk_per_trade",
  "max_position_size",
  "max_daily_loss",
  "max_open_positions",
  "stop_loss_percentage",
  "take_profit_percentage",
  "max_hold_minutes",
  "min_hold_minutes",
  "jev_sell_exit_threshold",
  "reentry_cooldown_minutes",
  "max_entries_per_symbol_per_day",
  "rotation_min_session_change_pct",
  "entry_ema_gate",
  "max_rsi",
  "max_spread_pct",
  "min_volume_ratio",
  "min_share_price",
  "min_dollar_volume",
  "risk_profile",
  "watchlist",
  "benchmark_symbol",
  "watchlist_pool",
  "watchlist_rotation_enabled",
  "watchlist_active_size",
  "watchlist_rotation_interval_minutes",
  "watchlist_max_swaps_per_rotation",
  "profit_take_enabled",
  "profit_take_min_fraction",
  "profit_take_max_fraction",
  "profit_take_min_band_hits",
  "profit_take_band_window_cycles",
  "profit_take_jev_sell_threshold",
  "loss_cut_enabled",
  "loss_cut_min_fraction",
  "loss_cut_max_fraction",
  "loss_cut_min_band_hits",
  "loss_cut_band_window_cycles",
  "loss_cut_jev_sell_threshold",
] as const satisfies readonly (keyof SettingsFormDraft)[];

function valuesEqual(
  key: keyof SettingsFormDraft,
  saved: SettingsFormDraft,
  draft: SettingsFormDraft,
): boolean {
  const a = saved[key];
  const b = draft[key];
  if (key === "watchlist" || key === "watchlist_pool") {
    return symbolsEqual(a as string[], b as string[]);
  }
  if (key === "rotation_min_session_change_pct") {
    const left = a as number | null;
    const right = b as number | null;
    if (left == null && right == null) return true;
    if (left == null || right == null) return false;
    return nearlyEqual(left, right);
  }
  if (typeof a === "number" && typeof b === "number") {
    return nearlyEqual(a, b);
  }
  return a === b;
}

export function buildMainSettingsFormDraft(input: {
  minJevPct: number;
  signalRecordPct: number;
  confirmationCycles: number;
  confirmationSeconds: number;
  riskPerTrade: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldMinutes: number;
  minHoldMinutes: number;
  jevSellExitPct: number;
  reentryCooldownMinutes: number;
  maxEntriesPerSymbol: number;
  entryEmaGate: SettingsFormDraft["entry_ema_gate"];
  maxRsi: number;
  maxSpreadPct: number;
  minVolumeRatio: number;
  minSharePrice: number;
  minDollarVolume: number;
  selectedProfile: RiskProfile;
  profitTakeEnabled: boolean;
  profitTakeMinPct: number;
  profitTakeMaxPct: number;
  profitTakeMinBandHits: number;
  profitTakeBandWindow: number;
  profitTakeJevSellPct: number;
  lossCutEnabled: boolean;
  lossCutMinPct: number;
  lossCutMaxPct: number;
  lossCutMinBandHits: number;
  lossCutBandWindow: number;
  lossCutJevSellPct: number;
  watchlist: WatchlistFormDraftSlice;
}): SettingsFormDraft {
  return {
    ...input.watchlist,
    minimum_jev_confidence: input.minJevPct / 100,
    signal_record_threshold: input.signalRecordPct / 100,
    confirmation_cycles: input.confirmationCycles,
    confirmation_seconds: input.confirmationSeconds,
    risk_per_trade: input.riskPerTrade,
    max_position_size: input.maxPositionSize,
    max_daily_loss: input.maxDailyLoss,
    max_open_positions: input.maxOpenPositions,
    stop_loss_percentage: input.stopLossPct / 100,
    take_profit_percentage: input.takeProfitPct / 100,
    max_hold_minutes: input.maxHoldMinutes,
    min_hold_minutes: input.minHoldMinutes,
    jev_sell_exit_threshold: input.jevSellExitPct / 100,
    reentry_cooldown_minutes: input.reentryCooldownMinutes,
    max_entries_per_symbol_per_day: input.maxEntriesPerSymbol,
    entry_ema_gate: input.entryEmaGate,
    max_rsi: input.maxRsi,
    max_spread_pct: input.maxSpreadPct / 100,
    min_volume_ratio: input.minVolumeRatio,
    min_share_price: input.minSharePrice,
    min_dollar_volume: input.minDollarVolume,
    risk_profile: input.selectedProfile,
    profit_take_enabled: input.profitTakeEnabled,
    profit_take_min_fraction: displayPercentToFraction(input.profitTakeMinPct),
    profit_take_max_fraction: displayPercentToFraction(input.profitTakeMaxPct),
    profit_take_min_band_hits: input.profitTakeMinBandHits,
    profit_take_band_window_cycles: input.profitTakeBandWindow,
    profit_take_jev_sell_threshold:
      input.profitTakeJevSellPct <= 0 ? 0 : input.profitTakeJevSellPct / 100,
    loss_cut_enabled: input.lossCutEnabled,
    loss_cut_min_fraction: displayPercentToFraction(input.lossCutMinPct),
    loss_cut_max_fraction: displayPercentToFraction(input.lossCutMaxPct),
    loss_cut_min_band_hits: input.lossCutMinBandHits,
    loss_cut_band_window_cycles: input.lossCutBandWindow,
    loss_cut_jev_sell_threshold:
      input.lossCutJevSellPct <= 0 ? 0 : input.lossCutJevSellPct / 100,
  };
}

export function diffSettingsFormDraft(
  saved: SettingsFormDraft,
  draft: SettingsFormDraft,
  currency: string,
): SettingsFormChange[] {
  const changes: SettingsFormChange[] = [];
  for (const key of DRAFT_KEYS) {
    if (valuesEqual(key, saved, draft)) continue;
    changes.push({
      key,
      label: settingsFieldLabel(key),
      fromLabel: formatDraftValue(key, saved[key], currency),
      toLabel: formatDraftValue(key, draft[key], currency),
    });
  }
  return changes;
}
