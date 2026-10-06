# Trader refactor ledger

| Field | Value |
| --- | --- |
| Baseline revision | `dc29099` |
| Scope | Phase E complete (E1–E4); review follow-ups |
| Latest pytest | 247 passed (`.venv` Python 3.9.6) |
| Latest vitest | 166 passed (`dashboard`) |
| Updated | 2026-10-06 |

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

## Phase D — Maintainability (complete 2026-10-06)

| ID | Status | Notes |
| --- | --- | --- |
| D0 Ledger + import hygiene | done | Tests import `runtime.timing`, `runtime.eval_symbols`, `runtime.jev_fetch` |
| D1 `entry_eval` tests | done | `tests/test_entry_eval.py` characterization (skip, confirmation, sim, IBKR block) |
| D2 Rotation orchestration | done | `watchlist/rotation_runtime.py`; `verify_rotation_ready.py` shares builder |
| D3 Main loop extraction | done | `runtime/loop/eval_cycle.py` + `runtime/trader_ops.py`; `main.py` ~520 lines |
| D4 Runtime unit tests | done | `tests/test_runtime_modules.py`, `tests/test_rotation_runtime.py` |
| D5 Supabase split | done | Helpers in `database/supabase_support.py`; repository composes via namespace merge |
| D6 IBKR + packaging | done | Package `broker/ibkr/` (`client.py`, `_util.py`); `pyproject` `find` packages, `>=3.9` |

## Checks log

| When | Command | Result |
| --- | --- | --- |
| Phase D baseline | `cd trader && .venv/bin/python -m pytest tests -q` | 232 passed |
| After Phase D | same | 243 passed |
| After Phase E1 slices | same | 247 passed |
| After Phase E3 deep splits | same | 247 passed |
| After Phase E4 + review fixes | `cd dashboard && npm run test` | 166 passed |

## Phase E — Maintainability (complete 2026-10-06)

| ID | Status | Notes |
| --- | --- | --- |
| E1 Cycle module split | done | `runtime/loop/eval_cycle_state.py`, `cycle_sync`, `cycle_quotes`, `cycle_rotation`, `cycle_exits`, `cycle_eval`, `cycle_tail`; `eval_cycle.py` orchestrates |
| E2 Dashboard D1–D3 | done | `lib/supabase/data-reads.ts` shared reads; `fetchSettings` + RSC `getPredictions` use normalize/feed select; `ibkr-trade-scope.test.ts` |
| E3 Deep splits | done | `database/repository/*` mixins; `broker/ibkr/_connection`, `_contracts`, `_market_data`, `_orders`, `_sync` |
| E4 Dashboard D4–D6 | done | `settings-form-descriptions`, `settings-form-fields`, `watchlist-symbols`; `server-only` on RSC reads |
| E4r Review follow-ups | done | Removed unused `repository/_common.py`; `prediction-feed-read.test.ts` for shared feed read |

**Runtime:** Restart the trader after pull when Python changes affect the eval loop, rotation, IBKR client layout, or Supabase repository wiring (`python main.py` in `trader/`).
