# Refactor ledger: consolidation pass

Baseline revision: `b74a3d4` (2026-10-09)

## Baseline checks
- Trader: `pytest tests -q`: 352 passed.
- Dashboard: `npm run test`: 289 passed (63 files). `npm run lint`: clean.
- Dashboard build: Turbopack `next build` fails in the Claude sandbox ("binding to a port: Operation not permitted"). This is an environment limit. `next build --webpack` passes and includes the type check. Vercel's Turbopack build is still unverified locally.

## Scope
Fix the drift bugs first, then do the highest-value consolidations. Each bug fix is its own commit. Full plan: stages A–G below.

| Stage | Status |
| --- | --- |
| A. Drift bug fixes | in progress |
| B. Dashboard AI modules (runStructured, parseJsonText, withAiAction, useServerResult) | todo |
| C. Dashboard command actions + ConfirmCommandButton | todo |
| D. Dashboard polling and hooks | todo |
| E. Trader commands + DB reads | todo |
| F. Trader broker close path | todo |
| G. Dead code removal | todo |

## Deferred
- Formatter merges (`pnlClass`, signed and fraction percent, chart time zone).
- Band-exit loop unification.
- HTTP retry helper and shared httpx client.
- Small Python helpers: `_ensure_utc`, `_coerce_et`, ordered dedupe, `JevPrediction.dominant`.
- Watchlist-universe recompute in rotation.
- Test factories.
- `data-client.ts` factory and `readScopedTrades`.
