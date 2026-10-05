---
name: evaluate-prediction-strategy
description: Compares market-pilot Jev predictions to trades over the last 24 hours using min confidence, BUY–HOLD/BUY–SELL margins, and exit thresholds to judge whether the entry/exit strategy is working. Use when the user asks if predictions vs trades are a good strategy, whether min threshold is too high/low, or hold/sell gates are blocking good or bad trades. Read-only Supabase MCP. Never restart the trader.
---

# Evaluate prediction vs trade strategy (24h)

Read-only. Use Supabase MCP `execute_sql` on project `gbprapqifrvhylfazjvs` (namespace `project-0-market-pilot-supabase`). Load [supabase](../supabase/SKILL.md) if MCP auth fails. Do not restart `python main.py`.

This skill answers: **given current gates, did Jev’s BUY/HOLD/SELL signals and the trades we took (or skipped) look like a sensible strategy in the last ~24 hours?**

Not the same as **review-trading-session** (pipeline health) or **diagnose-trader** (one symbol / offline). Not a promise of future P&amp;L — use “tended to,” “on average,” “sanity check.”

## Column names (live schema)

| Table | Use | Do not use |
|-------|-----|------------|
| `predictions` | `buy_probability`, `hold_probability`, `sell_probability`, `timestamp`, `created_at`, `trade_created`, `trade_skip_reason`, `price` | `buy`, `hold`, `sell` |
| `trades` | `entry_time`, `exit_time`, `status`, `net_pnl`, `exit_reason`, `symbol`, `entry_price`, `exit_price` | `opened_at`, `closed_at` |
| `settings` | `minimum_jev_confidence`, `signal_record_threshold`, `jev_sell_exit_threshold`, `min_hold_minutes`, … | — |

Predictions use both `timestamp` (signal time) and `created_at`; prefer **`timestamp`** for alignment with price/returns, **`created_at`** for “when the row landed” if needed.

## Step 1 — Active thresholds

From DB:

```sql
SELECT
  minimum_jev_confidence,
  signal_record_threshold,
  jev_sell_exit_threshold,
  min_hold_minutes,
  confirmation_cycles,
  confirmation_seconds,
  stop_loss_percentage,
  take_profit_percentage,
  max_hold_minutes
FROM settings
WHERE id = 1;
```

**BUY–HOLD / BUY–SELL margins** are not in `settings`. They come from trader env (`STRATEGY_MIN_BUY_HOLD_MARGIN`, `STRATEGY_MIN_BUY_SELL_MARGIN`) with defaults in `trader/strategy/config.py` (currently **0.15** and **0.10**). Read `trader/.env` when present; otherwise use defaults and say so.

Entry tier logic (must match `trader/strategy/signals.py`):

1. **Dominant side** = max of buy, hold, sell probabilities.
2. If not BUY-dominant → skip (`hold_dominant` / `sell_dominant`).
3. If BUY-dominant and `buy_probability >= minimum_jev_confidence` and margins pass → **ELIGIBLE** (before filters/confirmation).
4. If BUY-dominant and `buy_probability >= signal_record_threshold` but below trade threshold → **RECORD** (`below_trade_threshold`).
5. SELL soft-exit: SELL-dominant and `sell_probability >= jev_sell_exit_threshold` (after `min_hold_minutes` on open trades).

Report thresholds in **percent** in the user-facing summary (e.g. 85% min confidence).

## Step 2 — Trades (last 24 hours)

```sql
SELECT
  symbol,
  status,
  entry_time,
  exit_time,
  entry_price,
  exit_price,
  net_pnl,
  exit_reason
FROM trades
WHERE entry_time >= now() - interval '24 hours'
   OR (status = 'open' AND entry_time >= now() - interval '7 days')
ORDER BY entry_time DESC;
```

Summarize: count closed, sum `net_pnl`, win rate, average hold time, top `exit_reason` values. Open trades: note they have no final verdict yet.

## Step 3 — Predictions (last 24 hours)

Volume and trade linkage:

```sql
SELECT
  count(*) AS predictions,
  count(*) FILTER (WHERE trade_created) AS trade_created_count
FROM predictions
WHERE coalesce(timestamp, created_at) >= now() - interval '24 hours';
```

Skip mix:

```sql
SELECT split_part(trade_skip_reason, ' ', 1) AS reason_prefix,
       count(*) AS n
FROM predictions
WHERE coalesce(timestamp, created_at) >= now() - interval '24 hours'
  AND trade_created = false
  AND trade_skip_reason IS NOT NULL
GROUP BY 1
ORDER BY n DESC;
```

## Step 4 — Recompute “would be ELIGIBLE” vs what happened

Use `@min_hold_margin` and `@min_sell_margin` as decimals (e.g. 0.15, 0.10) from Step 1.

```sql
WITH s AS (
  SELECT minimum_jev_confidence, signal_record_threshold
  FROM settings WHERE id = 1
),
p AS (
  SELECT
    id,
    symbol,
    buy_probability,
    hold_probability,
    sell_probability,
    trade_created,
    trade_skip_reason,
    coalesce(timestamp, created_at) AS t
  FROM predictions
  WHERE coalesce(timestamp, created_at) >= now() - interval '24 hours'
)
SELECT
  count(*) FILTER (WHERE buy_probability >= hold_probability
                     AND buy_probability >= sell_probability
                     AND buy_probability >= s.minimum_jev_confidence
                     AND (buy_probability - sell_probability) >= 0.10
                     AND (buy_probability - hold_probability) >= 0.15) AS eligible_by_jev_tier,
  count(*) FILTER (WHERE trade_created) AS actually_traded,
  count(*) FILTER (WHERE buy_probability >= hold_probability
                     AND buy_probability >= sell_probability
                     AND buy_probability >= s.minimum_jev_confidence
                     AND (buy_probability - sell_probability) >= 0.10
                     AND (buy_probability - hold_probability) >= 0.15
                     AND trade_created = false) AS eligible_but_no_trade
FROM p
CROSS JOIN s;
```

Replace `0.10` / `0.15` with live margins when known. **eligible_but_no_trade** → filters, confirmation, risk, IBKR, or `entry_window_closed` (see skip reasons on those rows).

Near-misses (high BUY, tier blocked):

```sql
SELECT symbol, buy_probability, hold_probability, sell_probability,
       trade_skip_reason, coalesce(timestamp, created_at) AS t
FROM predictions
WHERE coalesce(timestamp, created_at) >= now() - interval '24 hours'
  AND trade_created = false
  AND buy_probability >= (SELECT minimum_jev_confidence FROM settings WHERE id = 1)
ORDER BY buy_probability DESC
LIMIT 25;
```

## Step 5 — Match trades to predictions (by symbol + time)

There is no `prediction_id` on `trades`. For each closed trade in 24h, fetch the prediction closest to `entry_time`:

```sql
SELECT t.symbol, t.entry_time, t.net_pnl, t.exit_reason,
       p.buy_probability, p.hold_probability, p.sell_probability,
       p.trade_skip_reason,
       abs(extract(epoch FROM (p.timestamp - t.entry_time))) AS sec_from_entry
FROM trades t
LEFT JOIN LATERAL (
  SELECT *
  FROM predictions p2
  WHERE p2.symbol = t.symbol
    AND p2.timestamp BETWEEN t.entry_time - interval '2 minutes'
                         AND t.entry_time + interval '2 minutes'
  ORDER BY abs(extract(epoch FROM (p2.timestamp - t.entry_time)))
  LIMIT 1
) p ON true
WHERE t.entry_time >= now() - interval '24 hours'
  AND t.status = 'closed'
ORDER BY t.entry_time DESC;
```

Check: entry rows should look ELIGIBLE (high BUY, BUY-dominant). Compare `net_pnl` and skip reasons on near-miss symbols when judging threshold and filters.

For exits driven by Jev SELL, scan predictions while trade was open for SELL-dominant rows above `jev_sell_exit_threshold`.

## Step 6 — Verdict rubric

State one of **looks aligned**, **mixed**, or **misaligned**, with evidence:

| Evidence | Interpretation |
|----------|----------------|
| Closed trades net positive; ELIGIBLE tier mostly became trades or skipped for non-Jev reasons | Strategy gates match signal quality for the day |
| Many ELIGIBLE rows, few trades, skips are filters/confirmation/IBKR | Jev is fine; execution or filter stack is the bottleneck |
| Dominant `hold_dominant` / `sell_dominant`; few BUY ≥ threshold | Lowering min confidence alone won’t help much |
| High BUY but `buy_hold_margin` / `buy_sell_margin` skips | Margins may be too strict vs model spread |
| Many ELIGIBLE rows skipped with filter/confirmation reasons while traded names lose | Filters or confirmation may be too loose on entries that pass |
| `below_trade_threshold` dominates with strong near-miss BUY scores | `minimum_jev_confidence` or margins may be too high |

Recommend at most **three** concrete knobs (e.g. min confidence, margins, confirmation cycles, `jev_sell_exit_threshold`) only when counts support it. Do not change settings or code unless the user asks.

## Report template

1. **Thresholds in plain language** (min BUY %, record %, hold/sell margins, SELL exit %, min hold).
2. **24h trades** — count, P&amp;L, win rate, exits.
3. **24h predictions** — volume, traded vs skipped, top skip reasons.
4. **Jev tier vs fills** — eligible_by_jev_tier vs `trade_created`, notable near-misses.
5. **Per-trade spot checks** — 2–5 symbols: entry probabilities vs outcome.
6. **Verdict** — aligned / mixed / misaligned + up to 3 evidence-backed suggestions.

## Code references

- Tier math: `trader/strategy/signals.py`
- Live eval loop: `trader/runtime/entry_eval.py`
