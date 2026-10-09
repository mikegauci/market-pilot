/**
 * Supabase Free tier: egress and log ingestion scale with REST request count and payload size.
 * Keep polling modest; avoid Realtime on high-insert tables (predictions).
 */

/** Default client poll for trading views (was 3s — too aggressive for hosted DB). */
export const LIVE_DATA_POLL_MS = 10_000;

/** Latest-per-symbol predictions scan a large table — poll less often than trades/positions. */
export const LIVE_PREDICTIONS_POLL_MS = 30_000;

/** Settings change rarely — avoid polling with trades/positions. */
export const LIVE_SETTINGS_POLL_MS = 120_000;

/** Coalesce Realtime-driven refetches so one burst of inserts → one poll wave. */
export const REALTIME_DEBOUNCE_MS = 2_500;

/** Tables with frequent writes: poll only (no postgres_changes subscriptions). */
export const LIVE_POLL_ONLY_TABLES = new Set(["predictions"]);

export function liveRealtimeTables(tables: string[]): string[] {
  return tables.filter((table) => !LIVE_POLL_ONLY_TABLES.has(table));
}
