/** Short examples and Strategy links for Settings fields. */

import type { SettingDescriptionKey } from "@/lib/settings-form-descriptions";

export type SettingsFieldMetaKey = SettingDescriptionKey;

/** One-line examples shown under the field description (not live status). */
export const SETTING_FIELD_EXAMPLES: Partial<Record<SettingDescriptionKey, string>> = {
  minimum_jev_confidence: "85 → only buy when Jev BUY is 85% or higher.",
  signal_record_threshold: "80 → log BUY at 80%+ as a near-miss when below your trade bar.",
  confirmation_cycles: "2 → two eligible BUY checks in a row before entry.",
  confirmation_seconds: "30 → eligible BUY must hold 30 seconds (0 = cycle count only).",
  risk_per_trade: "$2,500 → max loss on one trade if the stop hits.",
  max_position_size: "$5,000 → cap cash in a single position.",
  max_daily_loss: "$10,000 → stop new trades after this much loss today.",
  max_open_positions: "6 → at most six open trades at once.",
  stop_loss_percentage: "1% → exit if price falls 1% below entry.",
  take_profit_percentage: "1.5% → exit if price rises 1.5% above entry.",
  profit_take_enabled: "Off → brackets + Jev only; on → optional early exit toward TP.",
  profit_take_min_fraction: "70 → band starts at 70% of the way from entry to take profit.",
  profit_take_max_fraction: "80 → top of the ideal band at 80% toward take profit.",
  profit_take_min_band_hits: "3 → need 3 band touches in the lookback window.",
  profit_take_band_window_cycles: "10 → count touches over the last 10 eval cycles.",
  profit_take_jev_sell_threshold: "70 → also exit on strong Jev SELL in band (0 = off).",
  loss_cut_enabled: "Off → hard stop only; on → optional early exit toward stop.",
  loss_cut_min_fraction: "70 → band starts at 70% of the way from entry to stop.",
  loss_cut_max_fraction: "90 → top of the ideal band at 90% toward stop.",
  loss_cut_min_band_hits: "3 → need 3 band touches in the lookback window.",
  loss_cut_band_window_cycles: "10 → count touches over the last 10 eval cycles.",
  loss_cut_jev_sell_threshold: "0 → off; 70 → also exit on strong Jev SELL in band.",
  max_hold_minutes: "0 → no time cap; use stop, take profit, and Jev SELL.",
  min_hold_minutes: "15 → no Jev SELL exit for the first 15 minutes (stop still applies).",
  jev_sell_exit_threshold: "95 → soft-exit only on very strong Jev SELL.",
  reentry_cooldown_minutes: "45 → no re-entry in the same symbol for 45 minutes after exit.",
  max_entries_per_symbol_per_day: "3 → block a fourth new entry in that symbol today.",
  rotation_min_session_change_pct:
    "0 → rotation favors flat or green since open; blank → ignore day color.",
  min_volume_ratio: "0.5 → need at least half the usual 1m volume vs the last 10 bars.",
  min_share_price: "20 → no entries below $20/share.",
  min_dollar_volume: "250000 → need about $250k avg per 5m bar (0 = off).",
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
  stop_loss_percentage: "risk-caps",
  take_profit_percentage: "risk-caps",
};

export function strategyHelpHref(anchor: string): string {
  return `/strategy#${anchor}`;
}

export function settingFieldExample(key: SettingDescriptionKey): string | null {
  return SETTING_FIELD_EXAMPLES[key] ?? null;
}
