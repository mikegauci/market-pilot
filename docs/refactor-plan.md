# Trader refactor ledger

| Field | Value |
| --- | --- |
| Baseline revision | `f0d1349` |
| Scope | `trader/` |
| Latest pytest | 208 passed (`.venv` Python 3.9.6) |
| Updated | 2026-10-01 |

## Phase A — Defect fixes (complete)

| ID | Status | Notes |
| --- | --- | --- |
| A1 Forward-return backfill | removed | Dropped 2026-10-05 (Jev calibration feature); DB via MCP `remove_jev_calibration` |
| A2 Trade row hydration | done | `_trade_from_row` commission + `ibkr_account_id` |
| A3 Account-scoped daily PnL | done | `daily_pnl_account_id` through close paths |

## Phase B — Refactor stages (complete)

Runtime extraction (`runtime/*`), `process_ready_states`, heartbeat/startup modules, pure prediction payload.

## Phase C — Deferred → complete (2026-10-01)

| ID | Status | Notes |
| --- | --- | --- |
| C1 Partial-fill brackets | done | Resize SL/TP to filled qty; cancel open parent remainder |
| C2 `insert_trade` retry | done | Idempotent by trade id before insert + post-error existence check |
| C3 NLV vs buying power | done | `set_ibkr_buying_power` + `sync_risk_manager_capital` |
| C4 Legacy untagged cache | done | Per-account cache on `SupabaseRepository`; invalidate on tagged insert |
| C5 Screener quote churn | done | Snapshot = manual watchlist + benchmark + open positions |
| C6 Dead `HistoryStore` | done | Removed `market/history.py` and unused seed paths |
| C7 Packaging | done | `httpx` in pyproject deps; optional `dev` pytest; `apply_schema.py` deprecation note |

## Checks log

| When | Command | Result |
| --- | --- | --- |
| Baseline | `cd trader && .venv/bin/python -m pytest tests -q` | 196 passed |
| After A+B | same | 202+ passed |
| After backfill fix | same | 204 passed |

**Runtime:** Restart trader after pull when Python changes affect IBKR entries, capital sync, or backfill.
