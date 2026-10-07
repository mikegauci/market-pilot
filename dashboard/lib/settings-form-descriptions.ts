export const SETTING_DESCRIPTIONS_FULL = {
  minimum_jev_confidence:
    "The AI must be at least this confident before the bot will actually buy — higher means fewer, pickier trades.",
  signal_record_threshold:
    "Buy signals above this level are marked as worth watching, so you can spot near-misses below your trade threshold.",
  confirmation_cycles:
    "After Jev BUY clears your min confidence, the bot waits for this many eval cycles in a row before buying — higher means fewer false starts. Saved changes apply to in-progress confirmations without resetting the streak.",
  confirmation_seconds:
    "Eligible BUY must stay high for at least this many seconds (0 = cycle count only, no time wait). Helps ignore one-tick spikes. Changes apply to in-progress confirmations without resetting the streak.",
  risk_per_trade:
    "Most you are willing to lose on one trade if the stop loss is hit.",
  max_position_size: "Largest amount the bot will put into a single trade.",
  max_daily_loss:
    "If today's losses reach this amount, the bot stops opening new trades until tomorrow.",
  max_open_positions:
    "How many trades the bot can hold at the same time. Set at or above dynamic top-N to avoid slot blocking when names rotate off.",
  stop_loss_percentage:
    "Auto-sell if the price drops this % below your entry — also controls how large each trade is for a given risk budget.",
  take_profit_percentage:
    "Auto-sell when the price rises this % above your entry to lock in gains.",
  profit_take_enabled:
    "When on, the bot can market-sell after price keeps visiting the early band toward take profit, on a soft Jev SELL, or on a fast spike (see fields below).",
  profit_take_min_fraction:
    "Lower bound of the early take-profit band, as % of the distance from entry to take profit (e.g. 70 = sell when price has reached 70% of the way to TP).",
  profit_take_max_fraction:
    "Upper bound of the ideal band (% of distance to take profit). If price jumps above this but is still below full TP, the bot still exits early.",
  profit_take_min_band_hits:
    "How many recent eval cycles must land in the early band before a market exit (reduces one-tick false exits).",
  profit_take_band_window_cycles:
    "How many recent eval cycles to count band touches in (one cycle ≈ your eval interval).",
  profit_take_jev_sell_threshold:
    "Optional: also exit early when Jev SELL reaches this % (dominant) and price is at least at the min band. 0 = off.",
  loss_cut_enabled:
    "When on, the bot can market-sell after price keeps visiting the early band toward stop loss, on a soft Jev SELL, or on a fast spike (see fields below).",
  loss_cut_min_fraction:
    "Lower bound of the early loss-cut band, as % of the distance from entry to stop (e.g. 70 = sell when price has reached 70% of the way to the stop).",
  loss_cut_max_fraction:
    "Upper bound of the ideal band (% of distance to stop). If price drops above this but is still above the hard stop, the bot still exits early.",
  loss_cut_min_band_hits:
    "How many recent eval cycles must land in the early band before a market exit (reduces one-tick false exits).",
  loss_cut_band_window_cycles:
    "How many recent eval cycles to count band touches in (one cycle ≈ your eval interval).",
  loss_cut_jev_sell_threshold:
    "Optional: also exit early when Jev SELL reaches this % (dominant) and price is at least at the min band. 0 = off.",
  max_hold_minutes:
    "Force-close open trades after this many minutes (0 = off). When off, exits use stop loss, take profit, and Jev SELL only.",
  min_hold_minutes:
    "Block Jev SELL and early take-profit / loss-cut exits until a trade has been open this many minutes (0 = off). Stop loss and bracket take profit still work immediately.",
  jev_sell_exit_threshold:
    "Only soft-exit on a Jev SELL when sell probability reaches this % (and sell is dominant). Higher values let bracket take-profit work more often.",
  reentry_cooldown_minutes:
    "After any exit in a symbol — stop, take profit, Jev SELL, time cap, or manual close — block new entries in that symbol for this many minutes (0 = off). Applies whether the trade was a win or a loss.",
  max_entries_per_symbol_per_day:
    "Cap how many new trades the bot may open in the same symbol per US trading day (0 = off). Helps after repeated stop-outs.",
  rotation_min_session_change_pct:
    "While rotation is on: names below this % vs today's price when the market opened are not promoted to the active list. Blank = off. 0 = flat or green since open.",
  entry_ema_gate:
    "After a qualifying BUY, the bot only enters when price is above the chosen EMA on 1-minute bars — or skip this check when Off. EMA-9 reacts faster; EMA-20 is stricter.",
  min_volume_ratio:
    "Block new entries when latest 1-min volume is below this fraction of the 10-bar average (0 = off). Example: 0.5 requires at least half the recent average volume.",
  min_share_price:
    "Block entries below this USD share price (0 = off). Filters out thin/low-priced names.",
  min_dollar_volume:
    "Minimum average dollar volume per 5-minute bar for new entries (0 = off). Example: 250000 filters illiquid names.",
  watchlist: "Symbols Jev monitors for entries (plus open positions at runtime).",
} as const;

export const SETTING_DESCRIPTIONS = {
  minimum_jev_confidence: "Minimum AI confidence before the bot opens a trade.",
  signal_record_threshold: "Log buy signals above this % as watchlist-worthy near-misses.",
  confirmation_cycles: "Eligible BUY cycles in a row before entry.",
  confirmation_seconds: "Min seconds eligible BUY must persist (0 = cycles only).",
  risk_per_trade: "Max loss per trade if stop loss hits.",
  max_position_size: "Cap on capital deployed in one position.",
  max_daily_loss: "Stop new trades after today's losses reach this amount.",
  max_open_positions: "Concurrent open trades allowed (recommend ≥ max dynamic symbols).",
  stop_loss_percentage: "Exit when price falls this % below entry.",
  take_profit_percentage: "Exit when price rises this % above entry.",
  profit_take_enabled: "Early take profit along the path to full TP.",
  profit_take_min_fraction: "Min % of entry→TP distance to start early exit band.",
  profit_take_max_fraction: "Max % of entry→TP distance for early exit band.",
  profit_take_min_band_hits: "Band touches required before early exit.",
  profit_take_band_window_cycles: "Eval cycles to count band touches.",
  profit_take_jev_sell_threshold: "Soft Jev SELL % for early exit (0 = off).",
  loss_cut_enabled: "Early loss cut along the path to full stop.",
  loss_cut_min_fraction: "Min % of entry→stop distance to start early exit band.",
  loss_cut_max_fraction: "Max % of entry→stop distance for early exit band.",
  loss_cut_min_band_hits: "Band touches required before early loss exit.",
  loss_cut_band_window_cycles: "Eval cycles to count band touches.",
  loss_cut_jev_sell_threshold: "Soft Jev SELL % for early loss exit (0 = off).",
  max_hold_minutes: "Force-close after N minutes (0 = off).",
  min_hold_minutes: "No Jev SELL exit until N minutes (0 = off).",
  jev_sell_exit_threshold: "Min Jev SELL % required to soft-exit.",
  reentry_cooldown_minutes:
    "After any exit, wait N minutes before a new entry in that symbol (0 = off).",
  max_entries_per_symbol_per_day: "Max new entries per symbol per day (0 = off).",
  rotation_min_session_change_pct:
    "Rotation only: min % since market open (blank = off, 0 = flat or up).",
  entry_ema_gate: "Require price above EMA-9, EMA-20, or Off.",
  min_volume_ratio: "Block entries when volume is below this fraction of average (0 = off).",
  min_share_price: "Block entries below this USD price (0 = off).",
  min_dollar_volume: "Min avg $ volume per 5m bar for entries (0 = off).",
  watchlist: "Symbols the trader evaluates each cycle.",
} as const;

export type SettingDescriptionKey = keyof typeof SETTING_DESCRIPTIONS;
