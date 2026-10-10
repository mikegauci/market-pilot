import { normalizeSkipReasonKey, skipReasonLabel } from "@/lib/skip-reason-stats";
import {
  computeTradeStats,
  exitReasonBreakdown,
  exitReasonLabel,
  normalizeExitReasonKey,
} from "@/lib/trade-analytics";
import { etMinutesOfDay } from "@/lib/market-hours";
import {
  bucketTimeOfDay,
  replaySkip,
  tradePath,
  type ReplayBar,
  type SkipOutcome,
  type TimeBucket,
} from "@/lib/session-brief/replay";
import type { Settings, Trade } from "@/lib/types/database";
import type { SessionBriefMissRow, SessionBriefStats } from "@/lib/session-brief/stats";

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

export type MissedOpportunityRow = {
  symbol: string;
  time: string | null;
  buy_pct: number;
  skip_reason: string | null;
  reason_key: string;
  reason_label: string;
  outcome: SkipOutcome;
  move_pct: number | null;
  max_up_pct: number | null;
  max_down_pct: number | null;
};

export type MissedByReason = {
  reason: string;
  label: string;
  tested: number;
  take_profit: number;
  stop_loss: number;
  timed_out: number;
  no_data: number;
};

export type TimeBucketRow = { bucket: TimeBucket; trades: number; wins: number; pnl: number };

export type SessionBriefPacket = {
  session_date: string;
  generated_at: string;
  /** Set when closed trades could not be scoped to the active broker account. */
  trades_scope_warning?: string;
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
  missed_opportunities: {
    /** Rough replay of today's stop / take-profit on 5-minute bars after each skip. Not real fills. */
    rows: MissedOpportunityRow[];
    by_reason: MissedByReason[];
  };
  trades: {
    stats: ReturnType<typeof computeTradeStats>;
    by_time_of_day: TimeBucketRow[];
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
      max_up_pct: number | null;
      max_down_pct: number | null;
      time_of_day: TimeBucket;
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

/** Symbols the replay needs bars for. */
export function symbolsNeedingBars(stats: SessionBriefStats, trades: Trade[]): string[] {
  const set = new Set<string>();
  for (const row of [...stats.near_misses, ...stats.eligible_blocked]) set.add(row.symbol);
  for (const trade of trades) set.add(trade.symbol);
  return [...set];
}

function buildMissedOpportunities(
  rows: SessionBriefMissRow[],
  barsBySymbol: Map<string, ReplayBar[]>,
  settings: Settings,
  sessionClose: Date,
): SessionBriefPacket["missed_opportunities"] {
  const seen = new Set<string>();
  const out: MissedOpportunityRow[] = [];
  for (const row of rows) {
    const key = `${row.symbol}|${row.ts ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reasonKey = normalizeSkipReasonKey(row.trade_skip_reason) ?? "unknown";
    const replay =
      row.ts && row.price
        ? replaySkip({
            entryTs: row.ts,
            entryPrice: row.price,
            bars: barsBySymbol.get(row.symbol) ?? [],
            stopPct: settings.stop_loss_percentage,
            takePct: settings.take_profit_percentage,
            maxHoldMinutes: settings.max_hold_minutes,
            sessionClose,
          })
        : { outcome: "no_data" as const, move_pct: null, max_up_pct: null, max_down_pct: null };
    out.push({
      symbol: row.symbol,
      time: row.ts ?? null,
      buy_pct: buyPercent(row.buy_probability),
      skip_reason: row.trade_skip_reason,
      reason_key: reasonKey,
      reason_label: skipReasonLabel(reasonKey),
      ...replay,
    });
  }
  out.sort((a, b) => (b.max_up_pct ?? -Infinity) - (a.max_up_pct ?? -Infinity));

  const byReason = new Map<string, MissedByReason>();
  for (const row of out) {
    const entry =
      byReason.get(row.reason_key) ??
      {
        reason: row.reason_key,
        label: row.reason_label,
        tested: 0,
        take_profit: 0,
        stop_loss: 0,
        timed_out: 0,
        no_data: 0,
      };
    entry.tested += 1;
    entry[row.outcome] += 1;
    byReason.set(row.reason_key, entry);
  }
  return {
    rows: out,
    by_reason: [...byReason.values()].sort((a, b) => b.tested - a.tested),
  };
}

export function buildSessionPacket(input: {
  sessionDate: string;
  stats: SessionBriefStats;
  trades: Trade[];
  settings: Settings;
  barsBySymbol: Map<string, ReplayBar[]>;
  sessionClose: Date;
}): SessionBriefPacket {
  const closedTrades = input.trades.filter((t) => t.status === "closed");
  const tradeStats = computeTradeStats(closedTrades);
  const exitBreakdown = exitReasonBreakdown(closedTrades);

  // Time-of-day totals cover every closed trade, not just the capped list below.
  const timeBuckets = new Map<TimeBucket, TimeBucketRow>();
  for (const trade of closedTrades) {
    const pnl = trade.net_pnl ?? trade.gross_pnl ?? 0;
    const bucket = bucketTimeOfDay(etMinutesOfDay(new Date(trade.entry_time)));
    const row = timeBuckets.get(bucket) ?? { bucket, trades: 0, wins: 0, pnl: 0 };
    row.trades += 1;
    if (pnl > 0) row.wins += 1;
    row.pnl = Math.round((row.pnl + pnl) * 100) / 100;
    timeBuckets.set(bucket, row);
  }

  const closedPayload = closedTrades.slice(0, MAX_TRADES).map((trade) => {
    const reasonKey = normalizeExitReasonKey(trade);
    const netPnl = trade.net_pnl ?? trade.gross_pnl ?? 0;
    const bucket = bucketTimeOfDay(etMinutesOfDay(new Date(trade.entry_time)));
    const path = trade.exit_time
      ? tradePath({
          entryTs: trade.entry_time,
          exitTs: trade.exit_time,
          entryPrice: trade.entry_price,
          bars: input.barsBySymbol.get(trade.symbol) ?? [],
        })
      : null;
    return {
      symbol: trade.symbol,
      entry_time: trade.entry_time,
      hold_minutes: holdMinutes(trade),
      jev_buy_pct:
        trade.jev_buy_probability != null ? buyPercent(trade.jev_buy_probability) : null,
      exit_reason: exitReasonLabel(reasonKey === "ibkr" ? "ibkr_" : reasonKey),
      net_pnl: netPnl,
      max_up_pct: path?.max_up_pct ?? null,
      max_down_pct: path?.max_down_pct ?? null,
      time_of_day: bucket,
    };
  });

  return {
    session_date: input.sessionDate,
    generated_at: new Date().toISOString(),
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
    missed_opportunities: buildMissedOpportunities(
      [...input.stats.near_misses, ...input.stats.eligible_blocked],
      input.barsBySymbol,
      input.settings,
      input.sessionClose,
    ),
    trades: {
      stats: tradeStats,
      by_time_of_day: [...timeBuckets.values()],
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
