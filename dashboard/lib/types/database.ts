export type BotStatus = {
  id: number;
  enabled: boolean;
  trading_mode: "paper" | "live";
  execution_mode: "simulated" | "ibkr";
  ibkr_connected: boolean;
  jev_connected: boolean;
  last_heartbeat: string | null;
  last_error: string | null;
  updated_at: string;
  session_is_open?: boolean | null;
  session_open_at?: string | null;
  session_close_at?: string | null;
  minutes_to_close?: number | null;
  session_clock_error?: string | null;
  eod_flat_verified_at?: string | null;
  eod_flat_verify_ok?: boolean | null;
  eod_flat_verify_detail?: string | null;
  notifier_configured?: boolean | null;
  entry_kill_active?: boolean | null;
  entry_kill_reason?: string | null;
  entry_kill_at?: string | null;
  market_data_type?: number | null;
  quote_age_p50_sec?: number | null;
  quote_age_p95_sec?: number | null;
  last_reconcile_at?: string | null;
  reconcile_ok?: boolean | null;
  reconcile_detail?: string | null;
  daily_pnl?: number | null;
  risk_halt_active?: boolean | null;
  risk_halt_reason?: string | null;
  last_risk_eval_at?: string | null;
};

export type Settings = {
  id: number;
  trading_mode: "paper" | "live";
  minimum_jev_confidence: number;
  signal_record_threshold: number;
  risk_per_trade: number;
  max_position_size: number;
  max_daily_loss: number;
  max_open_positions: number;
  stop_loss_percentage: number;
  take_profit_percentage: number;
  max_hold_minutes: number;
  /** Block Jev SELL soft-exits until the trade has been open this many minutes (0 = off). */
  min_hold_minutes: number;
  /** Minimum Jev SELL probability (0–1) required to soft-exit an open trade. */
  jev_sell_exit_threshold: number;
  /** Block new entries in a symbol for this many minutes after an exit (0 = off). */
  reentry_cooldown_minutes: number;
  /** Aligns with Jev TRADE question horizon (minutes). */
  prediction_horizon_minutes: number;
  /** Block new entries this many minutes before session close. */
  last_entry_cutoff_minutes_before_close: number;
  /** Flatten open positions before the close (must stay true; overnight unsupported). */
  eod_closeout_enabled: boolean;
  eod_closeout_minutes_before_close: number;
  eod_flat_verify_minutes_before_close: number;
  /** Live NetLiq vs account_capital divergence alert threshold (decimal fraction). */
  equity_divergence_alert_frac: number;
  /** Phase 3: stale input / confirmation / kill switches */
  stale_input_gates_enabled: boolean;
  max_quote_age_sec: number;
  kill_stale_quote_sec: number;
  kill_stale_quote_share_frac: number;
  quote_age_log_only_sec: number;
  max_signal_age_sec: number;
  max_bar_gap_sec: number;
  max_news_pub_age_sec: number;
  max_news_receipt_lag_sec: number;
  pre_submit_recheck_enabled: boolean;
  max_entry_price_drift_frac: number;
  confirmation_mode: "legacy" | "distinct_bars";
  confirmation_count: number;
  kill_recover_healthy_sec: number;
  kill_alert_min_gap_sec: number;
  jev_transport_fail_rate_kill_frac: number;
  jev_transport_fail_window_sec: number;
  jev_timeout_sec: number;
  jev_max_retries: number;
  /** Phase 7: which metric gates entries. */
  jev_gate_field: "buy_probability" | "confidence";
  /** When set, request this model instead of the floating default. */
  jev_model_pin: string | null;
  jev_samples: number;
  jev_spread_veto_enabled: boolean;
  jev_spread_max_stddev: number;
  /** Phase 4: IBKR reconcile interval (seconds). */
  reconcile_interval_sec: number;
  /** Place protective brackets on unprotected orphans (else flatten). */
  reconcile_protect_orphans: boolean;
  /** Phase 5: include unrealized MTM in daily-loss. */
  daily_loss_include_unrealized: boolean;
  /** Include fees (use net_pnl) in daily-loss. */
  daily_loss_include_fees: boolean;
  /** block_entries | flatten_and_block */
  daily_loss_action: "block_entries" | "flatten_and_block";
  drawdown_breaker_enabled: boolean;
  drawdown_max_frac: number;
  /** 0 = off; block entries when 1m volume ratio is below this vs 10-bar average */
  min_volume_ratio: number;
  /** 0 = off; block entries / EM scan picks below this USD share price */
  min_share_price: number;
  account_capital: number;
  risk_sync_equity: number | null;
  risk_profile?: "low" | "medium" | "high" | null;
  watchlist: string[];
  watchlist_core: string[];
  watchlist_dynamic_enabled: boolean;
  watchlist_dynamic_size: number;
  /** Minimum Jev BUY (0–1) required to earn a dynamic watchlist slot. */
  watchlist_min_buy: number;
  watchlist_refresh_minutes: number;
  benchmark_symbol: string;
  watchlist_jev_rankings: JevRanking[];
  watchlist_screener_ran_at: string | null;
  demotion_exits_enabled: boolean;
  demotion_max_hold_ratio: number;
  demotion_jev_sell_on_loss: boolean;
  demotion_jev_sell_max_loss_pct: number;
  demotion_force_exit: boolean;
  em_universe_synced_at: string | null;
  em_universe_source: string | null;
  updated_at: string;
};

export type EmUniverseRow = {
  symbol: string;
  name: string;
  source_etfs: string[];
  weight_bps: number;
  country: string | null;
  tradable: boolean;
  instrument_type?: "adr" | "stock" | "etf" | null;
  updated_at: string;
};

export type JevRanking = {
  symbol: string;
  buy: number;
  hold: number;
  sell: number;
  rank: number;
};

export type WatchlistScreenerHistory = {
  id: string;
  ran_at: string;
  rankings: JevRanking[];
  watchlist: string[];
  created_at: string;
};

export type RankingDelta = {
  symbol: string;
  previousRank: number | null;
  currentRank: number;
  delta: number | null;
  buy: number;
};

export type NewsArticleSnapshot = {
  headline: string;
  summary?: string | null;
  url?: string | null;
  source?: string | null;
  published_at?: string | null;
  image?: string | null;
};

export type MarketNewsRow = {
  id: number;
  headline: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  image: string | null;
  category: string;
  related: string | null;
  related_symbols: string[];
  published_at: string;
  fetched_at: string;
  sentiment: number | null;
  tags: string[];
};

export type MarketSnapshotNews = {
  news_sentiment?: number | null;
  news_headline_count?: number | null;
  news_top_headline?: string | null;
  news_tags?: string[] | null;
  news_fetched_at?: string | null;
  news_articles?: NewsArticleSnapshot[] | null;
};

export type MarketSnapshot = MarketSnapshotNews & {
  symbol?: string;
  price?: number;
  change_1m?: number | null;
  change_5m?: number | null;
  change_15m?: number | null;
  volume_ratio?: number | null;
  rsi?: number | null;
  ema_9?: number | null;
  ema_20?: number | null;
  bid?: number | null;
  ask?: number | null;
  spread?: number | null;
  spy_change_5m?: number | null;
  change_1d?: number | null;
  change_5d?: number | null;
  change_1w?: number | null;
  benchmark_change_5m?: number | null;
};

export type Prediction = {
  id: string;
  symbol: string;
  timestamp: string;
  price: number;
  buy_probability: number;
  hold_probability: number;
  sell_probability: number;
  trade_created: boolean;
  trade_skip_reason?: string | null;
  skip_reasons?: string[] | null;
  model?: string | null;
  config_id?: string | null;
  decision_bid?: number | null;
  decision_ask?: number | null;
  jev_question_key?: string | null;
  jev_request_at?: string | null;
  jev_confidence?: number | null;
  jev_prob_stddev?: number | null;
  jev_samples_used?: number | null;
  market_snapshot?: MarketSnapshot | null;
  created_at: string;
};

export type Trade = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entry_time: string;
  entry_price: number;
  exit_time: string | null;
  exit_price: number | null;
  quantity: number;
  position_value: number;
  stop_loss: number | null;
  take_profit: number | null;
  gross_pnl: number | null;
  net_pnl: number | null;
  status: "open" | "closed" | "cancelled";
  paper_or_live: "paper" | "live";
  jev_buy_probability: number | null;
  execution_mode?: "simulated" | "ibkr";
  exit_reason?: string | null;
  config_id?: string | null;
  decision_price?: number | null;
  fill_bid?: number | null;
  fill_ask?: number | null;
  mae?: number | null;
  mfe?: number | null;
  slippage?: number | null;
  commission?: number | null;
  created_at: string;
};

export type TradeCommand = {
  id: string;
  trade_id: string;
  command: "close";
  status: "pending" | "processing" | "completed" | "failed";
  reason: string;
  requested_at: string;
  processed_at: string | null;
  error: string | null;
};

export type Position = {
  id: string;
  symbol: string;
  quantity: number;
  avg_cost: number;
  market_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  currency: string;
  updated_at: string;
};

export type PortfolioSnapshot = {
  id: string;
  timestamp: string;
  balance: number;
  equity: number;
  daily_pnl: number;
  total_pnl: number;
  currency: string;
  created_at: string;
};

export type SymbolBar = {
  id: number;
  symbol: string;
  bar_size: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  created_at: string;
};

export type ChartOverlayLine = {
  price: number;
  color: string;
  label: string;
  lineStyle?: "solid" | "dashed";
};

export type ChartMarker = {
  time: string;
  price: number;
  label?: string;
};
