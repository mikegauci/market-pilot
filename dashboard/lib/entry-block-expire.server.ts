import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { seedActiveWatchlistFromPool } from "@/lib/seed-active-watchlist";
import {
  blockExpiryMinutes,
  normalizeEntryBlockedAt,
} from "@/lib/entry-block-timing";
import { removeEntryBlockedSymbol } from "@/lib/entry-blocked-symbols";
import {
  normalizeWatchlistRotationHistory,
  prependWatchlistRotationHistory,
} from "@/lib/watchlist-rotation-history";
import { normalizeSettings, type SettingsRow } from "@/lib/normalize-settings";

type SettingsBlockRow = Pick<
  SettingsRow,
  | "entry_blocked_symbols"
  | "entry_blocked_at"
  | "watchlist_rotation_enabled"
  | "watchlist_active"
  | "watchlist_active_size"
  | "watchlist_pool"
  | "watchlist_rotation_interval_minutes"
  | "watchlist_rotation_history"
>;

/** Drop timed-out blocks and restore symbols to the active list (rotation mode). */
export async function expireEntryBlocksIfDue(
  supabase: SupabaseClient,
): Promise<void> {
  const { data, error } = await supabase
    .from("settings")
    .select(
      "entry_blocked_symbols, entry_blocked_at, watchlist_rotation_enabled, watchlist_active, watchlist_active_size, watchlist_pool, watchlist_rotation_interval_minutes, watchlist_rotation_history",
    )
    .eq("id", 1)
    .single();

  if (error || !data) return;

  const row = data as SettingsBlockRow;
  const settings = normalizeSettings(row as SettingsRow);
  if (!settings?.entry_blocked_symbols.length) return;

  const expiryMin = blockExpiryMinutes(settings);
  const cutoffMs = Date.now() - expiryMin * 60_000;
  const blockedAt = normalizeEntryBlockedAt(settings.entry_blocked_at);
  const expired = settings.entry_blocked_symbols.filter((symbol) => {
    const atMs = Date.parse(blockedAt[symbol] ?? "");
    return !Number.isFinite(atMs) || atMs <= cutoffMs;
  });

  if (!expired.length) return;

  let symbols = [...settings.entry_blocked_symbols];
  const atMap = { ...blockedAt };
  for (const symbol of expired) {
    symbols = removeEntryBlockedSymbol(symbols, symbol);
    delete atMap[symbol.toUpperCase()];
  }

  const payload: Record<string, unknown> = {
    entry_blocked_symbols: symbols,
    entry_blocked_at: atMap,
    updated_at: new Date().toISOString(),
  };

  if (settings.watchlist_rotation_enabled) {
    const expiredSet = new Set(expired.map((symbol) => symbol.toUpperCase()));
    let active = (settings.watchlist_active ?? []).filter(
      (symbol) => !expiredSet.has(symbol.toUpperCase()),
    );
    for (const symbol of expired) {
      const key = symbol.toUpperCase();
      active = active.filter((item) => item.toUpperCase() !== key);
      active.unshift(key);
    }
    const size = Math.max(1, settings.watchlist_active_size ?? 12);
    while (active.length > size) active.pop();
    if (!active.length) {
      active = seedActiveWatchlistFromPool(
        settings.watchlist_pool ?? [],
        symbols,
        size,
      );
    }
    payload.watchlist_active = active;
    const note = `Unblocked ${expired.join(", ")} (timed)`;
    payload.watchlist_last_rotation_note = note;
    payload.watchlist_last_rotation_at = new Date().toISOString();
    const history = normalizeWatchlistRotationHistory(row.watchlist_rotation_history);
    payload.watchlist_rotation_history = prependWatchlistRotationHistory(history, {
      at: payload.watchlist_last_rotation_at as string,
      detail: note,
    });
  }

  await supabase.from("settings").update(payload).eq("id", 1);
}
