# Market Pilot Dashboard (Phase 5)

Next.js dashboard for monitoring bot status, portfolio, predictions, and simulated trades.

The dashboard reads from Supabase with the **publishable (anon) key** and Supabase Auth. It does **not** execute trades or use the service role key.

## Setup

1. Copy environment variables:

```bash
cp .env.example .env.local
```

2. Fill in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from [Supabase API settings](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/settings/api) (publishable or anon key — **not** service_role).

3. Create a user in [Supabase Auth](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/auth/users) (email + password).

4. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

## Pages

| Route | Description |
|---|---|
| `/` | Overview — equity, P&L, bot toggle, positions, recent trades |
| `/predictions` | Latest Jev predictions with live updates |
| `/trades` | Full trade history (open / closed) |
| `/settings` | Risk and strategy settings |

## Trading controls (Overview)

| Control | Supabase field | Effect |
|---------|----------------|--------|
| Auto-trading | `bot_status.enabled` | Allow or block new entries |

Orders go to the IBKR paper account when the engine and broker are connected. The Python trader reads `bot_status.enabled` every eval cycle (~30s). Status badges treat heartbeats older than 30s as **Trader offline** and hide stale IBKR/Jev connection flags.

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
4. In [Supabase Auth URL config](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/auth/url-configuration), add:
   - Site URL: `https://market-pilot-dashboard.vercel.app`
   - Redirect URL: `https://market-pilot-dashboard.vercel.app/auth/callback`

## Security

- RLS policies allow authenticated users to read all tables
- Dashboard may update `bot_status` and `settings` only (paper mode enforced — cannot set live trading from UI)
- Never put `SUPABASE_SERVICE_ROLE_KEY` in dashboard env vars
