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

## Bot toggle

Flipping the bot switch updates `bot_status.enabled` in Supabase. The Python trader reads this every eval cycle (~30s).

## Deploy to Vercel

1. Create a Vercel project with **Root Directory** = `dashboard`
2. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Deploy

## Security

- RLS policies allow authenticated users to read all tables
- Dashboard may update `bot_status` and `settings` only (paper mode enforced — cannot set live trading from UI)
- Never put `SUPABASE_SERVICE_ROLE_KEY` in dashboard env vars
