-- Phase 3: fresh inputs, confirmation_count, kill switches, market data type.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS stale_input_gates_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_quote_age_sec integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS kill_stale_quote_sec integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS kill_stale_quote_share_frac numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS quote_age_log_only_sec integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS max_signal_age_sec integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_bar_gap_sec integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS max_news_pub_age_sec integer NOT NULL DEFAULT 3600,
  ADD COLUMN IF NOT EXISTS max_news_receipt_lag_sec integer NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS pre_submit_recheck_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_entry_price_drift_frac numeric NOT NULL DEFAULT 0.002,
  ADD COLUMN IF NOT EXISTS confirmation_mode text NOT NULL DEFAULT 'distinct_bars',
  ADD COLUMN IF NOT EXISTS confirmation_count integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS kill_recover_healthy_sec integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS kill_alert_min_gap_sec integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS jev_transport_fail_rate_kill_frac numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS jev_transport_fail_window_sec integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS jev_timeout_sec numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS jev_max_retries integer NOT NULL DEFAULT 1;

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_max_quote_age_sec_check,
  DROP CONSTRAINT IF EXISTS settings_kill_stale_quote_sec_check,
  DROP CONSTRAINT IF EXISTS settings_kill_stale_quote_share_frac_check,
  DROP CONSTRAINT IF EXISTS settings_quote_age_log_only_sec_check,
  DROP CONSTRAINT IF EXISTS settings_max_signal_age_sec_check,
  DROP CONSTRAINT IF EXISTS settings_max_bar_gap_sec_check,
  DROP CONSTRAINT IF EXISTS settings_max_news_pub_age_sec_check,
  DROP CONSTRAINT IF EXISTS settings_max_news_receipt_lag_sec_check,
  DROP CONSTRAINT IF EXISTS settings_max_entry_price_drift_frac_check,
  DROP CONSTRAINT IF EXISTS settings_confirmation_mode_check,
  DROP CONSTRAINT IF EXISTS settings_confirmation_count_check,
  DROP CONSTRAINT IF EXISTS settings_kill_recover_healthy_sec_check,
  DROP CONSTRAINT IF EXISTS settings_kill_alert_min_gap_sec_check,
  DROP CONSTRAINT IF EXISTS settings_jev_transport_fail_rate_kill_frac_check,
  DROP CONSTRAINT IF EXISTS settings_jev_transport_fail_window_sec_check,
  DROP CONSTRAINT IF EXISTS settings_jev_timeout_sec_check,
  DROP CONSTRAINT IF EXISTS settings_jev_max_retries_check,
  DROP CONSTRAINT IF EXISTS settings_kill_stale_ge_quote_age_check;

ALTER TABLE settings
  ADD CONSTRAINT settings_max_quote_age_sec_check
    CHECK (max_quote_age_sec >= 2 AND max_quote_age_sec <= 30),
  ADD CONSTRAINT settings_kill_stale_quote_sec_check
    CHECK (kill_stale_quote_sec >= 5 AND kill_stale_quote_sec <= 60),
  ADD CONSTRAINT settings_kill_stale_quote_share_frac_check
    CHECK (kill_stale_quote_share_frac >= 0.1 AND kill_stale_quote_share_frac <= 1.0),
  ADD CONSTRAINT settings_quote_age_log_only_sec_check
    CHECK (quote_age_log_only_sec >= 0 AND quote_age_log_only_sec <= 3600),
  ADD CONSTRAINT settings_max_signal_age_sec_check
    CHECK (max_signal_age_sec >= 5 AND max_signal_age_sec <= 120),
  ADD CONSTRAINT settings_max_bar_gap_sec_check
    CHECK (max_bar_gap_sec >= 60 AND max_bar_gap_sec <= 300),
  ADD CONSTRAINT settings_max_news_pub_age_sec_check
    CHECK (max_news_pub_age_sec >= 300 AND max_news_pub_age_sec <= 86400),
  ADD CONSTRAINT settings_max_news_receipt_lag_sec_check
    CHECK (max_news_receipt_lag_sec >= 60 AND max_news_receipt_lag_sec <= 3600),
  ADD CONSTRAINT settings_max_entry_price_drift_frac_check
    CHECK (max_entry_price_drift_frac >= 0.0005 AND max_entry_price_drift_frac <= 0.02),
  ADD CONSTRAINT settings_confirmation_mode_check
    CHECK (confirmation_mode = ANY (ARRAY['legacy'::text, 'distinct_bars'::text])),
  ADD CONSTRAINT settings_confirmation_count_check
    CHECK (confirmation_count >= 1 AND confirmation_count <= 5),
  ADD CONSTRAINT settings_kill_recover_healthy_sec_check
    CHECK (kill_recover_healthy_sec >= 30 AND kill_recover_healthy_sec <= 600),
  ADD CONSTRAINT settings_kill_alert_min_gap_sec_check
    CHECK (kill_alert_min_gap_sec >= 0 AND kill_alert_min_gap_sec <= 600),
  ADD CONSTRAINT settings_jev_transport_fail_rate_kill_frac_check
    CHECK (jev_transport_fail_rate_kill_frac >= 0.1 AND jev_transport_fail_rate_kill_frac <= 1.0),
  ADD CONSTRAINT settings_jev_transport_fail_window_sec_check
    CHECK (jev_transport_fail_window_sec >= 30 AND jev_transport_fail_window_sec <= 600),
  ADD CONSTRAINT settings_jev_timeout_sec_check
    CHECK (jev_timeout_sec >= 1 AND jev_timeout_sec <= 30),
  ADD CONSTRAINT settings_jev_max_retries_check
    CHECK (jev_max_retries >= 0 AND jev_max_retries <= 3),
  ADD CONSTRAINT settings_kill_stale_ge_quote_age_check
    CHECK (kill_stale_quote_sec >= max_quote_age_sec);

UPDATE settings
SET
  stale_input_gates_enabled = COALESCE(stale_input_gates_enabled, true),
  max_quote_age_sec = COALESCE(max_quote_age_sec, 5),
  kill_stale_quote_sec = COALESCE(kill_stale_quote_sec, 15),
  kill_stale_quote_share_frac = COALESCE(kill_stale_quote_share_frac, 0.5),
  quote_age_log_only_sec = COALESCE(quote_age_log_only_sec, 300),
  max_signal_age_sec = COALESCE(max_signal_age_sec, 30),
  max_bar_gap_sec = COALESCE(max_bar_gap_sec, 90),
  max_news_pub_age_sec = COALESCE(max_news_pub_age_sec, 3600),
  max_news_receipt_lag_sec = COALESCE(max_news_receipt_lag_sec, 600),
  pre_submit_recheck_enabled = COALESCE(pre_submit_recheck_enabled, true),
  max_entry_price_drift_frac = COALESCE(max_entry_price_drift_frac, 0.002),
  confirmation_mode = COALESCE(confirmation_mode, 'distinct_bars'),
  confirmation_count = COALESCE(confirmation_count, 2),
  kill_recover_healthy_sec = COALESCE(kill_recover_healthy_sec, 120),
  kill_alert_min_gap_sec = COALESCE(kill_alert_min_gap_sec, 60),
  jev_transport_fail_rate_kill_frac = COALESCE(jev_transport_fail_rate_kill_frac, 0.5),
  jev_transport_fail_window_sec = COALESCE(jev_transport_fail_window_sec, 60),
  jev_timeout_sec = COALESCE(jev_timeout_sec, 3),
  jev_max_retries = COALESCE(jev_max_retries, 1)
WHERE id = 1;

ALTER TABLE bot_status
  ADD COLUMN IF NOT EXISTS entry_kill_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS entry_kill_reason text,
  ADD COLUMN IF NOT EXISTS entry_kill_at timestamptz,
  ADD COLUMN IF NOT EXISTS market_data_type integer,
  ADD COLUMN IF NOT EXISTS quote_age_p50_sec numeric,
  ADD COLUMN IF NOT EXISTS quote_age_p95_sec numeric;
