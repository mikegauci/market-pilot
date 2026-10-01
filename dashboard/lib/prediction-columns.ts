/** Scalar columns shared by feed and strategy queries. */
export const PREDICTION_FEED_COLUMNS =
  "id, symbol, timestamp, price, buy_probability, hold_probability, sell_probability, trade_created, trade_skip_reason, created_at";

/** Feed list — news JSON paths only (not full indicator snapshot). */
export const PREDICTION_FEED_SELECT = [
  PREDICTION_FEED_COLUMNS,
  "news_sentiment:market_snapshot->news_sentiment",
  "news_top_headline:market_snapshot->news_top_headline",
  "news_tags:market_snapshot->news_tags",
].join(", ");

/** Strategy grid / market condition — full snapshot for indicators. */
export const PREDICTION_WITH_SNAPSHOT_COLUMNS = `${PREDICTION_FEED_COLUMNS}, market_snapshot`;
