export type BotStatus = {
  id: number;
  enabled: boolean;
  /** Dashboard asks the running trader process to exit on the next control sync. */
  shutdown_requested?: boolean;
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
  /** Consecutive eligible Jev BUY eval cycles required before entry. */
  confirmation_cycles: number;
  /** Minimum seconds an eligible BUY must persist before entry (0 = cycle count only). */
  confirmation_seconds: number;
  /** 0 = off; block entries when 1m volume ratio is below this vs 10-bar average */
  min_volume_ratio: number;
  /** 0 = off; block entries below this USD share price */
  min_share_price: number;
  /** Minimum avg dollar volume per 5m bar for entries (0 = off). */
  min_dollar_volume: number;
  account_capital: number;
  risk_sync_equity: number | null;
  risk_profile?: "low" | "medium" | "high" | null;
  watchlist: string[];
  /** Candidate symbols rotation can promote. Empty uses the manual watchlist only. */
  watchlist_pool: string[];
  /** Names Jev evaluates when rotation is on. The bot writes this. */
  watchlist_active: string[];
  watchlist_rotation_enabled: boolean;
  watchlist_active_size: number;
  watchlist_rotation_interval_minutes: number;
  watchlist_max_swaps_per_rotation: number;
  watchlist_last_rotation_note: string;
  watchlist_last_rotation_at?: string | null;
  /** Manual block: no new entries until unblocked or timed return to active. */
  entry_blocked_symbols: string[];
  /** UTC ISO timestamps keyed by symbol for timed unblock. */
  entry_blocked_at: Record<string, string>;
  benchmark_symbol: string;
  /** Market-sell when price is in the entry→TP path band (fractions 0–1). */
  profit_take_enabled: boolean;
  profit_take_min_fraction: number;
  profit_take_max_fraction: number;
  profit_take_min_band_hits: number;
  profit_take_band_window_cycles: number;
  /** 0 = off; otherwise min SELL % (fraction 0–1) for optional early exit with progress ≥ min band. */
  profit_take_jev_sell_threshold: number;
  updated_at: string;
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
  news_materiality_note?: string | null;
  news_still_relevant_for_open?: boolean | null;
  tape_sentiment?: number | null;
  tape_tags?: string[] | null;
  tape_top_headline?: string | null;
  tape_fetched_at?: string | null;
  ai_shadow_verdict?: "agree" | "hold" | "conflict" | string | null;
  ai_shadow_note?: string | null;
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

export type PositionCommand = {
  id: string;
  symbol: string;
  quantity: number;
  command: "cover_short";
  status: "pending" | "processing" | "completed" | "failed";
  reason: string | null;
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
  /** IBKR AccruedCash (simulated interest on paper); often ≈ equity − balance. */
  ibkr_accrued_cash: number | null;
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

export type SessionBriefContent = {
  headline: string;
  what_happened: string[];
  entry_blockers: { reason: string; count: number; takeaway: string }[];
  exits: string[];
  suggestions: { setting: string; direction: "raise" | "lower" | "keep"; why: string }[];
  caveats: string[];
};

export type SessionBriefRow = {
  id: string;
  session_date: string;
  model: string;
  input: Record<string, unknown>;
  brief: SessionBriefContent;
  created_by: string;
  created_at: string;
};

export type ChartMarker = {
  time: string;
  price: number;
  label?: string;
};
