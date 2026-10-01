# Trader refactor ledger

| Field | Value |
| --- | --- |
| Baseline revision | `f0d1349` |
| Scope | `trader/` |
| Latest pytest | 202 passed (`.venv` Python 3.9.6) |
| Updated | 2026-10-01 |

## Phase A — Defect fixes (complete)

| ID | Status | Notes |
| --- | --- | --- |
| A1 Forward-return backfill | done | Mature rows (`timestamp <= now-15m`), oldest-first; bar batching by symbol |
| A2 Trade row hydration | done | `_trade_from_row` maps `commission` → `entry_commission`, `ibkr_account_id` |
| A3 Account-scoped daily PnL | done | `daily_pnl_account_id` threaded through main, execution, manual close |

**Pending runtime:** Restart trader (`python main.py` in `trader/`) so backfill and scoped PnL run in production.

## Phase B — Refactor stages (complete)

| Stage | Status | Notes |
| --- | --- | --- |
| B1 Characterization tests | done | `tests/test_eval_cycle.py`, prediction payload tests |
| B2 Runtime state object | done | `runtime/state.py`, `TraderRuntimeState` in `run()` |
| B3 Close + PnL helper | done | `runtime/sim_close.py` → `persist_simulated_closes` |
| B4 Entry eval extraction | done | `runtime/entry_eval.py` → `process_ready_states` |
| B5 Startup + heartbeat | done | `runtime/startup.py`, `runtime/heartbeat.py` |
| B6–7 Hygiene | done | Pure `database/prediction_payload.py`; single `strategy_config` in loop; timing/capital modules |

## Phase C — Deferred

- Partial-fill bracket quantity mismatch
- Unsafe retry on `insert_trade` after ambiguous commit
- Screener full-universe quote snapshot churn
- `_available_cash` vs IBKR net liquidation double-count
- Dead code: `HistoryStore`, unused helpers
- Per-cycle cache for `include_legacy_untagged_trades`
- Packaging: pytest/httpx in pyproject, `apply_schema.py` vs MCP rule

## Checks log

| When | Command | Result |
| --- | --- | --- |
| Baseline | `cd trader && .venv/bin/python -m pytest tests -q` | 196 passed |
| After Phase A+B | same | 202 passed |
