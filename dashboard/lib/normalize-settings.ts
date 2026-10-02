import type { Settings } from "@/lib/types/database";

/** Row shape from Supabase before newer columns existed or were selected. */
export type SettingsRow = Omit<
  Settings,
  | "min_share_price"
  | "min_dollar_volume"
  | "min_hold_minutes"
  | "jev_sell_exit_threshold"
  | "reentry_cooldown_minutes"
  | "demotion_exits_enabled"
  | "demotion_max_hold_ratio"
  | "demotion_jev_sell_on_loss"
  | "demotion_jev_sell_max_loss_pct"
  | "demotion_force_exit"
  | "profit_take_enabled"
  | "profit_take_min_fraction"
  | "profit_take_max_fraction"
  | "profit_take_min_band_hits"
  | "profit_take_band_window_cycles"
  | "profit_take_jev_sell_threshold"
  | "watchlist_min_buy"
  | "watchlist_pins"
  | "watchlist_dismissed"
  | "confirmation_cycles"
  | "confirmation_seconds"
> &
  Partial<
    Pick<
      Settings,
      | "min_share_price"
      | "min_dollar_volume"
      | "min_hold_minutes"
      | "jev_sell_exit_threshold"
      | "reentry_cooldown_minutes"
      | "confirmation_cycles"
      | "confirmation_seconds"
      | "demotion_exits_enabled"
      | "demotion_max_hold_ratio"
      | "demotion_jev_sell_on_loss"
      | "demotion_jev_sell_max_loss_pct"
      | "demotion_force_exit"
      | "profit_take_enabled"
      | "profit_take_min_fraction"
      | "profit_take_max_fraction"
      | "profit_take_min_band_hits"
      | "profit_take_band_window_cycles"
      | "profit_take_jev_sell_threshold"
      | "watchlist_min_buy"
      | "watchlist_pins"
      | "watchlist_dismissed"
    >
  >;

/** Apply defaults for settings columns that may be missing on older rows. */
export function normalizeSettings(raw: SettingsRow | null): Settings | null {
  if (!raw) {
    return null;
  }

  return {
    ...raw,
    min_share_price: raw.min_share_price ?? 20,
    min_hold_minutes: raw.min_hold_minutes ?? 15,
    jev_sell_exit_threshold: raw.jev_sell_exit_threshold ?? 0.95,
    reentry_cooldown_minutes: raw.reentry_cooldown_minutes ?? 45,
    demotion_exits_enabled: raw.demotion_exits_enabled ?? true,
    demotion_max_hold_ratio: raw.demotion_max_hold_ratio ?? 0.5,
    demotion_jev_sell_on_loss: raw.demotion_jev_sell_on_loss ?? true,
    demotion_jev_sell_max_loss_pct: raw.demotion_jev_sell_max_loss_pct ?? 0.02,
    demotion_force_exit: raw.demotion_force_exit ?? false,
    profit_take_enabled: raw.profit_take_enabled ?? false,
    profit_take_min_fraction: raw.profit_take_min_fraction ?? 0.7,
    profit_take_max_fraction: raw.profit_take_max_fraction ?? 0.8,
    profit_take_min_band_hits: raw.profit_take_min_band_hits ?? 3,
    profit_take_band_window_cycles: raw.profit_take_band_window_cycles ?? 10,
    profit_take_jev_sell_threshold: raw.profit_take_jev_sell_threshold ?? 0.7,
    watchlist_min_buy: raw.watchlist_min_buy ?? 0.6,
    watchlist_pins: raw.watchlist_pins ?? [],
    watchlist_dismissed: raw.watchlist_dismissed ?? [],
    min_dollar_volume: raw.min_dollar_volume ?? 250_000,
    confirmation_cycles: raw.confirmation_cycles ?? 2,
    confirmation_seconds: raw.confirmation_seconds ?? 30,
  };
}
