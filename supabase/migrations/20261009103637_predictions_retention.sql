-- Cap predictions growth: slim old snapshots, delete old rows, run daily via pg_cron.

-- The news_articles list is ~2.7 KB of a ~3 KB snapshot and is copied onto every
--    prediction; the headline, tags, sentiment and every indicator stay, so analytics keep working.
CREATE OR REPLACE FUNCTION public.prune_predictions(
  slim_after_days integer DEFAULT 2,
  delete_after_days integer DEFAULT 30
)
RETURNS TABLE (slimmed bigint, deleted bigint)
LANGUAGE plpgsql
SET search_path = public
SET statement_timeout TO '10min'
AS $$
DECLARE
  batch_count bigint;
  slim_count bigint := 0;
  delete_count bigint;
  -- Whole UTC days only: a session (13:30-20:00 UTC) never straddles the cutoff, so the
  -- session_market_condition rollup is never recomputed from a half-deleted day.
  delete_cutoff timestamptz :=
    (date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => delete_after_days))
    AT TIME ZONE 'UTC';
BEGIN
  LOOP
    UPDATE predictions
    SET market_snapshot = market_snapshot - 'news_articles'
    WHERE id IN (
      SELECT p.id FROM predictions p
      WHERE p.timestamp < now() - make_interval(days => slim_after_days)
        AND p.market_snapshot ? 'news_articles'
      LIMIT 5000
    );
    GET DIAGNOSTICS batch_count = ROW_COUNT;
    EXIT WHEN batch_count = 0;
    slim_count := slim_count + batch_count;
  END LOOP;

  DELETE FROM predictions WHERE timestamp < delete_cutoff;
  GET DIAGNOSTICS delete_count = ROW_COUNT;

  RETURN QUERY SELECT slim_count, delete_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_predictions(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_predictions(integer, integer) TO service_role;

-- Daily at 06:00 UTC (before the US open). Skipped with a notice where pg_cron is unavailable;
-- call public.prune_predictions() by hand or from another scheduler there.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('prune-predictions', '0 6 * * *', 'SELECT * FROM public.prune_predictions()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not scheduled (%): run public.prune_predictions() manually.', SQLERRM;
END $$;
