export type BotStatus = {
  id: number;
  enabled: boolean;
  trading_mode: "paper" | "live";
  execution_mode: "simulated" | "ibkr";
  ibkr_connected: boolean;
  jev_connected: boolean;
  /** IBKR account id for the current session (e.g. DUR217910). */
  ibkr_account_id: string | null;
  last_heartbeat: string | null;
  last_error: string | null;
  updated_at: string;
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
  /** 0 = off; block entries when 1m volume ratio is below this vs 10-bar average */
  min_volume_ratio: number;
  /** 0 = off; block entries / EM scan picks below this USD share price */
  min_share_price: number;
  /** Minimum avg dollar volume per 5m bar for EM screener and entries (0 = off). */
  min_dollar_volume: number;
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
  watchlist_pins: WatchlistPin[];
  watchlist_dismissed: string[];
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

export type WatchlistPin = {
  symbol: string;
  locked: boolean;
  protect_demotion: boolean;
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
  market_snapshot?: MarketSnapshot | null;
  return_5m_pct?: number | null;
  return_15m_pct?: number | null;
  return_30m_pct?: number | null;
  forward_returns_checked_at?: string | null;
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
  ibkr_account_id?: string | null;
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
  ibkr_account_id: string | null;
  created_at: string;
};

export type IbkrAccountProfile = {
  account_id: string;
  baseline_equity: number;
  account_capital: number;
  risk_sync_equity: number | null;
  created_at: string;
  updated_at: string;
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
