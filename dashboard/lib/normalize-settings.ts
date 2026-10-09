import { DEFAULT_ENTRY_EMA_GATE, normalizeEntryEmaGate } from "@/lib/entry-ema-gate";
import type { Settings } from "@/lib/types/database";
import { normalizeWatchlistRotationHistory } from "@/lib/watchlist-rotation-history";

/** Row shape from Supabase before newer columns existed or were selected. */
export type SettingsRow = Omit<
  Settings,
  | "min_share_price"
  | "min_dollar_volume"
  | "min_hold_minutes"
  | "jev_sell_exit_threshold"
  | "reentry_cooldown_minutes"
  | "max_entries_per_symbol_per_day"
  | "entry_ema_gate"
  | "max_rsi"
  | "max_spread_pct"
  | "rotation_min_session_change_pct"
  | "profit_take_enabled"
  | "profit_take_min_fraction"
  | "profit_take_max_fraction"
  | "profit_take_min_band_hits"
  | "profit_take_band_window_cycles"
  | "profit_take_jev_sell_threshold"
  | "loss_cut_enabled"
  | "loss_cut_min_fraction"
  | "loss_cut_max_fraction"
  | "loss_cut_min_band_hits"
  | "loss_cut_band_window_cycles"
  | "loss_cut_jev_sell_threshold"
  | "confirmation_cycles"
  | "confirmation_seconds"
  | "watchlist_pool"
  | "watchlist_active"
  | "watchlist_rotation_enabled"
  | "watchlist_active_size"
  | "watchlist_rotation_interval_minutes"
  | "watchlist_max_swaps_per_rotation"
  | "watchlist_last_rotation_note"
  | "watchlist_rotation_history"
  | "entry_blocked_symbols"
  | "entry_blocked_at"
  | "breakout_enabled"
  | "breakout_max_rsi"
  | "breakout_window_minutes"
  | "breakout_max_promotions_per_cycle"
  | "breakout_lookback_minutes"
  | "breakout_min_volume_ratio"
  | "breakout_min_change_5m_pct"
> &
  Partial<
    Pick<
      Settings,
      | "min_share_price"
      | "min_dollar_volume"
      | "min_hold_minutes"
      | "jev_sell_exit_threshold"
      | "reentry_cooldown_minutes"
      | "max_entries_per_symbol_per_day"
      | "entry_ema_gate"
      | "max_rsi"
      | "max_spread_pct"
      | "rotation_min_session_change_pct"
      | "confirmation_cycles"
      | "confirmation_seconds"
      | "profit_take_enabled"
      | "profit_take_min_fraction"
      | "profit_take_max_fraction"
      | "profit_take_min_band_hits"
      | "profit_take_band_window_cycles"
      | "profit_take_jev_sell_threshold"
      | "loss_cut_enabled"
      | "loss_cut_min_fraction"
      | "loss_cut_max_fraction"
      | "loss_cut_min_band_hits"
      | "loss_cut_band_window_cycles"
      | "loss_cut_jev_sell_threshold"
      | "watchlist_pool"
      | "watchlist_active"
      | "watchlist_rotation_enabled"
      | "watchlist_active_size"
      | "watchlist_rotation_interval_minutes"
      | "watchlist_max_swaps_per_rotation"
      | "watchlist_last_rotation_note"
      | "watchlist_rotation_history"
      | "entry_blocked_symbols"
      | "entry_blocked_at"
      | "breakout_enabled"
      | "breakout_max_rsi"
      | "breakout_window_minutes"
      | "breakout_max_promotions_per_cycle"
      | "breakout_lookback_minutes"
      | "breakout_min_volume_ratio"
      | "breakout_min_change_5m_pct"
    >
  >;

/** Apply defaults for settings columns that may be missing on older rows. */
export function normalizeSettings(raw: SettingsRow | null): Settings | null {
  if (!raw) {
    return null;
  }

  return {
    ...raw,
    entry_ema_gate: normalizeEntryEmaGate(raw.entry_ema_gate ?? DEFAULT_ENTRY_EMA_GATE),
    max_rsi: raw.max_rsi ?? 70,
    max_spread_pct: raw.max_spread_pct ?? 0.0015,
    min_share_price: raw.min_share_price ?? 20,
    min_hold_minutes: raw.min_hold_minutes ?? 15,
    jev_sell_exit_threshold: raw.jev_sell_exit_threshold ?? 0.95,
    reentry_cooldown_minutes: raw.reentry_cooldown_minutes ?? 45,
    max_entries_per_symbol_per_day: raw.max_entries_per_symbol_per_day ?? 3,
    rotation_min_session_change_pct:
      raw.rotation_min_session_change_pct !== undefined
        ? (raw.rotation_min_session_change_pct ?? null)
        : 0,
    profit_take_enabled: raw.profit_take_enabled ?? false,
    profit_take_min_fraction: raw.profit_take_min_fraction ?? 0.7,
    profit_take_max_fraction: raw.profit_take_max_fraction ?? 0.8,
    profit_take_min_band_hits: raw.profit_take_min_band_hits ?? 3,
    profit_take_band_window_cycles: raw.profit_take_band_window_cycles ?? 10,
    profit_take_jev_sell_threshold: raw.profit_take_jev_sell_threshold ?? 0.7,
    loss_cut_enabled: raw.loss_cut_enabled ?? false,
    loss_cut_min_fraction: raw.loss_cut_min_fraction ?? 0.7,
    loss_cut_max_fraction: raw.loss_cut_max_fraction ?? 0.9,
    loss_cut_min_band_hits: raw.loss_cut_min_band_hits ?? 3,
    loss_cut_band_window_cycles: raw.loss_cut_band_window_cycles ?? 10,
    loss_cut_jev_sell_threshold: raw.loss_cut_jev_sell_threshold ?? 0,
    min_dollar_volume: raw.min_dollar_volume ?? 250_000,
    confirmation_cycles: raw.confirmation_cycles ?? 2,
    confirmation_seconds: raw.confirmation_seconds ?? 30,
    benchmark_symbol: raw.benchmark_symbol ?? "",
    watchlist: raw.watchlist ?? [],
    watchlist_pool: raw.watchlist_pool ?? [],
    watchlist_active: raw.watchlist_active ?? [],
    watchlist_rotation_enabled: raw.watchlist_rotation_enabled ?? false,
    watchlist_active_size: raw.watchlist_active_size ?? 12,
    watchlist_rotation_interval_minutes: raw.watchlist_rotation_interval_minutes ?? 15,
    watchlist_max_swaps_per_rotation: raw.watchlist_max_swaps_per_rotation ?? 2,
    breakout_enabled: raw.breakout_enabled ?? true,
    breakout_max_rsi: raw.breakout_max_rsi ?? 82,
    breakout_window_minutes: raw.breakout_window_minutes ?? 10,
    breakout_max_promotions_per_cycle: raw.breakout_max_promotions_per_cycle ?? 2,
    breakout_lookback_minutes: raw.breakout_lookback_minutes ?? 10,
    breakout_min_volume_ratio: raw.breakout_min_volume_ratio ?? 1.5,
    breakout_min_change_5m_pct: raw.breakout_min_change_5m_pct ?? 0.15,
    watchlist_last_rotation_note: raw.watchlist_last_rotation_note ?? "",
    watchlist_rotation_history: normalizeWatchlistRotationHistory(
      raw.watchlist_rotation_history,
    ),
    entry_blocked_symbols: (raw.entry_blocked_symbols ?? []).map((symbol) =>
      symbol.toUpperCase(),
    ),
    entry_blocked_at: normalizeEntryBlockedAtRecord(raw.entry_blocked_at),
  };
}

function normalizeEntryBlockedAtRecord(
  raw: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const symbol = key.trim().toUpperCase();
    if (!symbol || !value) continue;
    out[symbol] = value;
  }
  return out;
}
