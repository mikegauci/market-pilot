# Market Pilot Dashboard (Phase 5)

Next.js dashboard for monitoring bot status, portfolio, predictions, and simulated trades.

The dashboard reads from Supabase with the **publishable (anon) key** and Supabase Auth. It does **not** execute trades or use the service role key.

## Setup

1. Copy environment variables:

```bash
cp .env.example .env.local
```

2. Fill in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from [Supabase API settings](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/settings/api) (publishable or anon key — **not** service_role). For **Analytics → Session brief**, add server-only `OPENAI_API_KEY` (see `.env.example`).

3. Create a user in [Supabase Auth](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/auth/users) (email + password).

4. Install and run (Node **22+** required for the OpenAI SDK):

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

## Data fetching

- **`lib/queries.ts`** — Server Components (RSC initial load via `createClient()` from `@/lib/supabase/server`; `server-only`).
- **`lib/data-client.ts`** — Client Components (`"use client"`) polling and live refresh via `@/lib/supabase/client` and shared `lib/supabase/data-reads.ts`.
- **`lib/watchlist-symbols.ts`** — Normalize/parse/validate watchlist tickers (picker + settings).

Analytics uses SSR for the first paint, then **slow** client refresh (120s) for equity/trades. Skip-reason stats on Predictions load once per visit (48h window). See `lib/analytics-data.ts`.

Hosted Supabase Free tier: see [docs/supabase-quota.md](../docs/supabase-quota.md) for egress/log limits and `lib/live-data-config.ts` polling defaults.

## Pages

| Route | Description |
|---|---|
| `/` | Overview — equity, P&L, open positions with charts, recent trades |
| `/predictions` | Latest Jev predictions with live updates |
| `/trades` | Full trade history (open / closed) with expandable charts |
| `/strategy` | Strategy guide — indicators, filters, and decision flow |
| `/settings` | Risk and strategy settings |
| `/analytics` | Equity, P&L, day-by-day AI session briefs (from 2 Oct 2026) |

**Confirmation cycles / seconds** (under Jev & signals) control how long an eligible BUY must persist before entry. When Supabase settings are available, these override `STRATEGY_CONFIRMATION_*` in `trader/.env`; the trader reloads them about every 15s without a restart.

## System status (sidebar)

System status lives in the **sidebar on every page**. It shows market hours, whether the trading engine is running, and whether the broker is connected. An amber warning appears when the engine is stopped or the broker is offline.

Orders go to the IBKR paper account when the engine and broker are connected. The Python trader reads `bot_status.enabled` every ~5s for new entries. Sidebar **Pause new trades** toggles `enabled` while the engine is running; starting `python main.py` again turns new entries back on if they were left paused while offline. **Stop engine** sets `shutdown_requested` (polled every eval cycle) so the running process exits cleanly. If a stop request outlives the engine, use **Cancel stop request** before starting `python main.py` again. Status badges treat heartbeats older than 30s as **Trader offline** and hide stale IBKR/Jev connection flags.

### Supabase: execution mode defaults

If setting up a new Supabase project (or before this repo change), apply migration `execution_mode_defaults_ibkr_only`:

- Default `bot_status.execution_mode` and `trades.execution_mode` to `ibkr`
- Restrict dashboard updates so `execution_mode` cannot revert to `simulated`

Production project `gbprapqifrvhylfazjvs` already has this migration applied via Supabase MCP.

## Deploy to Vercel

Production: [market-pilot-dashboard on Vercel](https://vercel.com/mikegaucis-projects/market-pilot-dashboard) → `https://market-pilot-dashboard.vercel.app`

1. Vercel project name: **`market-pilot-dashboard`** (team: mikegaucis-projects)
2. **Root Directory** = `dashboard`, linked to `mikegauci/market-pilot` on `main`
3. Environment variables (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `OPENAI_API_KEY` (server-only, for Session brief on Analytics)
   - `OPENAI_BRIEF_MODEL` (optional)
4. In [Supabase Auth URL config](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/auth/url-configuration), add:
   - Site URL: `https://market-pilot-dashboard.vercel.app`
   - Redirect URL: `https://market-pilot-dashboard.vercel.app/auth/callback`

## Security

- RLS policies allow authenticated users to read all tables
- Dashboard may update `bot_status` and `settings` only (paper mode enforced — cannot set live trading from UI)
- Dashboard may insert into `session_briefs` (AI session summaries; advisory only)
- Never put `SUPABASE_SERVICE_ROLE_KEY` in dashboard env vars

### Read-only viewer access

Friends can use **View read-only** on `/login` when `DASHBOARD_VIEWER_EMAIL` and `DASHBOARD_VIEWER_PASSWORD` are set (server env). That signs in a shared Supabase user whose JWT has `app_metadata.dashboard_role = "viewer"`.

Your owner account must have `app_metadata.dashboard_role = "owner"` (Supabase Auth → user → raw app metadata). Postgres function `dashboard_can_write()` allows **only** owners to INSERT/UPDATE dashboard tables; viewers get SELECT only. Engine controls, settings save, close/cover, and OpenAI actions are hidden or blocked in the app as well.

Set `DASHBOARD_VIEWER_LOGIN_ENABLED=false` to hide the login button without removing credentials.

**Runbook (production project `gbprapqifrvhylfazjvs`):**

1. Confirm migration `dashboard_viewer_readonly_rls` is applied (`dashboard_can_write()` exists; write RLS policies reference it).
2. Set **owner** raw app metadata: `{ "dashboard_role": "owner" }` on your login user; create **viewer** user with `{ "dashboard_role": "viewer" }`.
3. Match viewer email/password in Vercel env (`DASHBOARD_VIEWER_*`). Redeploy the dashboard after env changes.
4. **Sign out and sign back in** as owner after metadata changes so the JWT includes `dashboard_role` (otherwise the UI stays read-only and writes fail at the database).
5. Smoke test: owner can save settings / pause engine; viewer sees no engine controls and cannot mutate data.

**Security note:** The read-only button is a public one-click sign-in to the shared viewer account (password stays on the server). Anyone who can open `/login` can browse as viewer. Disable the button on public deployments if that is too open; rate limiting is best-effort per IP on the server action.
