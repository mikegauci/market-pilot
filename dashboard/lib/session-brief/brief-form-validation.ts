import { confidencePercentFromDecimal } from "@/lib/settings-display";
import { fractionToDisplayPercent } from "@/lib/strategy-recommendations";
import type { Settings } from "@/lib/types/database";

/** Form-facing values after applying brief diffs (percent fields, not decimals). */
export type BriefFormSlice = {
  minimum_jev_confidence_pct: number;
  signal_record_threshold_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  max_hold_minutes: number;
  min_hold_minutes: number;
  max_open_positions: number;
  min_volume_ratio: number;
  reentry_cooldown_minutes: number;
};

export function briefFormSliceFromSettings(settings: Settings): BriefFormSlice {
  return {
    minimum_jev_confidence_pct: confidencePercentFromDecimal(settings.minimum_jev_confidence),
    signal_record_threshold_pct: confidencePercentFromDecimal(settings.signal_record_threshold),
    stop_loss_pct: fractionToDisplayPercent(settings.stop_loss_percentage),
    take_profit_pct: fractionToDisplayPercent(settings.take_profit_percentage),
    max_hold_minutes: settings.max_hold_minutes ?? 0,
    min_hold_minutes: settings.min_hold_minutes ?? 15,
    max_open_positions: settings.max_open_positions,
    min_volume_ratio: settings.min_volume_ratio ?? 0,
    reentry_cooldown_minutes: settings.reentry_cooldown_minutes ?? 0,
  };
}

/** Mirrors parseSettingsForm constraints for fields brief diffs can touch. */
export function validateBriefFormSlice(slice: BriefFormSlice): string | null {
  if (
    slice.minimum_jev_confidence_pct <= 0 ||
    slice.minimum_jev_confidence_pct > 100
  ) {
    return "Min Jev confidence must be between 1 and 100.";
  }
  if (
    slice.signal_record_threshold_pct <= 0 ||
    slice.signal_record_threshold_pct > 100
  ) {
    return "Signal record threshold must be between 1 and 100.";
  }
  if (slice.signal_record_threshold_pct > slice.minimum_jev_confidence_pct) {
    return "Signal record threshold must be at or below Min Jev confidence.";
  }
  if (slice.stop_loss_pct < 0.1 || slice.stop_loss_pct > 25) {
    return "Stop loss must be between 0.1 and 25.";
  }
  if (slice.take_profit_pct < 0.1 || slice.take_profit_pct > 25) {
    return "Take profit must be between 0.1 and 25.";
  }
  if (slice.take_profit_pct <= slice.stop_loss_pct) {
    return "Take profit must be greater than stop loss.";
  }
  if (
    !Number.isInteger(slice.max_hold_minutes) ||
    slice.max_hold_minutes < 0 ||
    slice.max_hold_minutes > 480
  ) {
    return "Max hold must be a whole number from 0 to 480.";
  }
  if (
    slice.max_hold_minutes > 0 &&
    slice.min_hold_minutes > slice.max_hold_minutes
  ) {
    return "Min hold must be at or below max hold when max hold is on.";
  }
  if (
    !Number.isInteger(slice.max_open_positions) ||
    slice.max_open_positions < 1
  ) {
    return "Max open positions must be at least 1.";
  }
  if (slice.min_volume_ratio < 0 || slice.min_volume_ratio > 5) {
    return "Min volume ratio must be between 0 and 5.";
  }
  if (
    !Number.isInteger(slice.reentry_cooldown_minutes) ||
    slice.reentry_cooldown_minutes < 0 ||
    slice.reentry_cooldown_minutes > 480
  ) {
    return "Re-entry cooldown must be a whole number from 0 to 480.";
  }
  return null;
}
