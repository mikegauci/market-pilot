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
  max_trades_per_day:
    "You cap how many new trades the bot can open in one day across all symbols (0 = off). Fewer trades means fewer commissions and fewer weaker setups. Trades you place by hand are never blocked.",
  min_reward_risk:
    "You require the profit target to be at least this many times farther from your entry than the stop-loss (0 = off), so winning trades can be larger than losing ones. A value of 2 puts the target twice as far away as the stop.",
  breakeven_at_r:
    "After a trade has gained this many times the amount it risked, the bot sells at your entry price if the price falls back there, so a trade that was working does not turn into a loss (0 = off). A value of 1 means once the gain equals the original risk.",
  entry_mode:
    "You choose what triggers a buy: Jev's prediction, or the opening range breakout, which buys when a stock moves above the high of its first few minutes after the open. Opening range breakout mode does not call Jev unless you turn on the Jev veto.",
  orb_range_minutes:
    "You set how long after the 9:30 ET open the bot measures each stock's high and low before it watches for a breakout. A shorter range reacts sooner; a longer one is steadier. Must be a multiple of 5.",
  orb_entry_cutoff_minutes:
    "You stop opening range buys this many minutes after the 9:30 ET open (90 = 11:00). Trades already open are still managed, and everything is still closed before the end of the day.",
  orb_jev_veto:
    "When on, the bot still asks Jev about each breakout and skips the buy if Jev's strongest reading is SELL. When off, opening range mode never calls Jev.",
  in_play_min_rvol:
    "You only trade stocks drawing unusual attention: their volume in the opening range must be at least this many times their normal volume for the same minutes (0 = off). The bot also picks its watchlist for the day from the stocks with the highest ratio.",
  in_play_min_gap_pct:
    "You require a stock to open at least this many percent above or below yesterday's close before it counts as in play (0 = off). If you set both this and relative volume, a stock must pass both.",
  rotation_min_session_change_pct:
    "While rotation is on: names below this % vs today's price when the market opened are not promoted to the active list. Blank = off. 0 = flat or green since open.",
  entry_ema_gate:
    "After a qualifying BUY, the bot only enters when price is above the chosen EMA on 1-minute bars — or skip this check when Off. EMA-9 reacts faster; EMA-20 is stricter.",
  max_rsi:
    "Block new entries when the 1-minute RSI is above this level. Lower values skip more overbought names; 70 is a common default. Breakout promotions can use a separate, temporary cap in Watchlist settings.",
  breakout_enabled:
    "When rotation is on, you let the bot move a pool symbol onto the active list as soon as it breaks out on price and volume, using the same session % floor as rotation. Jev BUY and your other entry filters still decide whether it trades.",
  breakout_max_rsi:
    "For a few minutes after a breakout promotion, you allow entries up to this RSI instead of your normal Max RSI. If you set it at or below Max RSI, promoted names get no extra room.",
  breakout_window_minutes:
    "How long you give a breakout-promoted symbol the higher RSI cap. During this time rotation also won't swap it out.",
  breakout_max_promotions_per_cycle:
    "The most breakout-promoted symbols you allow inside their window at the same time. When the limit is reached, new breakouts wait until a window ends.",
  breakout_lookback_minutes:
    "You count a breakout when price clears the highest point of this many previous 1-minute bars. Shorter lookbacks fire more often but catch more noise; 5 is the minimum.",
  breakout_min_volume_ratio:
    "You need the latest 1-minute volume to be at least this multiple of the recent average. 1.5 means 50% more volume than usual.",
  breakout_min_change_5m_pct:
    "You need the price up at least this percent over five minutes, and also up more than the benchmark over the same five minutes. 0.15 means 0.15%.",
  max_spread_pct:
    "Block entries when the bid–ask spread is wider than this percent of the share price. Example: 0.15 means 0.15% — tight for liquid large caps.",
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
  max_trades_per_day: "Most new trades the bot may open each day (0 = off).",
  min_reward_risk: "Profit target must be at least this many times the stop distance (0 = off).",
  breakeven_at_r: "Exit at your entry price if a trade fades after gaining this much (0 = off).",
  entry_mode: "Choose Jev predictions or the opening range breakout to decide buys.",
  orb_range_minutes: "Minutes after the open used to measure each stock's opening range.",
  orb_entry_cutoff_minutes: "No opening range buys after this many minutes from the open.",
  orb_jev_veto: "Skip a breakout when Jev currently reads SELL.",
  in_play_min_rvol: "Opening volume must be this many times normal for the stock to count (0 = off).",
  in_play_min_gap_pct: "Stock must open this far above or below yesterday's close (0 = off).",
  rotation_min_session_change_pct:
    "Rotation only: min % since market open (blank = off, 0 = flat or up).",
  entry_ema_gate: "Require price above EMA-9, EMA-20, or Off.",
  max_rsi: "Skip entries when RSI is above this (1–100).",
  breakout_enabled: "Move pool symbols onto the active list as soon as they break out.",
  breakout_max_rsi: "Higher RSI cap for a few minutes after a breakout promotion.",
  breakout_window_minutes:
    "Minutes a promoted name keeps the breakout RSI cap and rotation protection.",
  breakout_max_promotions_per_cycle:
    "Most breakout-promoted names allowed inside their window at the same time.",
  breakout_lookback_minutes: "Price must clear the high of this many prior 1-minute bars.",
  breakout_min_volume_ratio: "Latest 1-minute volume must be this multiple of the recent average.",
  breakout_min_change_5m_pct: "Minimum 5-minute % rise, which must also beat the benchmark's move.",
  max_spread_pct: "Skip when spread exceeds this % of price (e.g. 0.15).",
  min_volume_ratio: "Block entries when volume is below this fraction of average (0 = off).",
  min_share_price: "Block entries below this USD price (0 = off).",
  min_dollar_volume: "Min avg $ volume per 5m bar for entries (0 = off).",
  watchlist: "Symbols the trader evaluates each cycle.",
} as const;

export type SettingDescriptionKey = keyof typeof SETTING_DESCRIPTIONS;
