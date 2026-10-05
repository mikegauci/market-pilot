---
name: diagnose-trader
description: Read-only investigation of market-pilot trader health and missed trades using Supabase MCP execute_sql on project gbprapqifrvhylfazjvs. Use when the user asks why a symbol did not trade, bot offline, heartbeat stale, skip reasons, or risk rejections — without restarting the trader.
---

# Diagnose trader (read-only)

Answer “is the bot alive?” and “why no trade on SYMBOL?” using Supabase data and log context. **Never** restart, stop, or kill `python main.py` in `trader/`.

Load [supabase](../supabase/SKILL.md) for MCP usage. Project ref: `gbprapqifrvhylfazjvs`.

## 1. Is the trader online?

```sql
SELECT
  enabled,
  trading_mode,
  execution_mode,
  ibkr_connected,
  jev_connected,
  last_heartbeat,
  last_error,
  now() - last_heartbeat AS heartbeat_age
FROM bot_status
WHERE id = 1;
```

- Dashboard treats trader as offline when heartbeat is older than ~30s.
- `enabled = false` → no new entries (exits/heartbeats may still run).
- `last_error` → recent engine fault string.

## 2. Current settings gate

```sql
SELECT
  enabled,
  minimum_jev_confidence,
  signal_record_threshold,
  max_open_positions,
  max_daily_loss,
  min_share_price,
  min_volume_ratio,
  min_hold_minutes,
  jev_sell_exit_threshold
FROM settings s
CROSS JOIN bot_status b ON b.id = 1
WHERE s.id = 1;
```

Compare Jev BUY % on predictions to `minimum_jev_confidence` (trade threshold).

## 3. Why no trade? — predictions

Column name is **`trade_skip_reason`** on **`predictions`**, not `skip_reason`.

Recent skips for one symbol:

```sql
SELECT created_at, symbol, buy, hold, sell, trade_created, trade_skip_reason
FROM predictions
WHERE symbol = 'NVDA'
ORDER BY created_at DESC
LIMIT 20;
```

Aggregate (last 24h):

```sql
SELECT trade_skip_reason, count(*) AS n
FROM predictions
WHERE created_at > now() - interval '24 hours'
  AND trade_created = false
  AND trade_skip_reason IS NOT NULL
GROUP BY 1
ORDER BY n DESC;
```

ELIGIBLE but still no trade → check open trades and risk logs in skip reason (`max_open_positions`, etc.).

## 4. Map skip reasons to code

| Prefix / value | Source |
|----------------|--------|
| `buy_hold_margin` | `trade_skip_reason_from_tier` — BUY strong but BUY−HOLD margin too small (`trader/strategy/signals.py`) |
| `below_trade_threshold` | Tier is RECORD not ELIGIBLE |
| `hold_dominant`, `sell_dominant`, `signal_not_eligible` | Non-BUY or weak BUY tier |
| `awaiting_confirmation (n/m)` | `trader/main.py` — need consecutive ELIGIBLE cycles |
| `price_too_low (...)` | `check_entry_filters` — min share price |
| `spread_too_wide (...)` | `trader/strategy/filters.py` |
| `rsi_overbought (...)` | filters |
| `volume_too_low (...)` | filters / min_volume_ratio |
| `price_below_ema20` | filters |
| `benchmark_headwind (...)` | filters (SPY/EEM 5m) |
| `news_sentiment_bearish`, `news_block_tag`, `news_earnings_window` | filters |
| `correlation_cap (...)` | `check_correlation_cap` |
| `bot_disabled`, `invalid_price`, `already_open`, `max_open_positions`, `position_too_small`, `insufficient_capital`, `max_daily_loss` | `trader/risk/manager.py` |
| `ibkr_not_connected`, `ibkr_order_failed (...)`, KID/permission strings | `trader/main.py` IBKR path |
| Reentry / cooldown | search `reentry` in `trader/main.py` and risk |

Dashboard surfaces aggregates in skip-reason analytics; reason strings should stay stable for grepping.

## 5. Open trades and capacity

```sql
SELECT symbol, status, execution_mode, entry_price, opened_at
FROM trades
WHERE status = 'open'
ORDER BY opened_at;
```

```sql
SELECT count(*) FILTER (WHERE status = 'open') AS open_n,
       count(*) FILTER (WHERE status = 'closed' AND closed_at::date = current_date) AS closed_today
FROM trades;
```

## 6. Quotes and watchlist freshness

```sql
SELECT symbol, price, bid, ask, updated_at
FROM market_snapshots
WHERE symbol IN ('EEM', 'NVDA')  -- benchmark + watchlist symbol
ORDER BY updated_at DESC;
```

Stale snapshots with fresh heartbeat → data path or symbol not subscribed.

## 7. Watchlist (manual)

Entry eval uses the saved watchlist plus any open positions (for exits). The benchmark symbol (default **EEM**) is subscribed for headwind context but is not an entry candidate.

```sql
SELECT watchlist, benchmark_symbol, updated_at
FROM settings
WHERE id = 1;
```

If a symbol never appears in recent predictions, it is not on `watchlist` and has no open position. After a settings change in the dashboard, the trader picks up the new list on the next settings refresh (no restart required).

## 8. Report back

Summarize in plain language:

1. Trader online? IBKR/Jev flags?
2. Bot enabled and thresholds?
3. For SYMBOL: last predictions + dominant `trade_skip_reason`
4. Actionable fix (settings change, wait for confirmation, market hours, IBKR) — **ask user to restart trader only if they changed env files**, not for Supabase settings alone.
