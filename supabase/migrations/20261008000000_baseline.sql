-- Baseline public schema exported from the live market-pilot project on 2026-10-08.
-- Structure only: no rows. Fresh databases apply this once. Do not edit it after release;
-- later changes go in new files in this folder.
-- Safe to run on an empty Supabase project (extensions, auth, and supabase_realtime already exist).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.prediction_change_5m(snapshot jsonb)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(snapshot->'change_5m') = 'number'
      THEN (snapshot->>'change_5m')::double precision
    WHEN (snapshot->>'change_5m') ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
      THEN (snapshot->>'change_5m')::double precision
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_can_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'dashboard_role') = 'owner',
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.validate_trade_command_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.trades WHERE id = NEW.trade_id AND status = 'open'
    ) THEN
        RAISE EXCEPTION 'trade_not_open';
    END IF;
    RETURN NEW;
END;
$function$;


CREATE TABLE public.bot_status (
  id integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  trading_mode text NOT NULL DEFAULT 'paper'::text,
  ibkr_connected boolean NOT NULL DEFAULT false,
  jev_connected boolean NOT NULL DEFAULT false,
  last_heartbeat timestamp with time zone,
  last_error text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  execution_mode text NOT NULL DEFAULT 'ibkr'::text,
  ibkr_account_id text,
  shutdown_requested boolean NOT NULL DEFAULT false
);

CREATE TABLE public.entry_commands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  quantity numeric,
  command text NOT NULL DEFAULT 'buy'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  reason text NOT NULL DEFAULT 'manual_dashboard'::text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  error text
);

CREATE TABLE public.ibkr_account_profiles (
  account_id text NOT NULL,
  baseline_equity numeric NOT NULL,
  account_capital numeric NOT NULL DEFAULT 1000,
  risk_sync_equity numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.market_news (
  id bigint NOT NULL,
  headline text NOT NULL,
  summary text,
  url text,
  source text,
  image text,
  category text NOT NULL DEFAULT 'general'::text,
  related text,
  related_symbols text[] NOT NULL DEFAULT '{}'::text[],
  published_at timestamp with time zone NOT NULL,
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  sentiment double precision,
  tags text[] NOT NULL DEFAULT '{}'::text[]
);

CREATE TABLE public.market_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  price numeric(18,6),
  bid numeric(18,6),
  ask numeric(18,6),
  spread numeric(18,6),
  volume bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.portfolio_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  balance numeric(18,6) NOT NULL,
  equity numeric(18,6) NOT NULL,
  daily_pnl numeric(18,6) NOT NULL DEFAULT 0,
  total_pnl numeric(18,6) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ibkr_account_id text,
  ibkr_accrued_cash numeric
);

CREATE TABLE public.position_commands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  quantity numeric NOT NULL,
  command text NOT NULL DEFAULT 'cover_short'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  reason text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  error text
);

CREATE TABLE public.positions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  quantity numeric(18,6) NOT NULL,
  avg_cost numeric(18,6) NOT NULL,
  market_price numeric(18,6),
  market_value numeric(18,6),
  unrealized_pnl numeric(18,6),
  currency text NOT NULL DEFAULT 'USD'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.predictions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  price numeric(18,6) NOT NULL,
  buy_probability numeric(5,4) NOT NULL,
  hold_probability numeric(5,4) NOT NULL,
  sell_probability numeric(5,4) NOT NULL,
  market_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  trade_created boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  trade_skip_reason text,
  change_5m_pct double precision GENERATED ALWAYS AS (prediction_change_5m(market_snapshot)) STORED
);

CREATE TABLE public.session_briefs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_date date NOT NULL,
  model text NOT NULL,
  input jsonb NOT NULL,
  brief jsonb NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.session_market_condition_daily (
  session_date date NOT NULL,
  favorable_minutes integer NOT NULL DEFAULT 0,
  caution_minutes integer NOT NULL DEFAULT 0,
  headwind_minutes integer NOT NULL DEFAULT 0,
  unknown_minutes integer NOT NULL DEFAULT 0,
  observed_minutes integer NOT NULL DEFAULT 0,
  headwind_floor double precision NOT NULL DEFAULT '-0.12'::double precision,
  refreshed_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.settings (
  id integer NOT NULL DEFAULT 1,
  trading_mode text NOT NULL DEFAULT 'paper'::text,
  minimum_jev_confidence numeric(5,4) NOT NULL DEFAULT 0.8000,
  signal_record_threshold numeric(5,4) NOT NULL DEFAULT 0.7500,
  risk_per_trade numeric(18,6) NOT NULL DEFAULT 2.50,
  max_position_size numeric(18,6) NOT NULL DEFAULT 250.00,
  max_daily_loss numeric(18,6) NOT NULL DEFAULT 10.00,
  max_open_positions integer NOT NULL DEFAULT 5,
  stop_loss_percentage numeric(8,6) NOT NULL DEFAULT 0.010000,
  take_profit_percentage numeric(8,6) NOT NULL DEFAULT 0.015000,
  account_capital numeric(18,6) NOT NULL DEFAULT 1000.00,
  watchlist text[] NOT NULL DEFAULT ARRAY['SPY'::text, 'QQQ'::text, 'NVDA'::text, 'AAPL'::text, 'MSFT'::text, 'AMD'::text, 'META'::text],
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  risk_sync_equity numeric(18,6),
  risk_profile text NOT NULL DEFAULT 'medium'::text,
  max_hold_minutes numeric(8,2) NOT NULL DEFAULT 0,
  benchmark_symbol text NOT NULL DEFAULT ''::text,
  min_volume_ratio numeric NOT NULL DEFAULT 0,
  min_share_price double precision NOT NULL DEFAULT 20,
  min_hold_minutes numeric NOT NULL DEFAULT 15,
  jev_sell_exit_threshold numeric NOT NULL DEFAULT 0.95,
  reentry_cooldown_minutes numeric NOT NULL DEFAULT 45,
  min_dollar_volume numeric(14,2) NOT NULL DEFAULT 250000,
  confirmation_cycles integer NOT NULL DEFAULT 2,
  confirmation_seconds double precision NOT NULL DEFAULT 30,
  profit_take_enabled boolean NOT NULL DEFAULT false,
  profit_take_min_fraction double precision NOT NULL DEFAULT 0.70,
  profit_take_max_fraction double precision NOT NULL DEFAULT 0.80,
  profit_take_min_band_hits integer NOT NULL DEFAULT 3,
  profit_take_band_window_cycles integer NOT NULL DEFAULT 10,
  profit_take_jev_sell_threshold numeric NOT NULL DEFAULT 0.70,
  watchlist_pool text[] NOT NULL DEFAULT '{}'::text[],
  watchlist_active text[] NOT NULL DEFAULT '{}'::text[],
  watchlist_rotation_enabled boolean NOT NULL DEFAULT true,
  watchlist_active_size integer NOT NULL DEFAULT 12,
  watchlist_rotation_interval_minutes integer NOT NULL DEFAULT 15,
  watchlist_max_swaps_per_rotation integer NOT NULL DEFAULT 2,
  watchlist_last_rotation_note text NOT NULL DEFAULT ''::text,
  watchlist_last_rotation_at timestamp with time zone,
  entry_blocked_symbols text[] NOT NULL DEFAULT '{}'::text[],
  entry_blocked_at jsonb NOT NULL DEFAULT '{}'::jsonb,
  loss_cut_enabled boolean NOT NULL DEFAULT false,
  loss_cut_min_fraction numeric NOT NULL DEFAULT 0.70,
  loss_cut_max_fraction numeric NOT NULL DEFAULT 0.90,
  loss_cut_min_band_hits integer NOT NULL DEFAULT 3,
  loss_cut_band_window_cycles integer NOT NULL DEFAULT 10,
  loss_cut_jev_sell_threshold numeric NOT NULL DEFAULT 0,
  max_entries_per_symbol_per_day integer NOT NULL DEFAULT 3,
  rotation_min_session_change_pct double precision DEFAULT 0,
  watchlist_rotation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  entry_ema_gate text NOT NULL DEFAULT 'ema_20'::text,
  max_rsi double precision NOT NULL DEFAULT 70,
  max_spread_pct double precision NOT NULL DEFAULT 0.0015
);

CREATE TABLE public.symbol_bars (
  id bigint GENERATED ALWAYS AS IDENTITY,
  symbol text NOT NULL,
  bar_size text NOT NULL,
  ts timestamp with time zone NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume bigint NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.symbol_bars_meta (
  symbol text NOT NULL,
  bar_size text NOT NULL,
  last_fetched_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.trade_commands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL,
  command text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  reason text NOT NULL DEFAULT 'manual_dashboard'::text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  error text
);

CREATE TABLE public.trades (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  side text NOT NULL,
  entry_time timestamp with time zone NOT NULL,
  entry_price numeric(18,6) NOT NULL,
  exit_time timestamp with time zone,
  exit_price numeric(18,6),
  quantity numeric(18,6) NOT NULL,
  position_value numeric(18,6) NOT NULL,
  stop_loss numeric(18,6),
  take_profit numeric(18,6),
  gross_pnl numeric(18,6),
  commission numeric(18,6) NOT NULL DEFAULT 0,
  slippage numeric(18,6) NOT NULL DEFAULT 0,
  net_pnl numeric(18,6),
  status text NOT NULL DEFAULT 'open'::text,
  paper_or_live text NOT NULL DEFAULT 'paper'::text,
  jev_buy_probability numeric(5,4),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  ibkr_parent_order_id integer,
  ibkr_sl_order_id integer,
  ibkr_tp_order_id integer,
  execution_mode text NOT NULL DEFAULT 'ibkr'::text,
  exit_reason text,
  ibkr_account_id text
);

ALTER TABLE public.bot_status ADD CONSTRAINT bot_status_pkey PRIMARY KEY (id);
ALTER TABLE public.bot_status ADD CONSTRAINT bot_status_id_check CHECK (id = 1);
ALTER TABLE public.bot_status ADD CONSTRAINT bot_status_trading_mode_check CHECK (trading_mode = ANY (ARRAY['paper'::text, 'live'::text]));
ALTER TABLE public.bot_status ADD CONSTRAINT bot_status_execution_mode_check CHECK (execution_mode = ANY (ARRAY['simulated'::text, 'ibkr'::text]));
ALTER TABLE public.entry_commands ADD CONSTRAINT entry_commands_pkey PRIMARY KEY (id);
ALTER TABLE public.entry_commands ADD CONSTRAINT entry_commands_command_check CHECK (command = 'buy'::text);
ALTER TABLE public.entry_commands ADD CONSTRAINT entry_commands_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]));
ALTER TABLE public.ibkr_account_profiles ADD CONSTRAINT ibkr_account_profiles_pkey PRIMARY KEY (account_id);
ALTER TABLE public.market_news ADD CONSTRAINT market_news_pkey PRIMARY KEY (id);
ALTER TABLE public.market_snapshots ADD CONSTRAINT market_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.portfolio_history ADD CONSTRAINT portfolio_history_pkey PRIMARY KEY (id);
ALTER TABLE public.position_commands ADD CONSTRAINT position_commands_pkey PRIMARY KEY (id);
ALTER TABLE public.position_commands ADD CONSTRAINT position_commands_command_check CHECK (command = 'cover_short'::text);
ALTER TABLE public.position_commands ADD CONSTRAINT position_commands_quantity_check CHECK (quantity > 0::numeric);
ALTER TABLE public.position_commands ADD CONSTRAINT position_commands_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]));
ALTER TABLE public.positions ADD CONSTRAINT positions_pkey PRIMARY KEY (id);
ALTER TABLE public.positions ADD CONSTRAINT positions_symbol_key UNIQUE (symbol);
ALTER TABLE public.predictions ADD CONSTRAINT predictions_pkey PRIMARY KEY (id);
ALTER TABLE public.session_briefs ADD CONSTRAINT session_briefs_pkey PRIMARY KEY (id);
ALTER TABLE public.session_market_condition_daily ADD CONSTRAINT session_market_condition_daily_pkey PRIMARY KEY (session_date);
ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (id);
ALTER TABLE public.settings ADD CONSTRAINT settings_id_check CHECK (id = 1);
ALTER TABLE public.settings ADD CONSTRAINT settings_trading_mode_check CHECK (trading_mode = ANY (ARRAY['paper'::text, 'live'::text]));
ALTER TABLE public.settings ADD CONSTRAINT settings_risk_profile_check CHECK (risk_profile = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]));
ALTER TABLE public.settings ADD CONSTRAINT settings_entry_ema_gate_check CHECK (entry_ema_gate = ANY (ARRAY['off'::text, 'ema_9'::text, 'ema_20'::text]));
ALTER TABLE public.settings ADD CONSTRAINT settings_jev_sell_exit_threshold_check CHECK (jev_sell_exit_threshold >= 0.5 AND jev_sell_exit_threshold <= 1::numeric);
ALTER TABLE public.settings ADD CONSTRAINT settings_min_hold_minutes_check CHECK (min_hold_minutes >= 0::numeric AND min_hold_minutes <= 480::numeric);
ALTER TABLE public.settings ADD CONSTRAINT settings_reentry_cooldown_minutes_check CHECK (reentry_cooldown_minutes >= 0::numeric AND reentry_cooldown_minutes <= 480::numeric);
ALTER TABLE public.settings ADD CONSTRAINT settings_watchlist_active_size_check CHECK (watchlist_active_size >= 1 AND watchlist_active_size <= 20);
ALTER TABLE public.settings ADD CONSTRAINT settings_watchlist_max_swaps_check CHECK (watchlist_max_swaps_per_rotation >= 1 AND watchlist_max_swaps_per_rotation <= 5);
ALTER TABLE public.settings ADD CONSTRAINT settings_watchlist_rotation_interval_check CHECK (watchlist_rotation_interval_minutes >= 5 AND watchlist_rotation_interval_minutes <= 120);
ALTER TABLE public.symbol_bars ADD CONSTRAINT symbol_bars_pkey PRIMARY KEY (id);
ALTER TABLE public.symbol_bars ADD CONSTRAINT symbol_bars_symbol_bar_size_ts_key UNIQUE (symbol, bar_size, ts);
ALTER TABLE public.symbol_bars_meta ADD CONSTRAINT symbol_bars_meta_pkey PRIMARY KEY (symbol, bar_size);
ALTER TABLE public.trades ADD CONSTRAINT trades_pkey PRIMARY KEY (id);
ALTER TABLE public.trades ADD CONSTRAINT trades_side_check CHECK (side = ANY (ARRAY['buy'::text, 'sell'::text]));
ALTER TABLE public.trades ADD CONSTRAINT trades_status_check CHECK (status = ANY (ARRAY['open'::text, 'closed'::text, 'cancelled'::text]));
ALTER TABLE public.trades ADD CONSTRAINT trades_paper_or_live_check CHECK (paper_or_live = ANY (ARRAY['paper'::text, 'live'::text]));
ALTER TABLE public.trades ADD CONSTRAINT trades_execution_mode_check CHECK (execution_mode = ANY (ARRAY['simulated'::text, 'ibkr'::text]));
ALTER TABLE public.trade_commands ADD CONSTRAINT trade_commands_pkey PRIMARY KEY (id);
ALTER TABLE public.trade_commands ADD CONSTRAINT trade_commands_command_check CHECK (command = 'close'::text);
ALTER TABLE public.trade_commands ADD CONSTRAINT trade_commands_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]));
ALTER TABLE public.trade_commands ADD CONSTRAINT trade_commands_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE CASCADE;

CREATE INDEX entry_commands_status_requested_idx ON public.entry_commands USING btree (status, requested_at);
CREATE INDEX market_news_published_at_idx ON public.market_news USING btree (published_at DESC);
CREATE INDEX market_news_url_idx ON public.market_news USING btree (url) WHERE ((url IS NOT NULL) AND (url <> ''::text));
CREATE INDEX market_snapshots_symbol_timestamp_idx ON public.market_snapshots USING btree (symbol, "timestamp" DESC);
CREATE INDEX portfolio_history_account_ts_idx ON public.portfolio_history USING btree (ibkr_account_id, "timestamp" DESC);
CREATE INDEX portfolio_history_timestamp_idx ON public.portfolio_history USING btree ("timestamp" DESC);
CREATE INDEX predictions_symbol_timestamp_idx ON public.predictions USING btree (symbol, "timestamp" DESC);
CREATE INDEX predictions_timestamp_change_5m_idx ON public.predictions USING btree ("timestamp" DESC) WHERE (change_5m_pct IS NOT NULL);
CREATE INDEX session_briefs_session_date_created_at_idx ON public.session_briefs USING btree (session_date DESC, created_at DESC);
CREATE INDEX symbol_bars_symbol_bar_size_ts_idx ON public.symbol_bars USING btree (symbol, bar_size, ts DESC);
CREATE UNIQUE INDEX trade_commands_one_active_per_trade_idx ON public.trade_commands USING btree (trade_id) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));
CREATE INDEX trade_commands_pending_idx ON public.trade_commands USING btree (requested_at) WHERE (status = 'pending'::text);
CREATE INDEX trade_commands_processing_idx ON public.trade_commands USING btree (processed_at) WHERE (status = 'processing'::text);
CREATE INDEX trades_status_idx ON public.trades USING btree (status);
CREATE INDEX trades_symbol_entry_time_idx ON public.trades USING btree (symbol, entry_time DESC);

CREATE OR REPLACE FUNCTION public.compute_session_market_condition_mix(p_since date, p_headwind_floor double precision)
 RETURNS TABLE(session_date date, favorable_minutes integer, caution_minutes integer, headwind_minutes integer, unknown_minutes integer, observed_minutes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT
      ((p_since + TIME '09:30') AT TIME ZONE 'America/New_York') AS ts_lo,
      ((timezone('America/New_York', now())::date + TIME '16:00') AT TIME ZONE 'America/New_York') AS ts_hi
  ),
  benchmark AS (
    SELECT coalesce(nullif(upper(benchmark_symbol), ''), 'EEM') AS sym
    FROM settings
    WHERE id = 1
  ),
  filtered AS (
    SELECT
      p.timestamp,
      upper(p.symbol) AS symbol,
      p.change_5m_pct AS chg
    FROM predictions p
    CROSS JOIN bounds
    CROSS JOIN benchmark b
    WHERE p.timestamp >= bounds.ts_lo
      AND p.timestamp < bounds.ts_hi
      AND p.change_5m_pct IS NOT NULL
      AND upper(p.symbol) IS DISTINCT FROM b.sym
  ),
  scoped AS (
    SELECT
      (timestamp AT TIME ZONE 'America/New_York')::date AS session_date,
      date_trunc('minute', timestamp) AS minute_utc,
      symbol,
      timestamp,
      chg
    FROM filtered
    WHERE (timestamp AT TIME ZONE 'America/New_York')::date >= p_since
      AND (timestamp AT TIME ZONE 'America/New_York')::time >= TIME '09:30'
      AND (timestamp AT TIME ZONE 'America/New_York')::time < TIME '16:00'
  ),
  per_symbol AS (
    SELECT
      session_date,
      minute_utc,
      (array_agg(chg ORDER BY timestamp DESC))[1] AS chg
    FROM scoped
    GROUP BY session_date, minute_utc, symbol
  ),
  minutes AS (
    SELECT
      session_date,
      minute_utc,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY chg) AS med
    FROM per_symbol
    GROUP BY session_date, minute_utc
  ),
  labeled AS (
    SELECT
      session_date,
      CASE
        WHEN med IS NULL THEN 'unknown'
        WHEN med < p_headwind_floor THEN 'headwind'
        WHEN med < 0 THEN 'caution'
        ELSE 'favorable'
      END AS level
    FROM minutes
  )
  SELECT
    session_date,
    count(*) FILTER (WHERE level = 'favorable')::integer AS favorable_minutes,
    count(*) FILTER (WHERE level = 'caution')::integer AS caution_minutes,
    count(*) FILTER (WHERE level = 'headwind')::integer AS headwind_minutes,
    count(*) FILTER (WHERE level = 'unknown')::integer AS unknown_minutes,
    count(*)::integer AS observed_minutes
  FROM labeled
  GROUP BY session_date
  ORDER BY session_date;
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_predictions_per_symbol(row_limit integer DEFAULT 128)
 RETURNS TABLE(id uuid, symbol text, "timestamp" timestamp with time zone, price numeric, buy_probability numeric, hold_probability numeric, sell_probability numeric, trade_created boolean, trade_skip_reason text, created_at timestamp with time zone, market_snapshot jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (p.symbol)
    p.id,
    p.symbol,
    p.timestamp,
    p.price,
    p.buy_probability,
    p.hold_probability,
    p.sell_probability,
    p.trade_created,
    p.trade_skip_reason,
    p.created_at,
    p.market_snapshot
  FROM predictions p
  ORDER BY p.symbol, p.timestamp DESC
  LIMIT GREATEST(row_limit, 1);
$function$;

CREATE OR REPLACE FUNCTION public.get_latest_session_briefs(p_since date DEFAULT '2026-10-02'::date)
 RETURNS SETOF session_briefs
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (session_date) *
  FROM session_briefs
  WHERE session_date >= p_since
  ORDER BY session_date DESC, created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_session_brief_stats(p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH day_preds AS (
    SELECT p.*
    FROM predictions p
    WHERE (p.timestamp AT TIME ZONE 'America/New_York')::date = p_day
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
      dp.trade_skip_reason
    FROM day_preds dp
    WHERE dp.trade_created = false
      AND dp.trade_skip_reason LIKE 'below_trade_threshold%'
    ORDER BY dp.symbol, dp.buy_probability DESC
  ),
  near_misses AS (
    SELECT symbol, buy_probability, trade_skip_reason
    FROM near_misses_ranked
    ORDER BY buy_probability DESC
    LIMIT 10
  ),
  eligible_blocked_ranked AS (
    SELECT DISTINCT ON (dp.symbol)
      dp.symbol,
      dp.buy_probability,
      dp.trade_skip_reason
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
    SELECT symbol, buy_probability, trade_skip_reason
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
            'trade_skip_reason', trade_skip_reason
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
            'trade_skip_reason', trade_skip_reason
          )
          ORDER BY buy_probability DESC
        )
        FROM eligible_blocked
      ),
      '[]'::jsonb
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.latest_prediction_session_date()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (max(timestamp) AT TIME ZONE 'America/New_York')::date
  FROM predictions;
$function$;

CREATE OR REPLACE FUNCTION public.list_prediction_feed_symbols(p_since timestamp with time zone)
 RETURNS TABLE(symbol text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT p.symbol
  FROM predictions p
  WHERE p.timestamp >= p_since
  ORDER BY p.symbol;
$function$;

CREATE OR REPLACE FUNCTION public.list_prediction_session_dates(p_since date DEFAULT '2026-10-02'::date)
 RETURNS TABLE(session_date date, prediction_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    d.session_date,
    count(*)::bigint AS prediction_count
  FROM (
    SELECT (p.timestamp AT TIME ZONE 'America/New_York')::date AS session_date
    FROM predictions p
    WHERE (p.timestamp AT TIME ZONE 'America/New_York')::date >= p_since
  ) d
  GROUP BY d.session_date
  ORDER BY d.session_date DESC;
$function$;

CREATE OR REPLACE FUNCTION public.list_session_market_condition_mix(p_since date DEFAULT '2026-10-02'::date, p_headwind_floor double precision DEFAULT '-0.12'::numeric)
 RETURNS TABLE(session_date date, favorable_minutes integer, caution_minutes integer, headwind_minutes integer, unknown_minutes integer, observed_minutes integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    d.session_date,
    d.favorable_minutes,
    d.caution_minutes,
    d.headwind_minutes,
    d.unknown_minutes,
    d.observed_minutes
  FROM public.session_market_condition_daily d
  WHERE d.session_date >= p_since
    AND abs(d.headwind_floor - p_headwind_floor) < 1e-9
  ORDER BY d.session_date;
$function$;

CREATE OR REPLACE FUNCTION public.prune_stale_market_data(retention_days integer DEFAULT 14)
 RETURNS TABLE(deleted_snapshots bigint, deleted_portfolio_history bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  snap bigint;
  hist bigint;
BEGIN
  DELETE FROM market_snapshots
  WHERE timestamp < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS snap = ROW_COUNT;

  DELETE FROM portfolio_history
  WHERE timestamp < now() - make_interval(days => greatest(retention_days, 90));
  GET DIAGNOSTICS hist = ROW_COUNT;

  deleted_snapshots := snap;
  deleted_portfolio_history := hist;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_session_market_condition_mix(p_since date DEFAULT '2026-10-02'::date, p_headwind_floor double precision DEFAULT '-0.12'::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET statement_timeout TO '45s'
AS $function$
BEGIN
  IF NOT public.dashboard_can_write() THEN
    RETURN;
  END IF;

  INSERT INTO public.session_market_condition_daily (
    session_date,
    favorable_minutes,
    caution_minutes,
    headwind_minutes,
    unknown_minutes,
    observed_minutes,
    headwind_floor,
    refreshed_at
  )
  SELECT
    c.session_date,
    c.favorable_minutes,
    c.caution_minutes,
    c.headwind_minutes,
    c.unknown_minutes,
    c.observed_minutes,
    p_headwind_floor,
    now()
  FROM public.compute_session_market_condition_mix(p_since, p_headwind_floor) AS c
  ON CONFLICT (session_date) DO UPDATE SET
    favorable_minutes = EXCLUDED.favorable_minutes,
    caution_minutes = EXCLUDED.caution_minutes,
    headwind_minutes = EXCLUDED.headwind_minutes,
    unknown_minutes = EXCLUDED.unknown_minutes,
    observed_minutes = EXCLUDED.observed_minutes,
    headwind_floor = EXCLUDED.headwind_floor,
    refreshed_at = EXCLUDED.refreshed_at;
END;
$function$;


CREATE TRIGGER trade_commands_validate_trade
  BEFORE INSERT ON public.trade_commands
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_trade_command_insert();

ALTER TABLE public.bot_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ibkr_account_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_market_condition_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symbol_bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symbol_bars_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_select_bot_status ON public.bot_status FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_update_bot_status ON public.bot_status FOR UPDATE TO authenticated
  USING ((id = 1) AND dashboard_can_write())
  WITH CHECK ((id = 1) AND (trading_mode = 'paper'::text) AND (execution_mode = 'ibkr'::text) AND dashboard_can_write());

CREATE POLICY authenticated_select_entry_commands ON public.entry_commands FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_insert_entry_commands ON public.entry_commands FOR INSERT TO authenticated
  WITH CHECK ((command = 'buy'::text) AND dashboard_can_write());

CREATE POLICY authenticated_select_ibkr_account_profiles ON public.ibkr_account_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_select_market_news ON public.market_news FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_select_market_snapshots ON public.market_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_select_portfolio_history ON public.portfolio_history FOR SELECT TO authenticated USING (true);

CREATE POLICY authenticated_select_position_commands ON public.position_commands FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_insert_position_commands ON public.position_commands FOR INSERT TO authenticated
  WITH CHECK ((command = 'cover_short'::text) AND (quantity > (0)::numeric) AND dashboard_can_write());

CREATE POLICY authenticated_select_positions ON public.positions FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_select_predictions ON public.predictions FOR SELECT TO authenticated USING (true);

CREATE POLICY authenticated_select_session_briefs ON public.session_briefs FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_insert_session_briefs ON public.session_briefs FOR INSERT TO authenticated
  WITH CHECK ((created_by = (SELECT auth.uid() AS uid)) AND dashboard_can_write());

CREATE POLICY authenticated_select_session_market_condition_daily ON public.session_market_condition_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_insert_session_market_condition_daily ON public.session_market_condition_daily FOR INSERT TO authenticated
  WITH CHECK (dashboard_can_write());
CREATE POLICY authenticated_update_session_market_condition_daily ON public.session_market_condition_daily FOR UPDATE TO authenticated
  USING (dashboard_can_write())
  WITH CHECK (dashboard_can_write());

CREATE POLICY authenticated_select_settings ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_update_settings ON public.settings FOR UPDATE TO authenticated
  USING ((id = 1) AND dashboard_can_write())
  WITH CHECK ((id = 1) AND (trading_mode = 'paper'::text) AND dashboard_can_write());

CREATE POLICY authenticated_select_symbol_bars ON public.symbol_bars FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_select_symbol_bars_meta ON public.symbol_bars_meta FOR SELECT TO authenticated USING (true);

CREATE POLICY authenticated_select_trade_commands ON public.trade_commands FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_insert_trade_commands ON public.trade_commands FOR INSERT TO authenticated
  WITH CHECK ((command = 'close'::text) AND dashboard_can_write());

CREATE POLICY authenticated_select_trades ON public.trades FOR SELECT TO authenticated USING (true);


GRANT ALL ON TABLE public.bot_status TO anon, service_role;
GRANT ALL ON TABLE public.entry_commands TO anon, service_role;
GRANT ALL ON TABLE public.ibkr_account_profiles TO anon, service_role;
GRANT ALL ON TABLE public.market_news TO anon, service_role;
GRANT ALL ON TABLE public.market_snapshots TO anon, service_role;
GRANT ALL ON TABLE public.portfolio_history TO anon, service_role;
GRANT ALL ON TABLE public.position_commands TO anon, service_role;
GRANT ALL ON TABLE public.positions TO anon, service_role;
GRANT ALL ON TABLE public.predictions TO anon, service_role;
GRANT ALL ON TABLE public.session_briefs TO anon, service_role;
GRANT ALL ON TABLE public.session_market_condition_daily TO anon, service_role;
GRANT ALL ON TABLE public.settings TO anon, service_role;
GRANT ALL ON TABLE public.symbol_bars TO anon, service_role;
GRANT ALL ON TABLE public.symbol_bars_meta TO anon, service_role;
GRANT ALL ON TABLE public.trade_commands TO anon, service_role;
GRANT ALL ON TABLE public.trades TO anon, service_role;
GRANT ALL ON TABLE public.bot_status TO authenticated;
GRANT ALL ON TABLE public.entry_commands TO authenticated;
GRANT ALL ON TABLE public.position_commands TO authenticated;
GRANT ALL ON TABLE public.session_briefs TO authenticated;
GRANT ALL ON TABLE public.session_market_condition_daily TO authenticated;
GRANT ALL ON TABLE public.settings TO authenticated;
GRANT ALL ON TABLE public.trade_commands TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ibkr_account_profiles FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.ibkr_account_profiles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.market_news FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.market_news TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.market_snapshots FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.market_snapshots TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.portfolio_history FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.portfolio_history TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.positions FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.positions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.predictions FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.predictions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.symbol_bars FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.symbol_bars TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.symbol_bars_meta FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.symbol_bars_meta TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.trades FROM authenticated;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE ON TABLE public.trades TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.compute_session_market_condition_mix(date, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_can_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_latest_predictions_per_symbol(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_latest_session_briefs(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_session_brief_stats(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.latest_prediction_session_date() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_prediction_feed_symbols(timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_prediction_session_dates(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_session_market_condition_mix(date, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prediction_change_5m(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_stale_market_data(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_session_market_condition_mix(date, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_trade_command_insert() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.compute_session_market_condition_mix(date, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_can_write() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_predictions_per_symbol(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_session_briefs(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_session_brief_stats(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.latest_prediction_session_date() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_prediction_feed_symbols(timestamp with time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_prediction_session_dates(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_session_market_condition_mix(date, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prediction_change_5m(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prune_stale_market_data(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_session_market_condition_mix(date, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_trade_command_insert() TO anon, authenticated, service_role;


CREATE TABLE IF NOT EXISTS public.app_migrations (
  filename text PRIMARY KEY,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.app_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_migrations FROM anon, authenticated;
GRANT ALL ON TABLE public.app_migrations TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.bot_status,
  public.market_news,
  public.portfolio_history,
  public.positions,
  public.predictions,
  public.trade_commands,
  public.trades;
