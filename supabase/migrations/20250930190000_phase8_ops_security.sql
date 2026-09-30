-- Phase 8: owner allowlist RLS, settings audit log.

CREATE TABLE IF NOT EXISTS dashboard_allowed_users (
  user_id uuid PRIMARY KEY,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO dashboard_allowed_users (user_id, email)
VALUES (
  'a580f939-c1ad-4098-9221-b89506cd9291'::uuid,
  'mikegauci@gmail.com'
)
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

CREATE TABLE IF NOT EXISTS settings_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL,
  actor_email text,
  action text NOT NULL,
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  after jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT settings_audit_log_action_check
    CHECK (action = ANY (ARRAY['settings_update'::text, 'bot_toggle'::text]))
);

CREATE INDEX IF NOT EXISTS settings_audit_log_created_at_idx
  ON settings_audit_log (created_at DESC);

ALTER TABLE dashboard_allowed_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings_audit_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON dashboard_allowed_users TO authenticated;
GRANT SELECT, INSERT ON settings_audit_log TO authenticated;

-- Allowlist: users may only see their own row (EXISTS checks work without SECURITY DEFINER).
DROP POLICY IF EXISTS "authenticated_select_own_allowlist" ON dashboard_allowed_users;
CREATE POLICY "authenticated_select_own_allowlist"
  ON dashboard_allowed_users FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Audit log: allowlisted users can read; insert only as self.
DROP POLICY IF EXISTS "authenticated_select_settings_audit_log" ON settings_audit_log;
CREATE POLICY "authenticated_select_settings_audit_log"
  ON settings_audit_log FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_insert_settings_audit_log" ON settings_audit_log;
CREATE POLICY "authenticated_insert_settings_audit_log"
  ON settings_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

-- Helper predicate reused by DROP/CREATE of each policy below:
-- EXISTS (SELECT 1 FROM dashboard_allowed_users WHERE user_id = auth.uid())

DROP POLICY IF EXISTS "authenticated_select_settings" ON settings;
CREATE POLICY "authenticated_select_settings"
  ON settings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_update_settings" ON settings;
CREATE POLICY "authenticated_update_settings"
  ON settings FOR UPDATE TO authenticated
  USING (
    id = 1
    AND EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    id = 1
    AND trading_mode = 'paper'
    AND EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_bot_status" ON bot_status;
CREATE POLICY "authenticated_select_bot_status"
  ON bot_status FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_update_bot_status" ON bot_status;
CREATE POLICY "authenticated_update_bot_status"
  ON bot_status FOR UPDATE TO authenticated
  USING (
    id = 1
    AND EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    id = 1
    AND trading_mode = 'paper'
    AND execution_mode = 'ibkr'
    AND EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_predictions" ON predictions;
CREATE POLICY "authenticated_select_predictions"
  ON predictions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_trades" ON trades;
CREATE POLICY "authenticated_select_trades"
  ON trades FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_positions" ON positions;
CREATE POLICY "authenticated_select_positions"
  ON positions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_portfolio_history" ON portfolio_history;
CREATE POLICY "authenticated_select_portfolio_history"
  ON portfolio_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_market_snapshots" ON market_snapshots;
CREATE POLICY "authenticated_select_market_snapshots"
  ON market_snapshots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_trade_commands" ON trade_commands;
CREATE POLICY "authenticated_select_trade_commands"
  ON trade_commands FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_insert_trade_commands" ON trade_commands;
CREATE POLICY "authenticated_insert_trade_commands"
  ON trade_commands FOR INSERT TO authenticated
  WITH CHECK (
    command = 'close'
    AND EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_reconciliation_events" ON reconciliation_events;
CREATE POLICY "authenticated_select_reconciliation_events"
  ON reconciliation_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_risk_halts" ON risk_halts;
CREATE POLICY "authenticated_select_risk_halts"
  ON risk_halts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_config_versions" ON config_versions;
CREATE POLICY "authenticated_select_config_versions"
  ON config_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_decision_logs" ON decision_logs;
CREATE POLICY "authenticated_select_decision_logs"
  ON decision_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_signal_forward_returns" ON signal_forward_returns;
CREATE POLICY "authenticated_select_signal_forward_returns"
  ON signal_forward_returns FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_em_universe" ON em_universe;
CREATE POLICY "authenticated_select_em_universe"
  ON em_universe FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_market_news" ON market_news;
CREATE POLICY "authenticated_select_market_news"
  ON market_news FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_symbol_bars" ON symbol_bars;
CREATE POLICY "authenticated_select_symbol_bars"
  ON symbol_bars FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_symbol_bars_meta" ON symbol_bars_meta;
CREATE POLICY "authenticated_select_symbol_bars_meta"
  ON symbol_bars_meta FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "authenticated_select_watchlist_screener_history"
  ON watchlist_screener_history;
CREATE POLICY "authenticated_select_watchlist_screener_history"
  ON watchlist_screener_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dashboard_allowed_users dau
      WHERE dau.user_id = (SELECT auth.uid())
    )
  );
