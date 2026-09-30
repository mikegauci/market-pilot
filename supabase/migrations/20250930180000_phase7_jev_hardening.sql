-- Phase 7: Jev integration hardening (gate field, samples, model pin, prediction metadata).

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS jev_gate_field text NOT NULL DEFAULT 'buy_probability',
  ADD COLUMN IF NOT EXISTS jev_model_pin text NULL,
  ADD COLUMN IF NOT EXISTS jev_samples integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS jev_spread_veto_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jev_spread_max_stddev numeric NOT NULL DEFAULT 0.05;

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_jev_gate_field_check,
  DROP CONSTRAINT IF EXISTS settings_jev_samples_check,
  DROP CONSTRAINT IF EXISTS settings_jev_spread_max_stddev_check,
  DROP CONSTRAINT IF EXISTS settings_jev_timeout_sec_check,
  DROP CONSTRAINT IF EXISTS settings_jev_max_retries_check;

-- Clamp existing timeout/retries into Phase 7 ranges before adding tighter CHECKs.
UPDATE settings
SET
  jev_timeout_sec = LEAST(GREATEST(COALESCE(jev_timeout_sec, 2), 0.5), 5),
  jev_max_retries = LEAST(GREATEST(COALESCE(jev_max_retries, 1), 0), 2),
  jev_gate_field = COALESCE(NULLIF(jev_gate_field, ''), 'buy_probability'),
  jev_samples = LEAST(GREATEST(COALESCE(jev_samples, 1), 1), 5),
  jev_spread_veto_enabled = COALESCE(jev_spread_veto_enabled, false),
  jev_spread_max_stddev = LEAST(GREATEST(COALESCE(jev_spread_max_stddev, 0.05), 0), 1);

ALTER TABLE settings
  ALTER COLUMN jev_timeout_sec SET DEFAULT 2,
  ALTER COLUMN jev_max_retries SET DEFAULT 1;

ALTER TABLE settings
  ADD CONSTRAINT settings_jev_gate_field_check
    CHECK (jev_gate_field = ANY (ARRAY['buy_probability'::text, 'confidence'::text])),
  ADD CONSTRAINT settings_jev_samples_check
    CHECK (jev_samples >= 1 AND jev_samples <= 5),
  ADD CONSTRAINT settings_jev_spread_max_stddev_check
    CHECK (jev_spread_max_stddev >= 0 AND jev_spread_max_stddev <= 1),
  ADD CONSTRAINT settings_jev_timeout_sec_check
    CHECK (jev_timeout_sec >= 0.5 AND jev_timeout_sec <= 5),
  ADD CONSTRAINT settings_jev_max_retries_check
    CHECK (jev_max_retries >= 0 AND jev_max_retries <= 2);

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS jev_question_key text,
  ADD COLUMN IF NOT EXISTS jev_request_at timestamptz,
  ADD COLUMN IF NOT EXISTS jev_confidence numeric(18, 8),
  ADD COLUMN IF NOT EXISTS jev_prob_stddev numeric(18, 8),
  ADD COLUMN IF NOT EXISTS jev_samples_used integer;
