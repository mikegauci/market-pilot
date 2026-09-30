-- Phase 2: horizon, last-entry cutoff, EOD closeout, session clock on bot_status.
-- Overnight holding is not supported; eod_closeout_enabled must stay true.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS prediction_horizon_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS last_entry_cutoff_minutes_before_close integer NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS eod_closeout_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS eod_closeout_minutes_before_close integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS eod_flat_verify_minutes_before_close integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS equity_divergence_alert_frac numeric NOT NULL DEFAULT 0.05;

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_prediction_horizon_minutes_check,
  DROP CONSTRAINT IF EXISTS settings_last_entry_cutoff_minutes_check,
  DROP CONSTRAINT IF EXISTS settings_eod_closeout_minutes_check,
  DROP CONSTRAINT IF EXISTS settings_eod_flat_verify_minutes_check,
  DROP CONSTRAINT IF EXISTS settings_equity_divergence_alert_frac_check,
  DROP CONSTRAINT IF EXISTS settings_eod_closeout_required_check,
  DROP CONSTRAINT IF EXISTS settings_cutoff_ge_closeout_check,
  DROP CONSTRAINT IF EXISTS settings_flat_verify_lt_closeout_check;

ALTER TABLE settings
  ADD CONSTRAINT settings_prediction_horizon_minutes_check
    CHECK (prediction_horizon_minutes >= 1 AND prediction_horizon_minutes <= 480),
  ADD CONSTRAINT settings_last_entry_cutoff_minutes_check
    CHECK (
      last_entry_cutoff_minutes_before_close >= 1
      AND last_entry_cutoff_minutes_before_close <= 120
    ),
  ADD CONSTRAINT settings_eod_closeout_minutes_check
    CHECK (
      eod_closeout_minutes_before_close >= 5
      AND eod_closeout_minutes_before_close <= 15
    ),
  ADD CONSTRAINT settings_eod_flat_verify_minutes_check
    CHECK (
      eod_flat_verify_minutes_before_close >= 1
      AND eod_flat_verify_minutes_before_close <= 10
    ),
  ADD CONSTRAINT settings_equity_divergence_alert_frac_check
    CHECK (
      equity_divergence_alert_frac >= 0.01
      AND equity_divergence_alert_frac <= 0.50
    ),
  ADD CONSTRAINT settings_eod_closeout_required_check
    CHECK (eod_closeout_enabled = true),
  ADD CONSTRAINT settings_cutoff_ge_closeout_check
    CHECK (
      last_entry_cutoff_minutes_before_close >= eod_closeout_minutes_before_close
    ),
  ADD CONSTRAINT settings_flat_verify_lt_closeout_check
    CHECK (
      eod_flat_verify_minutes_before_close < eod_closeout_minutes_before_close
    );

UPDATE settings
SET
  prediction_horizon_minutes = COALESCE(prediction_horizon_minutes, 15),
  last_entry_cutoff_minutes_before_close = COALESCE(last_entry_cutoff_minutes_before_close, 40),
  eod_closeout_enabled = true,
  eod_closeout_minutes_before_close = COALESCE(eod_closeout_minutes_before_close, 10),
  eod_flat_verify_minutes_before_close = COALESCE(eod_flat_verify_minutes_before_close, 5),
  equity_divergence_alert_frac = COALESCE(equity_divergence_alert_frac, 0.05)
WHERE id = 1;

ALTER TABLE bot_status
  ADD COLUMN IF NOT EXISTS session_is_open boolean,
  ADD COLUMN IF NOT EXISTS session_open_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_close_at timestamptz,
  ADD COLUMN IF NOT EXISTS minutes_to_close numeric,
  ADD COLUMN IF NOT EXISTS session_clock_error text,
  ADD COLUMN IF NOT EXISTS eod_flat_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS eod_flat_verify_ok boolean,
  ADD COLUMN IF NOT EXISTS eod_flat_verify_detail text,
  ADD COLUMN IF NOT EXISTS notifier_configured boolean NOT NULL DEFAULT false;
