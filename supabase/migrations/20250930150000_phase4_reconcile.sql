-- Phase 4: reconciliation, client_order_id, protect-or-flatten settings.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS client_order_id text;

CREATE UNIQUE INDEX IF NOT EXISTS trades_client_order_id_unique
  ON trades (client_order_id)
  WHERE client_order_id IS NOT NULL;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS reconcile_interval_sec integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS reconcile_protect_orphans boolean NOT NULL DEFAULT true;

ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_reconcile_interval_sec_check;

ALTER TABLE settings
  ADD CONSTRAINT settings_reconcile_interval_sec_check
    CHECK (reconcile_interval_sec >= 15 AND reconcile_interval_sec <= 600);

UPDATE settings
SET
  reconcile_interval_sec = COALESCE(reconcile_interval_sec, 60),
  reconcile_protect_orphans = COALESCE(reconcile_protect_orphans, true)
WHERE id = 1;

ALTER TABLE bot_status
  ADD COLUMN IF NOT EXISTS last_reconcile_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_ok boolean,
  ADD COLUMN IF NOT EXISTS reconcile_detail text;

CREATE TABLE IF NOT EXISTS reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  symbol text NOT NULL,
  event_type text NOT NULL
    CHECK (event_type = ANY (ARRAY[
      'adopted_protected'::text,
      'adopted_existing_brackets'::text,
      'flattened_unprotected'::text,
      'qty_mismatch'::text,
      'missing_protection'::text,
      'orphan_cancelled'::text,
      'resolved'::text
    ])),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS reconciliation_events_created_at_idx
  ON reconciliation_events (created_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_events_symbol_idx
  ON reconciliation_events (symbol);

ALTER TABLE reconciliation_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON reconciliation_events TO authenticated;

DROP POLICY IF EXISTS "authenticated_select_reconciliation_events"
  ON reconciliation_events;

CREATE POLICY "authenticated_select_reconciliation_events"
  ON reconciliation_events FOR SELECT TO authenticated
  USING (true);
