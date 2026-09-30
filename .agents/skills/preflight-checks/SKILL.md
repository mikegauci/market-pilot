---
name: preflight-checks
description: Run market-pilot verification before commit or push — trader pytest, dashboard vitest, eslint, and next build. Use when finishing a feature, fixing CI/Vercel build failures, or before any change touching dashboard/ or trader/.
---

# Preflight checks

There is no GitHub Actions CI in this repo. Vercel runs `next build` on deploy; several past fixes were TypeScript-only failures caught only in production build.

## Do not restart processes

Per `.cursor/rules/no-process-restarts.mdc`: never restart, stop, or kill the trader or dashboard dev server to verify code. Run tests and builds only. Tell the user to restart the trader when they need to pick up Python changes (`python main.py` in `trader/`).

## Full preflight (both apps touched or unsure)

From repo root:

```bash
cd trader && .venv/bin/python -m pytest tests -q
cd ../dashboard && npm run test && npm run lint && npm run build
```

## Trader only

```bash
cd trader && .venv/bin/python -m pytest tests -q
```

Use **`.venv/bin/python`**, not bare `python`. The venv may differ from `requires-python = ">=3.11"` in `pyproject.toml`.

Create venv if missing:

```bash
cd trader && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

## Dashboard only

```bash
cd dashboard && npm run test && npm run lint && npm run build
```

**`npm run build` is mandatory** for any dashboard change. Vitest and eslint do not catch:

- `SettingsRow` / partial Supabase row typing
- Missing exports or wrong `SortKey` inference
- Next.js 16 app router type errors

## When to run what

| Change location | Minimum |
|-----------------|---------|
| `trader/**` | pytest |
| `dashboard/**` | test + lint + **build** |
| `settings` column / types / forms | pytest + test + lint + **build** |
| Docs only | optional |

## If something fails

1. Fix the reported error; do not skip hooks or build.
2. Re-run the failed command only, then full preflight before commit.
3. Do not amend commits unless user rules allow; prefer a new commit after hook fixes.

## Related skills

- **add-trading-setting** — ends with this preflight.
- **add-strategy-filter** — add or extend tests in `trader/tests/test_strategy.py`.
