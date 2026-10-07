/** Optional help metadata for Settings fields (examples, skip reasons, Strategy links). */

import type { SettingDescriptionKey } from "@/lib/settings-form-descriptions";

export type SettingsFieldMetaKey = keyof typeof SETTING_FIELD_EXAMPLES;

export const SETTING_FIELD_EXAMPLES = {
  min_volume_ratio:
    "0.5 → skip when the last 1m bar is below half the recent 10-bar average (volume_too_low).",
  max_hold_minutes: "0 → no time cap; rely on bracket stop (1%) and take profit (1.5%).",
  confirmation_cycles: "2 → two eligible BUY eval cycles in a row before entry.",
  reentry_cooldown_minutes: "45 → no new entry in the same symbol for 45 minutes after an exit.",
  max_entries_per_symbol_per_day: "3 → fourth entry attempt that day is blocked (max_entries_per_symbol).",
  rotation_min_session_change_pct:
    "0 → only flat or green vs the 9:30 NY open; blank → rotation session gate off.",
  min_share_price: "20 → skip entries below $20/share.",
  min_dollar_volume: "250000 → skip when 5m dollar volume is below this average.",
} as const;

export type SettingsFieldChip = {
  label: string;
  tone?: "neutral" | "skip";
};

export const SETTING_FIELD_CHIPS: Partial<
  Record<SettingsFieldMetaKey, SettingsFieldChip[]>
> = {
  min_volume_ratio: [{ label: "Skip: volume_too_low", tone: "skip" }],
  max_hold_minutes: [{ label: "0 = brackets + Jev SELL", tone: "neutral" }],
  confirmation_cycles: [{ label: "Repeat eligible BUY", tone: "neutral" }],
  rotation_min_session_change_pct: [{ label: "0 = flat/green vs open", tone: "neutral" }],
};

/** Strategy page subsection anchors (see strategy-guide.tsx). */
export const SETTING_STRATEGY_ANCHORS: Partial<Record<SettingDescriptionKey, string>> = {
  min_volume_ratio: "entry-filters",
  min_share_price: "entry-filters",
  min_dollar_volume: "entry-filters",
  max_hold_minutes: "risk-caps",
  min_hold_minutes: "risk-caps",
  jev_sell_exit_threshold: "risk-caps",
  reentry_cooldown_minutes: "risk-caps",
  max_entries_per_symbol_per_day: "risk-caps",
  rotation_min_session_change_pct: "rotation",
  confirmation_cycles: "jev-signals",
  minimum_jev_confidence: "jev-signals",
};

export function strategyHelpHref(anchor: string): string {
  return `/strategy#${anchor}`;
}
