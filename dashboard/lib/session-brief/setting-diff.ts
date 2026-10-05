import {
  briefFormSliceFromSettings,
  validateBriefFormSlice,
  type BriefFormSlice,
} from "@/lib/session-brief/brief-form-validation";
import type { SessionBriefSuggestion } from "@/lib/session-brief/schema";
import type { Settings } from "@/lib/types/database";

export const SESSION_BRIEF_SETTING_KEYS = [
  "minimum_jev_confidence",
  "signal_record_threshold",
  "stop_loss_percentage",
  "take_profit_percentage",
  "max_hold_minutes",
  "max_open_positions",
  "min_volume_ratio",
  "reentry_cooldown_minutes",
] as const;

export type SessionBriefSettingKey = (typeof SESSION_BRIEF_SETTING_KEYS)[number];

const SETTING_LABELS: Record<SessionBriefSettingKey, string> = {
  minimum_jev_confidence: "Min Jev confidence",
  signal_record_threshold: "Signal record threshold",
  stop_loss_percentage: "Stop loss",
  take_profit_percentage: "Take profit",
  max_hold_minutes: "Max hold",
  max_open_positions: "Max open positions",
  min_volume_ratio: "Min volume ratio",
  reentry_cooldown_minutes: "Re-entry cooldown",
};

export function sessionBriefSettingLabel(setting: string): string {
  if ((SESSION_BRIEF_SETTING_KEYS as readonly string[]).includes(setting)) {
    return SETTING_LABELS[setting as SessionBriefSettingKey];
  }
  return setting;
}

export type SettingDiff = {
  key: SessionBriefSettingKey;
  label: string;
  direction: "raise" | "lower";
  why: string;
  currentLabel: string;
  proposedLabel: string;
  /** Value the Settings form control should show after Apply. */
  proposed: number;
};

function isSettingKey(value: string): value is SessionBriefSettingKey {
  return (SESSION_BRIEF_SETTING_KEYS as readonly string[]).includes(value);
}

function move(
  current: number,
  direction: "raise" | "lower",
  step: number,
  min: number,
  max: number,
  decimals: number,
): number | null {
  const raw = direction === "raise" ? current + step : current - step;
  const factor = 10 ** decimals;
  const next = Math.round(Math.min(max, Math.max(min, raw)) * factor) / factor;
  if (next === current) return null;
  return next;
}

function percentLabel(value: number): string {
  return `${value}%`;
}

function minutesLabel(value: number): string {
  return value === 0 ? "off" : `${value} min`;
}

function currentValueForKey(slice: BriefFormSlice, key: SessionBriefSettingKey): number {
  switch (key) {
    case "minimum_jev_confidence":
      return slice.minimum_jev_confidence_pct;
    case "signal_record_threshold":
      return slice.signal_record_threshold_pct;
    case "stop_loss_percentage":
      return slice.stop_loss_pct;
    case "take_profit_percentage":
      return slice.take_profit_pct;
    case "max_hold_minutes":
      return slice.max_hold_minutes;
    case "max_open_positions":
      return slice.max_open_positions;
    case "min_volume_ratio":
      return slice.min_volume_ratio;
    case "reentry_cooldown_minutes":
      return slice.reentry_cooldown_minutes;
  }
}

function labelForValue(key: SessionBriefSettingKey, value: number): string {
  switch (key) {
    case "minimum_jev_confidence":
    case "signal_record_threshold":
    case "stop_loss_percentage":
    case "take_profit_percentage":
      return percentLabel(value);
    case "max_hold_minutes":
    case "reentry_cooldown_minutes":
      return minutesLabel(value);
    default:
      return String(value);
  }
}

function proposeStep(
  working: BriefFormSlice,
  key: SessionBriefSettingKey,
  direction: "raise" | "lower",
): number | null {
  switch (key) {
    case "minimum_jev_confidence":
      return move(
        working.minimum_jev_confidence_pct,
        direction,
        1,
        Math.max(1, working.signal_record_threshold_pct),
        99,
        0,
      );
    case "signal_record_threshold":
      return move(
        working.signal_record_threshold_pct,
        direction,
        1,
        1,
        working.minimum_jev_confidence_pct,
        0,
      );
    case "stop_loss_percentage":
      return move(
        working.stop_loss_pct,
        direction,
        0.1,
        0.1,
        Math.max(0.1, working.take_profit_pct - 0.1),
        1,
      );
    case "take_profit_percentage":
      return move(working.take_profit_pct, direction, 0.1, working.stop_loss_pct + 0.1, 20, 1);
    case "max_hold_minutes": {
      const minBound =
        working.min_hold_minutes > 0 && working.max_hold_minutes > 0
          ? working.min_hold_minutes
          : 0;
      return move(working.max_hold_minutes, direction, 5, minBound, 480, 0);
    }
    case "max_open_positions":
      return move(working.max_open_positions, direction, 1, 1, 20, 0);
    case "min_volume_ratio":
      return move(working.min_volume_ratio, direction, 0.1, 0, 5, 1);
    case "reentry_cooldown_minutes":
      return move(working.reentry_cooldown_minutes, direction, 5, 0, 480, 0);
  }
}

function applyToWorking(working: BriefFormSlice, key: SessionBriefSettingKey, value: number): BriefFormSlice {
  switch (key) {
    case "minimum_jev_confidence":
      return { ...working, minimum_jev_confidence_pct: value };
    case "signal_record_threshold":
      return { ...working, signal_record_threshold_pct: value };
    case "stop_loss_percentage":
      return { ...working, stop_loss_pct: value };
    case "take_profit_percentage":
      return { ...working, take_profit_pct: value };
    case "max_hold_minutes":
      return { ...working, max_hold_minutes: value };
    case "max_open_positions":
      return { ...working, max_open_positions: value };
    case "min_volume_ratio":
      return { ...working, min_volume_ratio: value };
    case "reentry_cooldown_minutes":
      return { ...working, reentry_cooldown_minutes: value };
  }
}

export function buildSettingDiffs(
  settings: Settings,
  suggestions: SessionBriefSuggestion[],
): SettingDiff[] {
  const saved = briefFormSliceFromSettings(settings);
  let working = { ...saved };
  const diffs: SettingDiff[] = [];
  const seen = new Set<SessionBriefSettingKey>();

  for (const suggestion of suggestions) {
    if (suggestion.direction !== "raise" && suggestion.direction !== "lower") continue;
    if (!isSettingKey(suggestion.setting) || seen.has(suggestion.setting)) continue;
    const key = suggestion.setting;
    seen.add(key);

    const current = currentValueForKey(working, key);
    const proposed = proposeStep(working, key, suggestion.direction);
    if (proposed == null) continue;

    const nextWorking = applyToWorking(working, key, proposed);
    if (validateBriefFormSlice(nextWorking) !== null) continue;

    diffs.push({
      key,
      label: SETTING_LABELS[key],
      direction: suggestion.direction,
      why: suggestion.why,
      currentLabel: labelForValue(key, current),
      proposedLabel: labelForValue(key, proposed),
      proposed,
    });
    working = nextWorking;
  }

  return diffs;
}
