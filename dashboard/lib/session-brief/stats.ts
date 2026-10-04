export type SessionBriefStatsRow = {
  reason: string;
  count: number;
};

export type SessionBriefMissRow = {
  symbol: string;
  buy_probability: number;
  trade_skip_reason: string | null;
};

export type SessionBriefStats = {
  total: number;
  traded: number;
  skip_reasons: SessionBriefStatsRow[];
  near_misses: SessionBriefMissRow[];
  eligible_blocked: SessionBriefMissRow[];
};

export function parseSessionBriefStats(value: unknown): SessionBriefStats {
  if (!value || typeof value !== "object") {
    throw new Error("Session stats payload is missing.");
  }
  const row = value as SessionBriefStats;
  const total = Number(row.total);
  const traded = Number(row.traded);
  if (!Number.isFinite(total) || !Number.isFinite(traded)) {
    throw new Error("Session stats totals are invalid.");
  }
  return {
    total,
    traded,
    skip_reasons: Array.isArray(row.skip_reasons) ? row.skip_reasons : [],
    near_misses: Array.isArray(row.near_misses) ? row.near_misses : [],
    eligible_blocked: Array.isArray(row.eligible_blocked) ? row.eligible_blocked : [],
  };
}
