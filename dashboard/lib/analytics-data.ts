/** Server + client analytics fetch limits (keep DB load low). */

/** Calibration chart: only predictions in this window (aggregated via RPC). */
export const ANALYTICS_CALIBRATION_LOOKBACK_DAYS = 14;

/** Skip-reason funnel: recent session only. */
export const ANALYTICS_SKIP_LOOKBACK_HOURS = 48;
export const ANALYTICS_SKIP_REASON_LIMIT = 600;
export const ANALYTICS_PORTFOLIO_HISTORY_LIMIT = 2000;

/** Slow refresh while Analytics tab is open (quota-safe). */
export const ANALYTICS_PAGE_POLL_MS = 120_000;

export const LATEST_PREDICTIONS_PER_SYMBOL_LIMIT = 128;

/** @deprecated Client row fetch — prefer fetchJevCalibrationBuckets RPC. */
export const ANALYTICS_CALIBRATION_LIMIT = 1500;

export const ANALYTICS_SKIP_PREDICTION_COLUMNS =
  "id, symbol, timestamp, buy_probability, hold_probability, sell_probability, trade_created, trade_skip_reason";

export const ANALYTICS_CALIBRATION_COLUMNS =
  "buy_probability, return_15m_pct, timestamp";
