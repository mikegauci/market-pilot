import { skipReasonLabel } from "@/lib/skip-reason-stats";
import {
  computeTradeStats,
  exitReasonBreakdown,
  exitReasonLabel,
  normalizeExitReasonKey,
} from "@/lib/trade-analytics";
import type { Settings, Trade } from "@/lib/types/database";
import type { SessionBriefStats } from "@/lib/session-brief/stats";

const MAX_TRADES = 30;

function buyPercent(decimal: number): number {
  return Math.round(decimal * 1000) / 10;
}

function holdMinutes(trade: Trade): number | null {
  if (!trade.exit_time) return null;
  const ms = new Date(trade.exit_time).getTime() - new Date(trade.entry_time).getTime();
  if (ms <= 0) return null;
  return Math.round(ms / 60_000);
}

export type SessionBriefPacket = {
  session_date: string;
  generated_at: string;
  settings_note: string;
  predictions: {
    total: number;
    traded: number;
    skip_reasons: { key: string; label: string; count: number }[];
    near_misses: {
      symbol: string;
      buy_pct: number;
      skip_reason: string | null;
    }[];
    eligible_blocked: {
      symbol: string;
      buy_pct: number;
      skip_reason: string | null;
    }[];
  };
  trades: {
    stats: ReturnType<typeof computeTradeStats>;
    exit_breakdown: {
      reason: string;
      label: string;
      count: number;
      pnl: number;
    }[];
    closed: {
      symbol: string;
      entry_time: string;
      hold_minutes: number | null;
      jev_buy_pct: number | null;
      exit_reason: string;
      net_pnl: number;
    }[];
  };
  settings: {
    minimum_jev_confidence_pct: number;
    signal_record_threshold_pct: number;
    stop_loss_pct: number;
    take_profit_pct: number;
    max_hold_minutes: number;
    max_open_positions: number;
    min_volume_ratio: number;
    reentry_cooldown_minutes: number;
    risk_profile: string | null;
  };
};

export function buildSessionPacket(input: {
  sessionDate: string;
  stats: SessionBriefStats;
  trades: Trade[];
  settings: Settings;
}): SessionBriefPacket {
  const closedTrades = input.trades.filter((t) => t.status === "closed");
  const tradeStats = computeTradeStats(closedTrades);
  const exitBreakdown = exitReasonBreakdown(closedTrades);

  const closedPayload = closedTrades.slice(0, MAX_TRADES).map((trade) => {
    const reasonKey = normalizeExitReasonKey(trade);
    return {
      symbol: trade.symbol,
      entry_time: trade.entry_time,
      hold_minutes: holdMinutes(trade),
      jev_buy_pct:
        trade.jev_buy_probability != null ? buyPercent(trade.jev_buy_probability) : null,
      exit_reason: exitReasonLabel(reasonKey === "ibkr" ? "ibkr_" : reasonKey),
      net_pnl: trade.net_pnl ?? trade.gross_pnl ?? 0,
    };
  });

  return {
    session_date: input.sessionDate,
    generated_at: new Date().toISOString(),
    settings_note:
      "Settings below are from when this brief was generated. Skip-reason counts and examples come from predictions stored that session.",
    predictions: {
      total: input.stats.total,
      traded: input.stats.traded,
      skip_reasons: input.stats.skip_reasons.map((row) => ({
        key: row.reason,
        label: skipReasonLabel(row.reason),
        count: row.count,
      })),
      near_misses: input.stats.near_misses.map((row) => ({
        symbol: row.symbol,
        buy_pct: buyPercent(row.buy_probability),
        skip_reason: row.trade_skip_reason,
      })),
      eligible_blocked: input.stats.eligible_blocked.map((row) => ({
        symbol: row.symbol,
        buy_pct: buyPercent(row.buy_probability),
        skip_reason: row.trade_skip_reason,
      })),
    },
    trades: {
      stats: tradeStats,
      exit_breakdown: exitBreakdown.map((row) => ({
        reason: row.reason,
        label: row.label,
        count: row.count,
        pnl: row.pnl,
      })),
      closed: closedPayload,
    },
    settings: {
      minimum_jev_confidence_pct: buyPercent(input.settings.minimum_jev_confidence),
      signal_record_threshold_pct: buyPercent(input.settings.signal_record_threshold),
      stop_loss_pct: Math.round(input.settings.stop_loss_percentage * 10_000) / 100,
      take_profit_pct: Math.round(input.settings.take_profit_percentage * 10_000) / 100,
      max_hold_minutes: input.settings.max_hold_minutes,
      max_open_positions: input.settings.max_open_positions,
      min_volume_ratio: input.settings.min_volume_ratio,
      reentry_cooldown_minutes: input.settings.reentry_cooldown_minutes,
      risk_profile: input.settings.risk_profile ?? null,
    },
  };
}
