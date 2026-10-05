import { fractionToDisplayPercent } from "@/lib/strategy-recommendations";
import { confidencePercentFromDecimal } from "@/lib/settings-display";
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

export function buildSettingDiffs(
  settings: Settings,
  suggestions: SessionBriefSuggestion[],
): SettingDiff[] {
  const minConfidencePct = confidencePercentFromDecimal(settings.minimum_jev_confidence);
  const recordPct = confidencePercentFromDecimal(settings.signal_record_threshold);
  const stopPct = fractionToDisplayPercent(settings.stop_loss_percentage);
  const takeProfitPct = fractionToDisplayPercent(settings.take_profit_percentage);
  const diffs: SettingDiff[] = [];
  const seen = new Set<SessionBriefSettingKey>();

  for (const suggestion of suggestions) {
    if (suggestion.direction !== "raise" && suggestion.direction !== "lower") continue;
    if (!isSettingKey(suggestion.setting) || seen.has(suggestion.setting)) continue;
    const direction = suggestion.direction;
    const key = suggestion.setting;
    seen.add(key);

    let proposed: number | null = null;
    let currentLabel = "";
    let proposedLabel = "";

    switch (key) {
      case "minimum_jev_confidence": {
        proposed = move(minConfidencePct, direction, 1, Math.max(1, recordPct), 99, 0);
        currentLabel = percentLabel(minConfidencePct);
        proposedLabel = proposed == null ? "" : percentLabel(proposed);
        break;
      }
      case "signal_record_threshold": {
        proposed = move(recordPct, direction, 1, 1, minConfidencePct, 0);
        currentLabel = percentLabel(recordPct);
        proposedLabel = proposed == null ? "" : percentLabel(proposed);
        break;
      }
      case "stop_loss_percentage": {
        proposed = move(stopPct, direction, 0.1, 0.1, Math.max(0.1, takeProfitPct - 0.1), 1);
        currentLabel = percentLabel(stopPct);
        proposedLabel = proposed == null ? "" : percentLabel(proposed);
        break;
      }
      case "take_profit_percentage": {
        proposed = move(takeProfitPct, direction, 0.1, stopPct + 0.1, 20, 1);
        currentLabel = percentLabel(takeProfitPct);
        proposedLabel = proposed == null ? "" : percentLabel(proposed);
        break;
      }
      case "max_hold_minutes": {
        const current = settings.max_hold_minutes ?? 0;
        proposed = move(current, direction, 5, 0, 480, 0);
        currentLabel = minutesLabel(current);
        proposedLabel = proposed == null ? "" : minutesLabel(proposed);
        break;
      }
      case "max_open_positions": {
        proposed = move(settings.max_open_positions, direction, 1, 1, 20, 0);
        currentLabel = String(settings.max_open_positions);
        proposedLabel = proposed == null ? "" : String(proposed);
        break;
      }
      case "min_volume_ratio": {
        const current = settings.min_volume_ratio ?? 0;
        proposed = move(current, direction, 0.1, 0, 5, 1);
        currentLabel = String(current);
        proposedLabel = proposed == null ? "" : String(proposed);
        break;
      }
      case "reentry_cooldown_minutes": {
        const current = settings.reentry_cooldown_minutes ?? 0;
        proposed = move(current, direction, 5, 0, 480, 0);
        currentLabel = minutesLabel(current);
        proposedLabel = proposed == null ? "" : minutesLabel(proposed);
        break;
      }
    }

    if (proposed == null) continue;
    diffs.push({
      key,
      label: SETTING_LABELS[key],
      direction,
      why: suggestion.why,
      currentLabel,
      proposedLabel,
      proposed,
    });
  }

  return diffs;
}
