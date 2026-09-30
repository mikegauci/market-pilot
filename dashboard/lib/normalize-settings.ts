import type { Settings } from "@/lib/types/database";

const PHASE3_DEFAULTS = {
  stale_input_gates_enabled: true,
  max_quote_age_sec: 5,
  kill_stale_quote_sec: 15,
  kill_stale_quote_share_frac: 0.5,
  quote_age_log_only_sec: 300,
  max_signal_age_sec: 30,
  max_bar_gap_sec: 90,
  max_news_pub_age_sec: 3600,
  max_news_receipt_lag_sec: 600,
  pre_submit_recheck_enabled: true,
  max_entry_price_drift_frac: 0.002,
  confirmation_mode: "distinct_bars" as const,
  confirmation_count: 2,
  kill_recover_healthy_sec: 120,
  kill_alert_min_gap_sec: 60,
  jev_transport_fail_rate_kill_frac: 0.5,
  jev_transport_fail_window_sec: 60,
  jev_timeout_sec: 3,
  jev_max_retries: 1,
};

const PHASE4_DEFAULTS = {
  reconcile_interval_sec: 60,
  reconcile_protect_orphans: true,
};

type Phase3Keys = keyof typeof PHASE3_DEFAULTS;
type Phase4Keys = keyof typeof PHASE4_DEFAULTS;

/** Row shape from Supabase before newer columns existed or were selected. */
export type SettingsRow = Omit<
  Settings,
  | "min_share_price"
  | "min_hold_minutes"
  | "jev_sell_exit_threshold"
  | "reentry_cooldown_minutes"
  | "demotion_exits_enabled"
  | "demotion_max_hold_ratio"
  | "demotion_jev_sell_on_loss"
  | "demotion_jev_sell_max_loss_pct"
  | "demotion_force_exit"
  | "watchlist_min_buy"
  | "prediction_horizon_minutes"
  | "last_entry_cutoff_minutes_before_close"
  | "eod_closeout_enabled"
  | "eod_closeout_minutes_before_close"
  | "eod_flat_verify_minutes_before_close"
  | "equity_divergence_alert_frac"
  | Phase3Keys
  | Phase4Keys
> &
  Partial<
    Pick<
      Settings,
      | "min_share_price"
      | "min_hold_minutes"
      | "jev_sell_exit_threshold"
      | "reentry_cooldown_minutes"
      | "demotion_exits_enabled"
      | "demotion_max_hold_ratio"
      | "demotion_jev_sell_on_loss"
      | "demotion_jev_sell_max_loss_pct"
      | "demotion_force_exit"
      | "watchlist_min_buy"
      | "prediction_horizon_minutes"
      | "last_entry_cutoff_minutes_before_close"
      | "eod_closeout_enabled"
      | "eod_closeout_minutes_before_close"
      | "eod_flat_verify_minutes_before_close"
      | "equity_divergence_alert_frac"
      | Phase3Keys
      | Phase4Keys
    >
  >;

/** Apply defaults for settings columns that may be missing on older rows. */
export function normalizeSettings(raw: SettingsRow | null): Settings | null {
  if (!raw) {
    return null;
  }

  const confirmation_mode =
    raw.confirmation_mode === "legacy" || raw.confirmation_mode === "distinct_bars"
      ? raw.confirmation_mode
      : PHASE3_DEFAULTS.confirmation_mode;

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
    prediction_horizon_minutes: raw.prediction_horizon_minutes ?? 15,
    last_entry_cutoff_minutes_before_close:
      raw.last_entry_cutoff_minutes_before_close ?? 40,
    eod_closeout_enabled: raw.eod_closeout_enabled ?? true,
    eod_closeout_minutes_before_close: raw.eod_closeout_minutes_before_close ?? 10,
    eod_flat_verify_minutes_before_close:
      raw.eod_flat_verify_minutes_before_close ?? 5,
    equity_divergence_alert_frac: raw.equity_divergence_alert_frac ?? 0.05,
    stale_input_gates_enabled:
      raw.stale_input_gates_enabled ?? PHASE3_DEFAULTS.stale_input_gates_enabled,
    max_quote_age_sec: raw.max_quote_age_sec ?? PHASE3_DEFAULTS.max_quote_age_sec,
    kill_stale_quote_sec:
      raw.kill_stale_quote_sec ?? PHASE3_DEFAULTS.kill_stale_quote_sec,
    kill_stale_quote_share_frac:
      raw.kill_stale_quote_share_frac ?? PHASE3_DEFAULTS.kill_stale_quote_share_frac,
    quote_age_log_only_sec:
      raw.quote_age_log_only_sec ?? PHASE3_DEFAULTS.quote_age_log_only_sec,
    max_signal_age_sec: raw.max_signal_age_sec ?? PHASE3_DEFAULTS.max_signal_age_sec,
    max_bar_gap_sec: raw.max_bar_gap_sec ?? PHASE3_DEFAULTS.max_bar_gap_sec,
    max_news_pub_age_sec:
      raw.max_news_pub_age_sec ?? PHASE3_DEFAULTS.max_news_pub_age_sec,
    max_news_receipt_lag_sec:
      raw.max_news_receipt_lag_sec ?? PHASE3_DEFAULTS.max_news_receipt_lag_sec,
    pre_submit_recheck_enabled:
      raw.pre_submit_recheck_enabled ?? PHASE3_DEFAULTS.pre_submit_recheck_enabled,
    max_entry_price_drift_frac:
      raw.max_entry_price_drift_frac ?? PHASE3_DEFAULTS.max_entry_price_drift_frac,
    confirmation_mode,
    confirmation_count:
      raw.confirmation_count ?? PHASE3_DEFAULTS.confirmation_count,
    kill_recover_healthy_sec:
      raw.kill_recover_healthy_sec ?? PHASE3_DEFAULTS.kill_recover_healthy_sec,
    kill_alert_min_gap_sec:
      raw.kill_alert_min_gap_sec ?? PHASE3_DEFAULTS.kill_alert_min_gap_sec,
    jev_transport_fail_rate_kill_frac:
      raw.jev_transport_fail_rate_kill_frac ??
      PHASE3_DEFAULTS.jev_transport_fail_rate_kill_frac,
    jev_transport_fail_window_sec:
      raw.jev_transport_fail_window_sec ??
      PHASE3_DEFAULTS.jev_transport_fail_window_sec,
    jev_timeout_sec: raw.jev_timeout_sec ?? PHASE3_DEFAULTS.jev_timeout_sec,
    jev_max_retries: raw.jev_max_retries ?? PHASE3_DEFAULTS.jev_max_retries,
    reconcile_interval_sec:
      raw.reconcile_interval_sec ?? PHASE4_DEFAULTS.reconcile_interval_sec,
    reconcile_protect_orphans:
      raw.reconcile_protect_orphans ?? PHASE4_DEFAULTS.reconcile_protect_orphans,
  };
}
