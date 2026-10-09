# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Automated day-trading platform. Three parts share one Supabase Postgres database:

- `trader/` is the Python engine. It is the **only** component that talks to Interactive Brokers (via `ib-insync`) and the only writer of trades. It uses the Supabase service-role key.
- `dashboard/` is a Next.js 16 app (Vercel, root dir `dashboard`). It uses the anon/publishable key with RLS. It never calls IBKR directly.
- `supabase/` holds the schema. The owner's live project ref is `gbprapqifrvhylfazjvs` (also in `supabase/project.ref`). This file is excluded from the friends' release zip.

Jev (TypeSafe AI API, `trader/jev/`) gives BUY/HOLD/SELL probabilities. The risk engine and strategy filters decide whether a prediction becomes a trade. IBKR executes it. Default is always **paper**. Live trading needs both `TRADING_MODE=live` and `LIVE_TRADING_CONFIRMATION=I_UNDERSTAND_LIVE_TRADING`.

## Hard rules (from `.cursor/rules/`)

- **Never restart, stop, kill, or relaunch the trader or dashboard dev server**, and don't use the browser to reload them. If a change needs a running process to pick it up, tell the user which process to restart and why. Code edits, tests, builds and DB reads are fine.
- **Every schema change has two steps.** Before starting, read the `supabase` skill and inspect the existing tables, constraints and RLS policies with MCP (`list_tables`, `execute_sql`). Then (1) add a new `supabase/migrations/YYYYMMDDHHMMSS_short_name.sql`, then (2) apply the same SQL to project `gbprapqifrvhylfazjvs` through the Supabase MCP (`apply_migration` preferred) and verify it with a query. Never edit a migration that has been released; add a new file instead. `make-release.mjs` refuses to ship if the live DB and the migrations disagree. If a fresh DB needs a default row, update `supabase/seed.sql` with `ON CONFLICT DO NOTHING`. `supabase/migrations-archive/` is old history and is not applied. The baseline is `20261008000000_baseline.sql`. Put the migration filename in the commit message.
- **When the user asks for a commit, push in the same turn** (`git push`). Don't ask first unless they said not to push. Never force-push to main.
- **Plan on Opus, build on Sonnet.** Use Opus (plan mode) for design and planning. A session can't switch its own model, so when a plan is approved, stop and ask the user to pick Sonnet in the model menu before editing. Don't start the build on Opus. In the CLI, `/model opusplan` does this automatically.
- **Dashboard copy is plain language** for people new to trading bots. Follow the patterns in `dashboard/lib/settings-form-descriptions.ts` (imported by `settings-form.tsx`): `SETTING_DESCRIPTIONS` is one line of 8–15 words, and `SETTING_DESCRIPTIONS_FULL` is 1–2 sentences in "you" voice. Show probabilities as percents. Never promise profit. Don't suggest that analytics change live bot behavior.

## Commands

There is no CI. Vercel runs `next build` on deploy, and TypeScript-only failures have reached production before. **Always run `npm run build` after dashboard changes.**

```bash
# Trader tests (use the venv python, not bare python)
cd trader && .venv/bin/python -m pytest tests -q
cd trader && .venv/bin/python -m pytest tests/test_strategy.py -q
cd trader && .venv/bin/python -m pytest tests/test_strategy.py -k ema -q

# Dashboard
cd dashboard && npm run test && npm run lint && npm run build
cd dashboard && npx vitest run lib/market-hours.test.ts

# Create the trader venv if missing
cd trader && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Run the trader with `python main.py` in `trader/`. Run the dashboard with `npm run dev` in `dashboard/`. Only do either when the user asks. `DATA_SOURCE=mock` runs without IB Gateway and ignores the market-hours gate, so Jev runs at any time of day. Jev is only called when `JEV_ENABLED=true` and `TYPESAFE_AI_API_KEY` is set (`main.py`). `JEV_ENABLED=false` skips API calls in either data mode.

**Next.js note** (`dashboard/AGENTS.md`): this Next.js version has breaking changes from what you may know. Read the relevant guide in `dashboard/node_modules/next/dist/docs/` before writing Next code. Middleware lives in `dashboard/proxy.ts`.

## Trader architecture

- `main.py` sets up clients and state, then loops `runtime/loop/eval_cycle.run_eval_cycle`. Each cycle is split into slices under `runtime/loop/`: `cycle_sync` (reloads bot_status and settings from the DB, so settings changes need no restart), `cycle_quotes` (quotes plus dashboard command processing), `cycle_rotation` (watchlist rotation/breakout and bar flush), `cycle_eval` (market-hours gate, Jev fetch, entry evaluation), `cycle_exits`, and `cycle_tail` (heartbeat, then sleep).
- `strategy/filters.py` and `StrategyConfig` hold the entry gates. A failed gate writes a stable lowercase `trade_skip_reason` string onto `predictions`. The dashboard aggregates these strings, so treat them as an API. Gate defaults come from `STRATEGY_*` env vars (`config.py`), but dashboard/DB settings override them (`strategy_config_with_risk_overrides` and the `*_dashboard_override` helpers).
- `risk/manager.py` handles sizing and limits. `risk_per_trade` is authoritative: notional = `risk_per_trade / stop_pct`, clipped by `max_position_size`. `stop_pct` comes from `resolve_stop_take_pct`. When ATR is available it is `atr_pct * stop_loss_atr_multiple`, clamped to `[min_stop_loss_pct, max_stop_loss_pct]`. Otherwise it falls back to `settings.stop_loss_percentage`. Take-profit follows the same pattern.
- `broker/ibkr/` is the IBKR client, split by concern. `broker/execution.py` switches between simulated and IBKR bracket orders. `execution_mode` comes from the DB (dashboard toggle) and falls back to env. `broker/reconcile.py` syncs orphan IBKR positions.
- `watchlist/` covers the candidate pool, the active list (about 12 names, rotated every 15 minutes, up to 2 swaps), breakout promotion, and phased bar backfill (critical first, then the deferred pool, one symbol per cycle).
- `database/repository/` is `SupabaseRepository`, built from mixins (`_settings`, `_trades`, `_commands`, ...). **Most `.select(...)` column lists are written by hand.** The settings row is read with `select("*")` in `_settings._load_settings_row`, so a new settings column loads automatically, but it is only used once `get_risk_settings` parses it (nullable optionals go in `_NULL_MEANS_UNSET`).
- Day-trading invariants: no entries in the last 15 minutes before close, flatten every position in the last 10 minutes (including losers), and, when `DATA_SOURCE=ibkr`, outside RTH skip Jev and new entries but keep exits and heartbeats running. Mock mode skips this gate on purpose.

## Dashboard ↔ trader contract

- The dashboard controls the trader only through DB rows. `bot_status` holds `enabled`, `trading_mode`, `execution_mode` and `shutdown_requested`. The trader re-reads them about every 5 seconds (`bot_control_refresh_interval_sec`) and re-reads `settings` about every 15 seconds. Setting `shutdown_requested` stops the trader (`cycle_sync.py`), so never write it, because that breaks the no-restart rule. `settings` has a single row `id = 1`. The command queues are `entry_commands`, `trade_commands` and `position_commands`: the dashboard inserts a row in `lib/actions.ts`, and the trader claims and completes it in `database/repository/_commands.py`.
- Trader liveness comes from heartbeat age on `bot_status`.
- Auth roles live in `app_metadata.dashboard_role` (`owner` or `viewer`), see `lib/dashboard-role.ts`. Every mutating server action must call `assertDashboardCanWrite` or a related check (`require-dashboard-write.server.ts`).
- `lib/*/openai.server.ts` modules (morning brief, session brief, trade recap, skip/position/symbol-day explainers, settings summary) each follow the same pattern: `packet.ts` builds the input, `schema.ts` validates the output, and `actions.ts` exposes the server action.

### Adding a setting

A new `settings` column touches every layer. See `.agents/skills/add-trading-setting/SKILL.md` for the full checklist. In short:
- migration + MCP apply
- `trader/models/types.py` `RiskSettings`
- the `get_risk_settings` parse in `trader/database/repository/_settings.py` (and `_NULL_MEANS_UNSET` if NULL means "use the default")
- `strategy/config.py` / `config.py` / `.env.example` if it is strategy-facing
- `dashboard/lib/types/database.ts`, `normalize-settings.ts`, `validate-settings.ts`, `lib/settings-form-descriptions.ts` (both `SETTING_DESCRIPTIONS` and `SETTING_DESCRIPTIONS_FULL`; a missing key fails `next build`), `components/settings-form.tsx`
- the README table

Missing one causes silent wrong defaults or Vercel build failures.

## Project skills

`.agents/skills/` has task playbooks. Read the matching one before starting such a task:
- `add-trading-setting`, `add-strategy-filter`
- `preflight-checks`
- `diagnose-trader`, `review-trading-session`, `evaluate-prediction-strategy`, `export-strategy` (all read-only Supabase MCP)
- `refactor-market-pilot`
- `supabase`, `supabase-postgres-best-practices`

## Releases

You work on `main`. Friends get the `release` branch: `node scripts/promote.mjs`, then push `release`, check it out, run `node scripts/make-release.mjs`, and check out `main` again. `make-release.mjs` needs `SUPABASE_DB_URL` for its drift check, or `--skip-drift`. If `v<VERSION>` is already tagged, it asks interactively for patch, minor or major and commits the bumped `VERSION`, so leave that step to the user. It zips `HEAD` without `.cursor`, `.agents`, `CLAUDE.md` and `migrations-archive`, and friends update from that zip. The root `*.command`/`*.bat` launchers (Setup, Start, Stop, Update, Check My Setup) wrap `setup/*.mjs` (wizard, start, stop, update, doctor) for non-technical users. `migrate.mjs` has no launcher and runs from `update.mjs`. See `GETTING-STARTED.md`.
