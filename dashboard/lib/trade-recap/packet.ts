import { exitReasonLabel } from "@/lib/trade-analytics";
import type {
  InTradePeak,
  LossCutPathStats,
  ProfitTakePathStats,
} from "@/lib/trade-recap/in-trade-peak";
import type { Settings, Trade } from "@/lib/types/database";

function percentPoints(decimal: number | null | undefined): number | null {
  if (decimal == null) return null;
  return Math.round(decimal * 1000) / 10;
}

export type TradeRecapPacket = {
  note: string;
  symbol: string;
  side: string;
  status: string;
  entry_time: string;
  entry_price: number;
  exit_time: string | null;
  exit_price: number | null;
  net_pnl: number | null;
  jev_buy_pct: number | null;
  exit_reason: string | null;
  exit_reason_label: string | null;
  stop_loss: number | null;
  take_profit: number | null;
  settings_snapshot: {
    stop_loss_pct: number;
    take_profit_pct: number;
    max_hold_minutes: number;
  };
  in_trade_peak: InTradePeak | null;
  profit_take_path: ProfitTakePathStats | null;
  loss_cut_path: LossCutPathStats | null;
};

export function buildTradeRecapPacket(
  trade: Trade,
  settings: Settings,
  inTradePeak: InTradePeak | null = null,
  profitTakePath: ProfitTakePathStats | null = null,
  lossCutPath: LossCutPathStats | null = null,
): TradeRecapPacket {
  const reason = trade.exit_reason?.trim() || null;
  return {
    note:
      "Write a short recap of one closed or open trade. Use plain language. Do not promise profit. Percents are already in percent.",
    symbol: trade.symbol,
    side: trade.side,
    status: trade.status,
    entry_time: trade.entry_time,
    entry_price: trade.entry_price,
    exit_time: trade.exit_time,
    exit_price: trade.exit_price,
    net_pnl: trade.net_pnl,
    jev_buy_pct: percentPoints(trade.jev_buy_probability),
    exit_reason: reason,
    exit_reason_label: reason ? exitReasonLabel(reason) : null,
    stop_loss: trade.stop_loss,
    take_profit: trade.take_profit,
    settings_snapshot: {
      stop_loss_pct: Math.round(settings.stop_loss_percentage * 1000) / 10,
      take_profit_pct: Math.round(settings.take_profit_percentage * 1000) / 10,
      max_hold_minutes: settings.max_hold_minutes,
    },
    in_trade_peak: inTradePeak,
    profit_take_path: profitTakePath,
    loss_cut_path: lossCutPath,
  };
}
