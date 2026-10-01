# Supabase quota (Free plan)

Dashboard **Usage** tracks egress, log ingestion, Realtime messages, and storage. On Free tier, **egress** and **log ingestion** are usually the first limits you hit — not Realtime message count.

## What drove overages in this project

| Source | Why it costs |
|--------|----------------|
| **Dashboard polling** | Many components each hit PostgREST every few seconds → **egress** + **API logs**. |
| **Realtime on `predictions`** | Each trader insert triggered multiple full refetches. |
| **`select *` + `market_snapshot` JSON** | Large payloads on every poll. |
| **Duplicate latest-prediction polls** | Overview market card + Strategy grid each polled separately (fixed: shared provider). |
| **Calibration (old)** | Downloaded 1.5k+ rows per Analytics visit (fixed: optional RPC, ~5 rows). |
| **Trader** | Heartbeat, portfolio history, prediction inserts. |

`market_snapshots` is **not used by the dashboard**; it only grows if `MARKET_SNAPSHOTS_ENABLED=true`.

## Jev calibration — do you need it?

**No for trading.** Calibration is a post-hoc sanity check: “when BUY was X%, what was the average 15m price move?” It does **not** feed Jev or change entries.

- Chart is **hidden by default** on Analytics — click **Show calibration** to load once.
- Data comes from `return_15m_pct` on past predictions. With `FORWARD_RETURN_BACKFILL_ENABLED=false`, new rows won’t get returns; older backfilled rows still show in the **14-day** window.
- Aggregation runs in Postgres (`get_jev_calibration_buckets`) — not thousands of rows to the browser.

To tune the window, change `ANALYTICS_CALIBRATION_LOOKBACK_DAYS` in `dashboard/lib/analytics-data.ts` (days, not minutes). The **15m** horizon is the product definition of “did the move happen after the signal”; changing that would mean new columns (5m/30m), not polling interval.

## Dashboard defaults (quota-aware)

| Knob | Location | Default |
|------|-----------|---------|
| Poll interval | `live-data-config.ts` | 10s |
| Settings poll | `live-data-config.ts` | 120s |
| Realtime | `live-data-config.ts` | Off for `predictions` |
| Skip-reason window | `analytics-data.ts` | 48h |
| Calibration lookback | `analytics-data.ts` | 14 days, on-demand RPC |

## Trader

- `FORWARD_RETURN_BACKFILL_ENABLED=false` — keep off unless you want calibration data filled going forward.
- `MARKET_SNAPSHOTS_ENABLED=false`
- `portfolio_history_interval_sec` default **60**

## Ops

1. One dashboard tab during sessions.
2. `SELECT * FROM public.prune_stale_market_data(14);` periodically.
3. Billing cycle reset on Free plan after quota exceeded.

## DB helpers (MCP)

- `get_jev_calibration_buckets(lookback_days)` — calibration chart (~5 rows)
- `get_latest_predictions_per_symbol(row_limit)` — one row per symbol (Overview/Strategy)
- `predictions_calibration_mature_idx` / `predictions_forward_backfill_pending_idx`
- `prune_stale_market_data(retention_days)`

Apply these on any new Supabase project before deploying dashboard builds that call the RPCs.
