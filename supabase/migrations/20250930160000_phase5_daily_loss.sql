-- Phase 5: daily-loss definition, risk_halts, drawdown breaker (default off).

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS daily_loss_include_unrealized boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_loss_include_fees boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_loss_action text NOT NULL DEFAULT 'block_entries',
  ADD COLUMN IF NOT EXISTS drawdown_breaker_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drawdown_max_frac numeric(8, 6) NOT NULL DEFAULT 0.10;

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_daily_loss_action_check;

ALTER TABLE settings
  ADD CONSTRAINT settings_daily_loss_action_check
    CHECK (daily_loss_action = ANY (ARRAY[
      'block_entries'::text,
      'flatten_and_block'::text
    ]));

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_drawdown_max_frac_check;

ALTER TABLE settings
  ADD CONSTRAINT settings_drawdown_max_frac_check
    CHECK (drawdown_max_frac >= 0.01 AND drawdown_max_frac <= 0.50);

UPDATE settings
SET
  daily_loss_include_unrealized = COALESCE(daily_loss_include_unrealized, true),
  daily_loss_include_fees = COALESCE(daily_loss_include_fees, false),
  daily_loss_action = COALESCE(daily_loss_action, 'block_entries'),
  drawdown_breaker_enabled = COALESCE(drawdown_breaker_enabled, false),
  drawdown_max_frac = COALESCE(drawdown_max_frac, 0.10)
WHERE id = 1;

ALTER TABLE bot_status
  ADD COLUMN IF NOT EXISTS daily_pnl numeric(18, 6),
  ADD COLUMN IF NOT EXISTS risk_halt_active boolean,
  ADD COLUMN IF NOT EXISTS risk_halt_reason text,
  ADD COLUMN IF NOT EXISTS last_risk_eval_at timestamptz;

CREATE TABLE IF NOT EXISTS risk_halts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  trading_date date NOT NULL,
  halt_type text NOT NULL
    CHECK (halt_type = ANY (ARRAY[
      'daily_loss'::text,
      'drawdown'::text
    ])),
  action_taken text NOT NULL DEFAULT 'block_entries',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  cleared_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS risk_halts_active_unique
  ON risk_halts (trading_date, halt_type)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS risk_halts_trading_date_idx
  ON risk_halts (trading_date DESC);

ALTER TABLE risk_halts ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON risk_halts TO authenticated;

DROP POLICY IF EXISTS "authenticated_select_risk_halts" ON risk_halts;

CREATE POLICY "authenticated_select_risk_halts"
  ON risk_halts FOR SELECT TO authenticated
  USING (true);
