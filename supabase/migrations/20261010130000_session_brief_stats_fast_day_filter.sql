-- Speed up get_session_brief_stats: the day filter cast the timestamp, which forced a
-- full scan of predictions (~7s, over the 8s authenticated timeout under load). Use a
-- range on the indexed timestamp and carry only the columns the stats need.

CREATE OR REPLACE FUNCTION public.get_session_brief_stats(p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH day_preds AS (
    SELECT p.symbol, p.buy_probability, p.trade_skip_reason, p.trade_created,
           p.timestamp, p.price
    FROM predictions p
    WHERE p.timestamp >= (p_day::timestamp AT TIME ZONE 'America/New_York')
      AND p.timestamp < ((p_day + 1)::timestamp AT TIME ZONE 'America/New_York')
  ),
  totals AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE trade_created)::bigint AS traded
    FROM day_preds
  ),
  skip_counts AS (
    SELECT
      CASE
        WHEN trade_skip_reason LIKE 'awaiting_confirmation%' THEN 'awaiting_confirmation'
        ELSE split_part(trade_skip_reason, ' ', 1)
      END AS reason_key,
      count(*)::bigint AS cnt
    FROM day_preds
    WHERE trade_created = false
      AND trade_skip_reason IS NOT NULL
    GROUP BY 1
  ),
  near_misses_ranked AS (
    SELECT DISTINCT ON (dp.symbol)
      dp.symbol,
      dp.buy_probability,
      dp.trade_skip_reason,
      dp.timestamp AS pred_ts,
      dp.price AS pred_price
    FROM day_preds dp
    WHERE dp.trade_created = false
      AND dp.trade_skip_reason LIKE 'below_trade_threshold%'
    ORDER BY dp.symbol, dp.buy_probability DESC
  ),
  near_misses AS (
    SELECT symbol, buy_probability, trade_skip_reason, pred_ts, pred_price
    FROM near_misses_ranked
    ORDER BY buy_probability DESC
    LIMIT 10
  ),
  eligible_blocked_ranked AS (
    SELECT DISTINCT ON (dp.symbol)
      dp.symbol,
      dp.buy_probability,
      dp.trade_skip_reason,
      dp.timestamp AS pred_ts,
      dp.price AS pred_price
    FROM day_preds dp
    WHERE dp.trade_created = false
      AND dp.trade_skip_reason IS NOT NULL
      AND NOT (
        dp.trade_skip_reason LIKE 'below_trade_threshold%'
        OR dp.trade_skip_reason LIKE 'buy_hold_margin%'
        OR dp.trade_skip_reason LIKE 'hold_dominant%'
        OR dp.trade_skip_reason LIKE 'sell_dominant%'
        OR dp.trade_skip_reason LIKE 'signal_not_eligible%'
        OR dp.trade_skip_reason LIKE 'awaiting_confirmation%'
      )
    ORDER BY dp.symbol, dp.buy_probability DESC
  ),
  eligible_blocked AS (
    SELECT symbol, buy_probability, trade_skip_reason, pred_ts, pred_price
    FROM eligible_blocked_ranked
    ORDER BY buy_probability DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'total', (SELECT total FROM totals),
    'traded', (SELECT traded FROM totals),
    'skip_reasons', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('reason', reason_key, 'count', cnt)
          ORDER BY cnt DESC
        )
        FROM skip_counts
      ),
      '[]'::jsonb
    ),
    'near_misses', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'symbol', symbol,
            'buy_probability', buy_probability,
            'trade_skip_reason', trade_skip_reason,
            'ts', pred_ts,
            'price', pred_price
          )
          ORDER BY buy_probability DESC
        )
        FROM near_misses
      ),
      '[]'::jsonb
    ),
    'eligible_blocked', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'symbol', symbol,
            'buy_probability', buy_probability,
            'trade_skip_reason', trade_skip_reason,
            'ts', pred_ts,
            'price', pred_price
          )
          ORDER BY buy_probability DESC
        )
        FROM eligible_blocked
      ),
      '[]'::jsonb
    )
  );
$function$;
