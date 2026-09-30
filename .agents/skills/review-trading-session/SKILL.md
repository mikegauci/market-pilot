---
name: review-trading-session
description: Review a market-pilot paper-trading session from Supabase and recommend improvements. Use when the user asks what to improve after a session, whether today's filters and IBKR path worked, or to compare live trade_skip_reason values with the current trader source. Read-only. Never restart the trader.
---

# Review a trading session

Read-only. Use Supabase MCP `execute_sql` on project `gbprapqifrvhylfazjvs` (Cursor namespace `project-0-market-pilot-supabase`). If that namespace is `needsAuth`, call `mcp_auth` first. Do not restart, stop, or kill `python main.py`.

This is not a symbol lookup. For "why didn't SYMBOL trade?" use **diagnose-trader**. This skill answers: did today's pipeline behave as the current code intends, and what is worth changing?

## Live column names

`diagnose-trader` SQL is stale. Use these names:

| Table | Use | Do not use |
|-------|-----|------------|
| `predictions` | `buy_probability`, `hold_probability`, `sell_probability`, `created_at`, `trade_created`, `trade_skip_reason` | `buy`, `hold`, `sell` |
| `trades` | `entry_time`, `exit_time`, `status`, `execution_mode`, `exit_reason`, `net_pnl` | `opened_at`, `closed_at` |
| `market_snapshots` | `created_at` | `updated_at` |
| `settings` × `bot_status` | two queries, or `CROSS JOIN` with no `ON` | `CROSS JOIN ... ON` |

`market_snapshots` is often stale. Prefer `predictions.created_at` and `bot_status.last_heartbeat` for liveness.

## Queries

Session bounds (UTC date of the session under review; default today):

```sql
SELECT
  min(created_at) AS first_prediction,
  max(created_at) AS last_prediction,
  count(*) AS n,
  count(*) FILTER (WHERE trade_created) AS trades_signaled
FROM predictions
WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'utc');
```

```sql
SELECT enabled, trading_mode, execution_mode, ibkr_connected, jev_connected,
       last_heartbeat, last_error, now() - last_heartbeat AS heartbeat_age
FROM bot_status WHERE id = 1;
```

```sql
SELECT minimum_jev_confidence, signal_record_threshold, max_open_positions,
       min_share_price, min_volume_ratio, watchlist_min_buy,
       watchlist_refresh_minutes, watchlist_screener_ran_at,
       watchlist_dynamic_enabled
FROM settings WHERE id = 1;
```

Skip mix:

```sql
SELECT split_part(trade_skip_reason, ' ', 1) AS reason_prefix,
       count(*) AS n
FROM predictions
WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'utc')
  AND trade_created = false
  AND trade_skip_reason IS NOT NULL
GROUP BY 1
ORDER BY n DESC;
```

Near-misses (BUY at or above the trade threshold, still no trade):

```sql
SELECT symbol, buy_probability, trade_skip_reason, created_at
FROM predictions p
JOIN settings s ON s.id = 1
WHERE p.created_at >= date_trunc('day', now() AT TIME ZONE 'utc')
  AND p.trade_created = false
  AND p.buy_probability >= s.minimum_jev_confidence
ORDER BY p.created_at DESC
LIMIT 30;
```

Fills:

```sql
SELECT symbol, status, execution_mode, entry_price, exit_price, net_pnl,
       exit_reason, entry_time, exit_time
FROM trades
WHERE entry_time >= date_trunc('day', now() AT TIME ZONE 'utc')
   OR (status = 'open')
ORDER BY entry_time DESC;
```

## Is the implementation working?

Check each item. Say **working**, **expected idle**, or **drift**.

1. **Heartbeat.** Age under ~30s while the process should be up. `last_error` null.
2. **Market-hours gate.** Predictions during 9:30–16:00 America/New_York. After the close, heartbeats may continue with no new predictions. Current code also writes `entry_window_closed` inside the last `entry_cutoff_minutes_before_close` (`trader/market/hours.py`).
3. **Dominant-side skips.** `hold_dominant` and `sell_dominant` mean Jev did not call BUY. That is the model, not a broken filter.
4. **Confirmation.** `awaiting_confirmation (n/m)` from `trader/main.py` means ELIGIBLE did not repeat enough times. Working if those symbols later filter, fill, or drop back to HOLD/SELL.
5. **Filters and risk.** Prefixes must match emitters in current source: `trader/strategy/filters.py`, `trader/strategy/signals.py`, `trader/risk/manager.py`, `trader/main.py` (`ibkr_order_failed`, `ibkr_cooldown`, `ibkr_ineligible`, `ibkr_not_connected`, `entry_window_closed`).
6. **Code drift.** If a prefix appears in the database and `rg` finds no emitter in `trader/`, the **running process is older than the repo** (or the string was removed). Do not treat that prefix as current behavior. Tell the user a restart is required before judging the new code. Known stale prefix from 2026-09-30: `entry_kill` (including `market_data_type_3` and `reconcile_mismatch`) — not in current `trader/`.
7. **IBKR path.** A row with `ibkr_order_failed` or `ibkr_cooldown` after a high BUY means risk approved and the broker rejected or cancelled. That is an execution problem, not a confidence problem.
8. **Screener.** `watchlist_screener_ran_at` older than `watchlist_refresh_minutes` during the regular session means rotation did not run. Log line `Jev scan scored too few symbols` with `low_volume` / `below_price` means the scan ran and the universe failed quality gates (`trader/watchlist/screener_scheduler.py`).
9. **Fills match predictions.** `trade_created = true` should have a `trades` row. Open count must be ≤ `max_open_positions`.

## What to recommend

Rank at most five changes. Only recommend a change the data supports. Do not edit code or settings unless the user asks.

| Evidence | Recommendation |
|----------|----------------|
| `hold_dominant` + `sell_dominant` are most skips, few BUY ≥ threshold | Leave filters alone. Universe or Jev is not producing ELIGIBLE buys. |
| Same symbols repeat `spread_too_wide` or `volume_too_low` on high BUY | Those names fail liquidity. Screener quality, not a lower confidence. |
| Many `awaiting_confirmation (1/2)` and no later fill | Signal does not persist. Do not lower confirmation until a symbol shows 2/2 and then a bad fill. |
| `ibkr_order_failed` then `ibkr_cooldown` | Broker cancel. Inspect Gateway; cooldown is working if the next row is `ibkr_cooldown`. |
| `entry_kill` or any prefix missing from source | Restart after pulling current code before tuning settings. |
| Screener timestamp stale through the session | Scheduler did not complete; check the warning counters, not `minimum_jev_confidence`. |
| Predictions stop at 16:00 ET while heartbeat stays fresh | Market-hours gate is working. No overnight entries expected. |

## Report

1. Session window and whether the bot was online.
2. Working vs drift (table).
3. Skip mix in one short paragraph.
4. Near-misses that almost traded.
5. Up to five improvements, each tied to a count or a symbol.
6. Restart only if env files changed or the running process is stale versus source. Supabase setting changes do not need a restart.
