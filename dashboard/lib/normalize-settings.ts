import type { Settings } from "@/lib/types/database";

/** Row shape from Supabase before demotion columns existed or were selected. */
export type SettingsRow = Omit<
  Settings,
  | "min_share_price"
  | "demotion_exits_enabled"
  | "demotion_max_hold_ratio"
  | "demotion_jev_sell_on_loss"
  | "demotion_jev_sell_max_loss_pct"
  | "demotion_force_exit"
> &
  Partial<
    Pick<
      Settings,
      | "min_share_price"
      | "demotion_exits_enabled"
      | "demotion_max_hold_ratio"
      | "demotion_jev_sell_on_loss"
      | "demotion_jev_sell_max_loss_pct"
      | "demotion_force_exit"
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
    demotion_exits_enabled: raw.demotion_exits_enabled ?? true,
    demotion_max_hold_ratio: raw.demotion_max_hold_ratio ?? 0.5,
    demotion_jev_sell_on_loss: raw.demotion_jev_sell_on_loss ?? true,
    demotion_jev_sell_max_loss_pct: raw.demotion_jev_sell_max_loss_pct ?? 0.02,
    demotion_force_exit: raw.demotion_force_exit ?? false,
  };
}
