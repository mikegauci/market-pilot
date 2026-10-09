/** Scalar columns shared by feed and strategy queries. */
export const PREDICTION_FEED_COLUMNS =
  "id, symbol, timestamp, price, buy_probability, hold_probability, sell_probability, trade_created, trade_skip_reason, created_at";

/** Strategy grid / market condition — full snapshot for indicators. */
export const PREDICTION_WITH_SNAPSHOT_COLUMNS = `${PREDICTION_FEED_COLUMNS}, market_snapshot`;
