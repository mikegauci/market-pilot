const SKIP_REASON_LABELS: Record<string, string> = {
  below_trade_threshold: "Below confidence threshold",
  buy_hold_margin: "BUY–HOLD margin too narrow",
  hold_dominant: "HOLD dominant",
  sell_dominant: "SELL dominant",
  signal_not_eligible: "Signal not eligible",
  bot_disabled: "Auto-trading off",
  already_open: "Position already open",
  max_open_positions: "Max positions reached",
  insufficient_capital: "Insufficient capital",
  max_daily_loss: "Daily loss limit hit",
  position_too_small: "Position too small",
  invalid_price: "Invalid price",
  ibkr_not_connected: "Broker not connected",
  ibkr_pending_entry_order: "Pending BUY order open",
  price_below_ema20: "Price below EMA-20",
  ema_warming_up: "EMA warming up",
  max_entries_per_symbol: "Max entries per symbol (day)",
};

export function formatSkipReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith("awaiting_confirmation")) {
    const match = reason.match(/awaiting_confirmation \((\d+)\/(\d+)\)/);
    if (match) {
      return `Awaiting confirmation (${match[1]}/${match[2]})`;
    }
    return "Awaiting confirmation";
  }
  if (reason.startsWith("rsi_overbought")) return "RSI overbought";
  if (reason.startsWith("spread_too_wide")) return "Spread too wide";
  if (reason.startsWith("spy_headwind")) return "SPY headwind";
  if (reason.startsWith("news_sentiment_bearish")) return "Bearish news";
  if (reason.startsWith("news_block_tag")) return "Blocked news tag";
  if (reason.startsWith("news_earnings_window")) return "Earnings window";
  if (reason.startsWith("correlation_cap")) return "Correlation cap";
  if (reason.startsWith("ibkr_cooldown")) return "Broker cooldown";
  if (reason.startsWith("ibkr_ineligible")) return "Broker ineligible (KID / permission)";
  if (reason.startsWith("ibkr_insufficient_buying_power")) return "Insufficient buying power";
  if (reason.startsWith("ibkr_order_failed")) return "Broker order failed";
  return SKIP_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}
