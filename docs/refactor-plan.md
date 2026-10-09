# Refactor ledger: consolidation pass

Baseline revision: `b74a3d4` (2026-10-09)

## Checks
| | Baseline | After |
| --- | --- | --- |
| Trader `pytest tests -q` | 352 passed | 372 passed |
| Dashboard `npm run test` | 289 passed | 297 passed |
| Dashboard `npm run lint` | clean | clean |
| Dashboard `next build --webpack` | passes | passes |

Turbopack `next build` can't run in the Claude sandbox ("binding to a port: Operation not permitted"). The webpack build, which includes the type check, was used instead. Vercel's Turbopack build hasn't been run locally.

## Stages
| Stage | Status | Notes |
| --- | --- | --- |
| A1 Settings AI summary equity | done | `resolveSettingsEquities` is shared with the Settings page |
| A2 Session brief settings and scope | done | Verified by type check only; no action-level test |
| A3 Cover-short double submit | done (Stage C) | Also fixed Cancel on Buy and Cover, which didn't close the dialog |
| A4 Python 3.9 timestamp parsing | done | `models/timestamps.py` |
| A5 Missing DB locks | done | |
| A6 Open-position backfill freshness | done | |
| A7 verify_rotation_ready drift | done (Stage E) | |
| A8 Predictions feed news aliases | not a bug | Commit 1896c2c chose it on purpose; the unused select was removed |
| B AI modules | done | `lib/openai/*`, `useServerResult`, `AiExplainToggle` |
| C Command actions and dialogs | done | `enqueueCommand`, `CommandConfirmDialog` |
| D Live polls and hooks | done | `ShellLiveDataProvider`; `useTraderOnline` re-renders only when the state flips |
| E Trader commands and DB reads | done | Command queues; settings read once (golden test); one bot_status read per sync; lazy daily P&L; profile cache |
| F Close P&L | partly done | `risk/pnl.py` and `_book_ibkr_close` are done. `_orders.py` order construction is deferred: it can't be verified without IB Gateway |
| G Dead code | done | |

## Pending runtime verification (for the user)
- Restart the trader to pick up the Python changes. Watch for one heartbeat and one paper cycle.
- Deploy the dashboard (Vercel runs the Turbopack build), then check Overview, Settings, the AI buttons, and the Buy, Close and Cover dialogs.

## Deferred
- `_orders.py`: `_new_order`, `_market_order_and_wait`, and the terminal status sets. `_cancel_trade` leaves out `ApiCancelled`; check whether that's deliberate.
- A shared trade-commands poll (`positions-grid`, `trades-table`).
- Formatter merges: `pnlClass`, signed and fraction percent, chart time zone.
- Band-exit loop unification.
- An HTTP retry helper and a shared httpx client for Jev and news.
- Small Python helpers: `_ensure_utc`, `_coerce_et`, ordered dedupe, `JevPrediction.dominant`.
- Watchlist-universe recompute in rotation.
- Test factories.
- A `data-client.ts` factory and `readScopedTrades`.
