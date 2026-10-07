import type { Prediction, Settings, Trade } from "@/lib/types/database";

function percentPoints(decimal: number | null | undefined): number | null {
  if (decimal == null) return null;
  return Math.round(decimal * 1000) / 10;
}

export type PositionExplainPacket = {
  note: string;
  symbol: string;
  quantity: number;
  avg_cost: number;
  market_price: number | null;
  unrealized_pnl: number | null;
  trade: {
    entry_time: string;
    entry_price: number;
    stop_loss: number | null;
    take_profit: number | null;
    jev_buy_pct: number | null;
    minutes_open: number | null;
  } | null;
  latest_jev: {
    buy_pct: number;
    hold_pct: number;
    sell_pct: number;
    timestamp: string;
  } | null;
  exit_rules: {
    stop_loss_pct: number;
    take_profit_pct: number;
    max_hold_minutes: number;
    min_hold_minutes: number;
    jev_sell_exit_threshold_pct: number;
    profit_take_enabled: boolean;
    loss_cut_enabled: boolean;
  };
};

export function buildPositionExplainPacket(
  symbol: string,
  quantity: number,
  avgCost: number,
  marketPrice: number | null,
  unrealizedPnl: number | null,
  trade: Trade | null,
  latestPrediction: Prediction | null,
  settings: Settings,
): PositionExplainPacket {
  const now = Date.now();
  let minutesOpen: number | null = null;
  if (trade?.entry_time) {
    minutesOpen = Math.round((now - new Date(trade.entry_time).getTime()) / 60_000);
  }

  return {
    note:
      "Explain why this position is still open. Use percents as given (85 means 85%). Do not invent prices or headlines. This is advisory only.",
    symbol,
    quantity,
    avg_cost: avgCost,
    market_price: marketPrice,
    unrealized_pnl: unrealizedPnl,
    trade: trade
      ? {
          entry_time: trade.entry_time,
          entry_price: trade.entry_price,
          stop_loss: trade.stop_loss,
          take_profit: trade.take_profit,
          jev_buy_pct: percentPoints(trade.jev_buy_probability),
          minutes_open: minutesOpen,
        }
      : null,
    latest_jev: latestPrediction
      ? {
          buy_pct: percentPoints(latestPrediction.buy_probability) ?? 0,
          hold_pct: percentPoints(latestPrediction.hold_probability) ?? 0,
          sell_pct: percentPoints(latestPrediction.sell_probability) ?? 0,
          timestamp: latestPrediction.timestamp,
        }
      : null,
    exit_rules: {
      stop_loss_pct: Math.round(settings.stop_loss_percentage * 1000) / 10,
      take_profit_pct: Math.round(settings.take_profit_percentage * 1000) / 10,
      max_hold_minutes: settings.max_hold_minutes,
      min_hold_minutes: settings.min_hold_minutes,
      jev_sell_exit_threshold_pct:
        Math.round(settings.jev_sell_exit_threshold * 1000) / 10,
      profit_take_enabled: settings.profit_take_enabled,
      loss_cut_enabled: settings.loss_cut_enabled,
    },
  };
}
