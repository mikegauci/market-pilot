# Supabase quota (Free plan)

Dashboard **Usage** tracks egress, log ingestion, Realtime messages, and storage. On Free tier, **egress** and **log ingestion** are usually the first limits you hit — not Realtime message count.

## What drove overages in this project

| Source | Why it costs |
|--------|----------------|
| **Dashboard polling** | Many components each hit PostgREST every few seconds → **egress** + **API logs**. |
| **Realtime on `predictions`** | Each trader insert triggered multiple full refetches. |
| **`select *` + `market_snapshot` JSON** | Large payloads on every poll. |
| **Duplicate latest-prediction polls** | Overview market card + Strategy grid each polled separately (fixed: shared provider). |
| **Trader** | Heartbeat, portfolio history, prediction inserts. |

`market_snapshots` is **not used by the dashboard**; it only grows if `MARKET_SNAPSHOTS_ENABLED=true`.

## Dashboard defaults (quota-aware)

| Knob | Location | Default |
|------|-----------|---------|
| Poll interval | `live-data-config.ts` | 10s |
| Settings poll | `live-data-config.ts` | 120s |
| Realtime | `live-data-config.ts` | Off for `predictions` |
| Skip-reason window | `analytics-data.ts` | 48h |

## Trader

- `MARKET_SNAPSHOTS_ENABLED=false`
- `portfolio_history_interval_sec` default **60**

## Ops

1. One dashboard tab during sessions.
2. `SELECT * FROM public.prune_stale_market_data(14);` periodically.
3. Billing cycle reset on Free plan after quota exceeded.

## DB helpers (MCP)

- `get_latest_predictions_per_symbol(row_limit)` — one row per symbol (Overview/Strategy)
- `prune_stale_market_data(retention_days)`

Apply these on any new Supabase project before deploying dashboard builds that call the RPCs.
