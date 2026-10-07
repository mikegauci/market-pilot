import { resolveEffectiveWatchlist } from "@/lib/effective-watchlist";
import { traderBuiltInGatesForPacket } from "@/lib/trader-built-in-gates";
import type { BotStatus, Settings } from "@/lib/types/database";

function percentPoints(decimal: number): number {
  return Math.round(decimal * 1000) / 10;
}

function pctOrOff(value: number, decimals = 1): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10 ** (decimals + 2)) / 10 ** decimals;
}

function minutesOrOff(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function countOrOff(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function usdOrOff(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function ratioOrOff(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

export type SettingsAiSummaryPacket = {
  note: string;
  generated_at: string;
  trading_mode: Settings["trading_mode"];
  bot: {
    enabled: boolean;
    execution_mode: BotStatus["execution_mode"];
    ibkr_connected: boolean;
    jev_connected: boolean;
  } | null;
  equity: {
    baseline_usd: number | null;
    current_usd: number | null;
    risk_profile: Settings["risk_profile"];
  };
  jev_and_signals: {
    minimum_jev_confidence_pct: number;
    signal_record_threshold_pct: number;
    confirmation_cycles: number;
    confirmation_seconds: number;
  };
  risk_and_limits: {
    risk_per_trade_pct: number;
    max_position_size_usd: number;
    max_daily_loss_pct: number;
    max_open_positions: number;
    stop_loss_pct: number;
    take_profit_pct: number;
    max_hold_minutes: number;
    max_entries_per_symbol_per_day: number | null;
    reentry_cooldown_minutes: number | null;
  };
  exits_and_filters: {
    min_hold_minutes: number | null;
    jev_sell_exit_threshold_pct: number | null;
    min_volume_ratio: number | null;
    min_share_price_usd: number | null;
    min_dollar_volume_usd: number | null;
    rotation_min_session_change_pct: number | null;
    entry_ema_gate: string;
    max_rsi: number;
    max_spread_pct: number;
    profit_take: { enabled: boolean; band: string; jev_sell_pct: number | null };
    loss_cut: { enabled: boolean; band: string; jev_sell_pct: number | null };
  };
  watchlist: {
    rotation_enabled: boolean;
    effective_symbols: string[];
    manual_symbols: string[];
    pool_count: number;
    active_size: number;
    rotation_interval_minutes: number;
    max_swaps_per_rotation: number;
    entry_blocked_symbols: string[];
    last_rotation_note: string;
  };
  trader_built_in_gates: ReturnType<typeof traderBuiltInGatesForPacket> & {
    gates_note: string;
  };
};

export function buildSettingsAiSummaryPacket(input: {
  settings: Settings;
  baselineEquity: number;
  currentEquity: number;
  botStatus: BotStatus | null;
  now?: Date;
}): SettingsAiSummaryPacket {
  const settings = input.settings;
  const builtIn = traderBuiltInGatesForPacket(settings.entry_ema_gate, {
    max_rsi: settings.max_rsi,
    max_spread_pct: settings.max_spread_pct,
  });
  const effective = resolveEffectiveWatchlist(settings);

  const profitBand = `${settings.profit_take_min_fraction}–${settings.profit_take_max_fraction} of entry→TP path`;
  const lossBand = `${settings.loss_cut_min_fraction}–${settings.loss_cut_max_fraction} of entry→stop path`;

  return {
    note:
      "Summarize only this packet. Percents are already human-readable (85 means 85% Jev BUY). A numeric gate of 0 or null means off. trader_built_in_gates still include env-only gates (benchmark, news margins); RSI and spread match Settings when listed under exits_and_filters. Do not invent symbols beyond effective_symbols. Do not recommend live trading or promise profit.",
    generated_at: (input.now ?? new Date()).toISOString(),
    trading_mode: settings.trading_mode,
    bot: input.botStatus
      ? {
          enabled: input.botStatus.enabled,
          execution_mode: input.botStatus.execution_mode,
          ibkr_connected: input.botStatus.ibkr_connected,
          jev_connected: input.botStatus.jev_connected,
        }
      : null,
    equity: {
      baseline_usd: input.baselineEquity > 0 ? Math.round(input.baselineEquity) : null,
      current_usd: input.currentEquity > 0 ? Math.round(input.currentEquity) : null,
      risk_profile: settings.risk_profile ?? null,
    },
    jev_and_signals: {
      minimum_jev_confidence_pct: percentPoints(settings.minimum_jev_confidence),
      signal_record_threshold_pct: percentPoints(settings.signal_record_threshold),
      confirmation_cycles: settings.confirmation_cycles,
      confirmation_seconds: settings.confirmation_seconds,
    },
    risk_and_limits: {
      risk_per_trade_pct: settings.risk_per_trade,
      max_position_size_usd: settings.max_position_size,
      max_daily_loss_pct: settings.max_daily_loss,
      max_open_positions: settings.max_open_positions,
      stop_loss_pct: percentPoints(settings.stop_loss_percentage),
      take_profit_pct: percentPoints(settings.take_profit_percentage),
      max_hold_minutes: settings.max_hold_minutes,
      max_entries_per_symbol_per_day: countOrOff(settings.max_entries_per_symbol_per_day),
      reentry_cooldown_minutes: minutesOrOff(settings.reentry_cooldown_minutes),
    },
    exits_and_filters: {
      min_hold_minutes: minutesOrOff(settings.min_hold_minutes),
      jev_sell_exit_threshold_pct: pctOrOff(settings.jev_sell_exit_threshold),
      min_volume_ratio: ratioOrOff(settings.min_volume_ratio),
      min_share_price_usd: usdOrOff(settings.min_share_price),
      min_dollar_volume_usd: usdOrOff(settings.min_dollar_volume),
      rotation_min_session_change_pct:
        settings.rotation_min_session_change_pct == null
          ? null
          : settings.rotation_min_session_change_pct,
      entry_ema_gate: settings.entry_ema_gate,
      max_rsi: settings.max_rsi,
      max_spread_pct: settings.max_spread_pct * 100,
      profit_take: {
        enabled: settings.profit_take_enabled,
        band: profitBand,
        jev_sell_pct: pctOrOff(settings.profit_take_jev_sell_threshold),
      },
      loss_cut: {
        enabled: settings.loss_cut_enabled,
        band: lossBand,
        jev_sell_pct: pctOrOff(settings.loss_cut_jev_sell_threshold),
      },
    },
    watchlist: {
      rotation_enabled: settings.watchlist_rotation_enabled,
      effective_symbols: effective,
      manual_symbols: settings.watchlist.map((s) => s.toUpperCase()),
      pool_count: settings.watchlist_pool.length,
      active_size: settings.watchlist_active_size,
      rotation_interval_minutes: settings.watchlist_rotation_interval_minutes,
      max_swaps_per_rotation: settings.watchlist_max_swaps_per_rotation,
      entry_blocked_symbols: settings.entry_blocked_symbols.map((s) => s.toUpperCase()),
      last_rotation_note: settings.watchlist_last_rotation_note.trim().slice(0, 200),
    },
    trader_built_in_gates: {
      ...builtIn,
      gates_note:
        "Spread cap, RSI cap, benchmark drop, news sentiment floor, EMA-20 rule, buy-hold margin, and news block tags — change only via trader STRATEGY_* env, not this Settings page.",
    },
  };
}
