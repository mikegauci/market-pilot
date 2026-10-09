-- Dashboard/trader performance: predictions is the largest, fastest-growing table.
-- 1. Stop publishing predictions to Realtime (the dashboard only polls it, so every large insert
--    was decoded from the WAL for no subscriber).
-- 2. Index predictions by time alone (feed pages sort and count by timestamp) and drop a duplicate
--    symbol_bars index (the unique index already serves both scan directions).
-- 3. Rewrite get_latest_predictions_per_symbol as an index skip scan: one probe per symbol instead
--    of sorting every prediction ever written.
-- 4. Tighten EXECUTE grants on maintenance functions.
-- (Retention lives in the next migration: 20261009103637_predictions_retention.sql.)

-- 1. Realtime
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'predictions'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.predictions;
  END IF;
END $$;

-- 2. Indexes
CREATE INDEX IF NOT EXISTS predictions_timestamp_idx ON public.predictions (timestamp DESC);
DROP INDEX IF EXISTS public.symbol_bars_symbol_bar_size_ts_idx;

-- 3. Latest prediction per symbol (same signature and result as before, ordered by symbol)
CREATE OR REPLACE FUNCTION public.get_latest_predictions_per_symbol(row_limit integer DEFAULT 128)
RETURNS TABLE (
  id uuid,
  symbol text,
  "timestamp" timestamptz,
  price numeric,
  buy_probability numeric,
  hold_probability numeric,
  sell_probability numeric,
  trade_created boolean,
  trade_skip_reason text,
  created_at timestamptz,
  market_snapshot jsonb
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE symbols AS (
    (SELECT p.symbol FROM predictions p ORDER BY p.symbol LIMIT 1)
    UNION ALL
    SELECT (SELECT p.symbol FROM predictions p WHERE p.symbol > s.symbol ORDER BY p.symbol LIMIT 1)
    FROM symbols s
    WHERE s.symbol IS NOT NULL
  )
  SELECT
    l.id,
    l.symbol,
    l.timestamp,
    l.price,
    l.buy_probability,
    l.hold_probability,
    l.sell_probability,
    l.trade_created,
    l.trade_skip_reason,
    l.created_at,
    l.market_snapshot
  FROM symbols s
  CROSS JOIN LATERAL (
    SELECT p.*
    FROM predictions p
    WHERE p.symbol = s.symbol
    ORDER BY p.timestamp DESC
    LIMIT 1
  ) l
  WHERE s.symbol IS NOT NULL
  ORDER BY l.symbol
  LIMIT GREATEST(row_limit, 1);
$$;

-- 4. Grants: prune_stale_market_data was executable by PUBLIC; refresh already checks
--    dashboard_can_write() inside, so only anon loses access.
REVOKE ALL ON FUNCTION public.prune_stale_market_data(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_stale_market_data(integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.refresh_session_market_condition_mix(date, double precision) FROM anon;
