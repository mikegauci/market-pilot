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
  | "watchlist_min_buy"
  | "watchlist_pins"
  | "watchlist_dismissed"
> &
  Partial<
    Pick<
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
    watchlist_min_buy: raw.watchlist_min_buy ?? 0.6,
    watchlist_pins: raw.watchlist_pins ?? [],
    watchlist_dismissed: raw.watchlist_dismissed ?? [],
    min_dollar_volume: raw.min_dollar_volume ?? 250_000,
  };
}
