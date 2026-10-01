---
name: evaluate-prediction-strategy
description: Compares market-pilot Jev predictions to trades over the last 24 hours using min confidence, BUY–HOLD/BUY–SELL margins, and exit thresholds to judge whether the entry/exit strategy is working. Use when the user asks if predictions vs trades are a good strategy, calibration sanity check, whether min threshold is too high/low, or hold/sell gates are blocking good or bad trades. Read-only Supabase MCP. Never restart the trader.
---

# Evaluate prediction vs trade strategy (24h)

Read-only. Use Supabase MCP `execute_sql` on project `gbprapqifrvhylfazjvs` (namespace `project-0-market-pilot-supabase`). Load [supabase](../supabase/SKILL.md) if MCP auth fails. Do not restart `python main.py`.

This skill answers: **given current gates, did Jev’s BUY/HOLD/SELL signals and the trades we took (or skipped) look like a sensible strategy in the last ~24 hours?**

Not the same as **review-trading-session** (pipeline health) or **diagnose-trader** (one symbol / offline). Not a promise of future P&amp;L — use “tended to,” “on average,” “sanity check.”

## Column names (live schema)

| Table | Use | Do not use |
|-------|-----|------------|
| `predictions` | `buy_probability`, `hold_probability`, `sell_probability`, `timestamp`, `created_at`, `trade_created`, `trade_skip_reason`, `return_15m_pct`, `price` | `buy`, `hold`, `sell` |
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
  count(*) FILTER (WHERE trade_created) AS trade_created_count,
  count(*) FILTER (WHERE return_15m_pct IS NOT NULL) AS matured_forward_returns
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
    return_15m_pct,
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

## Step 5 — Did high-confidence BUY predict 15m moves?

Forward returns are **analytics only** (backfill in trader; dashboard calibration). They do not change live Jev calls.

For the 24h window, among rows with `return_15m_pct` set:

```sql
WITH s AS (SELECT minimum_jev_confidence FROM settings WHERE id = 1)
SELECT
  count(*) AS n,
  avg(return_15m_pct) AS avg_return_15m,
  avg(buy_probability) AS avg_buy
FROM predictions p
CROSS JOIN s
WHERE coalesce(p.timestamp, p.created_at) >= now() - interval '24 hours'
  AND p.return_15m_pct IS NOT NULL
  AND p.buy_probability >= s.minimum_jev_confidence;
```

Compare to BUY at or above threshold but **no trade** (same filter + `trade_created = false`) and to all matured rows below threshold. Optional: `SELECT * FROM get_jev_calibration_buckets(1)` for bucket view (defaults to ~1 day of matured rows in RPC window; dashboard uses 14 days — mention which you used).

**Good calibration (sanity check):** buckets at/above min confidence show **higher average `return_15m_pct`** than lower buckets, and ELIGIBLE-tier rows that became trades are not systematically worse than ELIGIBLE rows that were skipped for non-Jev reasons.

If almost no `return_15m_pct` in 24h, say predictions are still maturing (~15m after signal) and widen lookback to 48–72h for forward-return stats only (keep trades at 24h unless the user asks otherwise).

## Step 6 — Match trades to predictions (by symbol + time)

There is no `prediction_id` on `trades`. For each closed trade in 24h, fetch the prediction closest to `entry_time`:

```sql
SELECT t.symbol, t.entry_time, t.net_pnl, t.exit_reason,
       p.buy_probability, p.hold_probability, p.sell_probability,
       p.trade_skip_reason, p.return_15m_pct,
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

Check: entry rows should look ELIGIBLE (high BUY, BUY-dominant); if `return_15m_pct` is negative on many entries while skips had better forward returns, min threshold or filters may be misaligned.

For exits driven by Jev SELL, scan predictions while trade was open for SELL-dominant rows above `jev_sell_exit_threshold`.

## Step 7 — Verdict rubric

State one of **looks aligned**, **mixed**, or **misaligned**, with evidence:

| Evidence | Interpretation |
|----------|----------------|
| Closed trades net positive; ELIGIBLE matured returns ≥ below-threshold returns | Strategy gates match signal quality for the day |
| Many ELIGIBLE rows, few trades, skips are filters/confirmation/IBKR | Jev is fine; execution or filter stack is the bottleneck |
| Dominant `hold_dominant` / `sell_dominant`; few BUY ≥ threshold | Lowering min confidence alone won’t help much |
| High BUY but `buy_hold_margin` / `buy_sell_margin` skips | Margins may be too strict vs model spread |
| Trades underperform ELIGIBLE non-traded forward returns | Entries may be worse than passively skipped names — review confirmation and filters |
| `below_trade_threshold` dominates but 70–80% buckets beat 80–90% | `minimum_jev_confidence` may be too high |
| Calibration flat or inverted above threshold | Jev BUY scores not sorting 15m returns — tuning threshold is secondary |

Recommend at most **three** concrete knobs (e.g. min confidence, margins, confirmation cycles, `jev_sell_exit_threshold`) only when counts support it. Do not change settings or code unless the user asks.

## Report template

1. **Thresholds in plain language** (min BUY %, record %, hold/sell margins, SELL exit %, min hold).
2. **24h trades** — count, P&amp;L, win rate, exits.
3. **24h predictions** — volume, traded vs skipped, top skip reasons.
4. **Jev tier vs fills** — eligible_by_jev_tier vs `trade_created`, notable near-misses.
5. **Forward returns** — at/above threshold vs below (note maturation if sparse).
6. **Per-trade spot checks** — 2–5 symbols: entry probabilities vs outcome.
7. **Verdict** — aligned / mixed / misaligned + up to 3 evidence-backed suggestions.

## Code references

- Tier math: `trader/strategy/signals.py`
- Live eval loop: `trader/runtime/entry_eval.py`
- Dashboard calibration mirror: `dashboard/lib/jev-calibration.ts`, RPC `get_jev_calibration_buckets`
