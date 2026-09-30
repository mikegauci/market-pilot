-- Phase 6: decision/execution logging foundation.

CREATE TABLE IF NOT EXISTS config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  config_hash text NOT NULL UNIQUE,
  config jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  symbol text NOT NULL,
  eval_at timestamptz NOT NULL DEFAULT now(),
  config_id uuid REFERENCES config_versions (id),
  prediction_id uuid,
  outcome text NOT NULL
    CHECK (outcome = ANY (ARRAY[
      'trade_created'::text,
      'skipped'::text,
      'error'::text
    ])),
  reasons text[] NOT NULL DEFAULT '{}'::text[],
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS decision_logs_eval_at_idx
  ON decision_logs (eval_at DESC);

CREATE INDEX IF NOT EXISTS decision_logs_symbol_eval_at_idx
  ON decision_logs (symbol, eval_at DESC);

CREATE TABLE IF NOT EXISTS signal_forward_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL UNIQUE,
  symbol text NOT NULL,
  signal_at timestamptz NOT NULL,
  signal_price numeric(18, 6) NOT NULL,
  horizon_minutes integer NOT NULL,
  forward_at timestamptz NOT NULL,
  forward_price numeric(18, 6) NOT NULL,
  forward_return numeric(18, 8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_forward_returns_signal_at_idx
  ON signal_forward_returns (signal_at DESC);

ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS config_id uuid REFERENCES config_versions (id),
  ADD COLUMN IF NOT EXISTS jev_raw jsonb,
  ADD COLUMN IF NOT EXISTS skip_reasons text[],
  ADD COLUMN IF NOT EXISTS decision_bid numeric(18, 6),
  ADD COLUMN IF NOT EXISTS decision_ask numeric(18, 6);

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS config_id uuid REFERENCES config_versions (id),
  ADD COLUMN IF NOT EXISTS decision_price numeric(18, 6),
  ADD COLUMN IF NOT EXISTS fill_bid numeric(18, 6),
  ADD COLUMN IF NOT EXISTS fill_ask numeric(18, 6),
  ADD COLUMN IF NOT EXISTS mae numeric(18, 6),
  ADD COLUMN IF NOT EXISTS mfe numeric(18, 6);

ALTER TABLE config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_forward_returns ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON config_versions TO authenticated;
GRANT SELECT ON decision_logs TO authenticated;
GRANT SELECT ON signal_forward_returns TO authenticated;

DROP POLICY IF EXISTS "authenticated_select_config_versions" ON config_versions;
CREATE POLICY "authenticated_select_config_versions"
  ON config_versions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_select_decision_logs" ON decision_logs;
CREATE POLICY "authenticated_select_decision_logs"
  ON decision_logs FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated_select_signal_forward_returns"
  ON signal_forward_returns;
CREATE POLICY "authenticated_select_signal_forward_returns"
  ON signal_forward_returns FOR SELECT TO authenticated
  USING (true);
