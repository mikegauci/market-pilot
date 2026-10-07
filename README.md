# market-pilot

Automated day-trading platform using **Jev** for market predictions and **Interactive Brokers** for market data and trade execution.

Phase 1 provides the monorepo scaffold, Supabase schema, and a Python engine that connects to IBKR paper trading to verify account balance, market data, and positions. **No orders are placed in Phase 1.**

## Architecture

```text
                    NEXT.JS DASHBOARD (Phase 5)
                         Vercel
                           |
                       Supabase
                      PostgreSQL
                           |
                  PYTHON TRADING ENGINE
                           |
             +-------------+-------------+
             |             |             |
         IBKR Data        Jev        Risk Engine
         (Phase 1)     (Phase 2)    (Phase 3+)
```

Only the Python trading engine communicates with Interactive Brokers.

## Project Structure

```text
market-pilot/
├── dashboard/          # Next.js app (Phase 5)
├── trader/             # Python trading engine
│   ├── main.py
│   ├── config.py
│   ├── broker/ibkr.py
│   ├── database/supabase.py
│   └── models/types.py
├── supabase/
│   └── migrations/
└── README.md
```

## Prerequisites

1. **IBKR paper account** with IB Gateway or TWS
2. **Python 3.11+**
3. **Supabase project** (cloud or local via Supabase CLI)

## IB Gateway Setup (Paper)

1. Download and install [IB Gateway](https://www.interactivebrokers.com/en/trading/ibgateway-stable.php)
2. Log in with your **Paper Trading** credentials
3. Enable API access:
   - *Configure → Settings → API → Settings*
   - Enable **ActiveX and Socket Clients**
   - Add trusted IP: `127.0.0.1`
   - Uncheck *Read-Only API* if you plan to trade later (Phase 1 is read-only regardless)
4. Default paper port: **4002** (IB Gateway) or **7497** (TWS)

## Supabase Project

| | |
|---|---|
| **Name** | market-pilot |
| **Project ref** | `gbprapqifrvhylfazjvs` |
| **Name** | market-pilot |
| **Region** | eu-central-1 |
| **Dashboard** | [Project settings](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs) |
| **API URL** | `https://gbprapqifrvhylfazjvs.supabase.co` |

The Phase 1 schema is already applied. Add your **service role key** to `trader/.env`:

1. Open [API settings](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/settings/api)
2. Copy the **service_role** key (never commit or expose in the dashboard client)
3. Set `SUPABASE_SERVICE_ROLE_KEY=` in `trader/.env`

MCP is scoped to this project via [`.cursor/mcp.json`](.cursor/mcp.json).

## Supabase Setup

### Option A: Supabase CLI (recommended)

```bash
# Install CLI: https://supabase.com/docs/guides/cli/getting-started
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### Option B: Manual SQL

Run the migration file in the Supabase SQL editor:

```text
supabase/migrations/20250928000000_initial_schema.sql
```

Copy your project URL and **service role key** (trader only — never expose in the dashboard client).

## Environment Variables

Copy the trader example and fill in values:

```bash
cp trader/.env.example trader/.env
```

| Variable | Description | Default |
|---|---|---|
| `TRADING_MODE` | `paper` or `live` | `paper` |
| `LIVE_TRADING_CONFIRMATION` | Required for live: `I_UNDERSTAND_LIVE_TRADING` | empty |
| `IBKR_HOST` | IB Gateway host | `127.0.0.1` |
| `IBKR_PORT` | Paper: 4002 (Gateway) or 7497 (TWS) | `4002` |
| `IBKR_CLIENT_ID` | Unique client ID | `1` |
| `IBKR_ACCOUNT` | Optional; auto-detected if blank | |
| `WATCHLIST` | Comma-separated symbols | SPY,QQQ,... |
| `SUPABASE_URL` | Supabase project URL | |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (trader only) | |
| `HEARTBEAT_INTERVAL_SEC` | Poll interval | `10` |
| `LOG_LEVEL` | Logging level | `INFO` |

### Paper / Live Safety

- Default mode is always **PAPER**
- Live trading requires `TRADING_MODE=live` **and** `LIVE_TRADING_CONFIRMATION=I_UNDERSTAND_LIVE_TRADING`
- The engine warns if paper mode uses a live port (4001/7496) or vice versa
- The dashboard cannot switch to live mode — that requires server configuration

## Running the Trading Engine (Phase 1)

```bash
cd trader
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Ensure IB Gateway paper is running, then:
python main.py
```

Expected log output:

```text
=== PAPER TRADING ===
Connected to IBKR paper (127.0.0.1:4002)
Account: NetLiq USD 1024.50 | Cash 1024.50
NVDA  $180.25  bid 180.23  ask 180.27  spread 0.04
Positions: 0 open
Heartbeat written to Supabase
```

## Running Phase 2 (Jev + Mock Data)

Works **without IBKR**. Add your TypeSafe API key to `trader/.env`:

```env
DATA_SOURCE=mock
EVAL_INTERVAL_SEC=1
JEV_ENABLED=true
TYPESAFE_AI_API_KEY=your-key-here
```

Run the engine:

```bash
cd trader && source .venv/bin/activate && python main.py
```

Expected output after ~1 minute (warm-up builds price history first):

```text
NVDA  $180.25  (mock)
Jev  BUY: 83%  HOLD: 11%  SELL: 6%
Signal: BUY 83% — ELIGIBLE
Prediction stored
Heartbeat written to Supabase
```

Set `JEV_ENABLED=false` to test mock data and indicators only (no API calls).

When IBKR is ready, set `DATA_SOURCE=ibkr` — the same pipeline uses live quotes.

### Market-hours gate (IBKR only)

When `DATA_SOURCE=ibkr`, the trader **skips Jev predictions and new entries** outside the US regular session (Mon–Fri 9:30–16:00 America/New_York). Exits, heartbeats, and quote snapshots continue. `DATA_SOURCE=mock` always runs Jev (useful for dev).

Tune the closed-market poll interval with `CLOSED_MARKET_EVAL_INTERVAL_SEC` (default `300`).

### Watchlist rotation

Settings can hold a **candidate pool** and a smaller **active list**. When rotation is on, Jev only evaluates the active names (about 12). The bot refreshes that list every 15 minutes during the US session, swapping at most two names, and always keeps open positions. `benchmark_symbol` (QQQ) is subscribed for the headwind check and is never bought. Quote subscriptions cover the whole pool so a promoted name already has price history. The manual watchlist is used only when rotation is off.

### End-of-day flatten (day trading)

IBKR bracket legs use **DAY** time-in-force and expire at the regular close. To avoid naked overnight longs, the trader:

| Rule | Default | Env |
|---|---|---|
| No new entries | Last **15** min before 16:00 ET | `STRATEGY_ENTRY_CUTOFF_MINUTES_BEFORE_CLOSE` |
| Flatten all open longs | Last **10** min (~15:50–16:00 ET) | `STRATEGY_EOD_FLATTEN_MINUTES_BEFORE_CLOSE` |

**EOD flatten closes every open position**, including unrealized losers (`exit_reason=eod_flatten`). That is intentional: skipping reds would leave gap risk after brackets expire.

**Jev SELL** is different intraday: the bot usually **does not** soft-exit a losing position (so the bracket stop can work). At the EOD window, flatten still runs regardless of PnL.

## Running Phase 3 (Risk Engine + Simulated Trades)

Phase 3 opens **simulated** positions when Jev signals `BUY ELIGIBLE` and risk checks pass. Trades are stored in Supabase with stop-loss / take-profit exits. **No IBKR orders are placed.**

### Enable trading

Trading is off by default. In Supabase Table Editor, set:

```sql
UPDATE bot_status SET enabled = true WHERE id = 1;
```

### Risk settings (Supabase `settings` table)

| Column | Default | Purpose |
|---|---|---|
| `minimum_jev_confidence` | 0.85 | Min BUY % for ELIGIBLE signal |
| `max_open_positions` | 2 | Max concurrent simulated positions |
| `max_position_size` | 250 | Max notional per trade (USD) |
| `risk_per_trade` | 2.50 | Max dollar risk per trade |
| `max_daily_loss` | 10.00 | Stop new entries after daily loss |
| `stop_loss_percentage` | 0.01 | 1% stop-loss from entry |
| `take_profit_percentage` | 0.015 | 1.5% take-profit from entry |
| `profit_take_enabled` | false | Opt-in: market-sell on band persistence, soft Jev SELL, or fast spike (see below) |
| `profit_take_min_fraction` | 0.70 | Lower bound: % of entry→TP distance (0.70 = 70% of the way) |
| `profit_take_max_fraction` | 0.80 | Upper bound of the band; fast moves above max but below full TP still exit |
| `profit_take_min_band_hits` | 3 | In-band eval samples within the lookback window required to exit (missing quote counts as out-of-band) |
| `profit_take_band_window_cycles` | 10 | Rolling window of eval cycles for band-touch counting |
| `profit_take_jev_sell_threshold` | 0.70 | Optional soft Jev SELL (dominant) for early exit; 0 = off. Requires progress ≥ min fraction |
| `loss_cut_enabled` | false | Opt-in: market-sell on band persistence toward stop, soft Jev SELL, or fast spike (see below) |
| `loss_cut_min_fraction` | 0.70 | Lower bound: % of entry→stop distance (0.70 = 70% of the way toward stop) |
| `loss_cut_max_fraction` | 0.90 | Upper bound of the band; fast moves above max but above hard stop still exit early |
| `loss_cut_min_band_hits` | 3 | In-band eval samples within the lookback window required to exit |
| `loss_cut_band_window_cycles` | 10 | Rolling window of eval cycles for band-touch counting |
| `loss_cut_jev_sell_threshold` | 0 | Optional soft Jev SELL (dominant) for early loss exit; 0 = off. Requires progress ≥ min fraction |
| `account_capital` | 1000 | Fallback capital when IBKR offline |

When IBKR is connected, **effective capital** uses your paper account `NetLiquidation` (e.g. €1M). Tune absolute limits in Supabase or the dashboard Settings page.

**Position sizing:** `risk_per_trade` is authoritative — notional is `risk_per_trade / stop_loss_percentage`, clipped by `max_position_size`. If you raise `max_position_size` without raising `risk_per_trade`, risk per trade does not increase.

**Risk profiles** (dashboard Settings — percentages of equity):

| Profile | Risk per trade | Max position | Max daily loss |
|---|---|---|---|
| Low | 0.15% | 0.75% | 0.75% |
| Medium (default) | 0.25% | 1.00% | 1.00% |
| High | 0.40% | 1.50% | 1.50% |

Example at €1M: Low €1,500 / €7,500 / €7,500 — Medium €2,500 / €10,000 / €10,000 — High €4,000 / €15,000 / €15,000.

Set `risk_profile` to `low`, `medium`, or `high` in the dashboard; Apply fills dollar fields from your equity tier. Stop loss / take profit / Jev confidence are unchanged across profiles.

**Medium profile (~€1M paper account):**

| Column | Suggested | Purpose |
|---|---|---|
| `max_position_size` | 5000 | ~0.5% notional per trade |
| `max_open_positions` | 5 | Max concurrent positions |
| `risk_per_trade` | 2500 | ~0.25% risk per trade |
| `max_daily_loss` | 10000 | ~1% daily stop |
| `account_capital` | 1000000 | Fallback when IBKR offline |

### Run

```bash
cd trader && source .venv/bin/activate && python main.py
```

Expected output when a trade opens:

```text
NVDA  $224.63  (ibkr)
Jev  BUY: 83%  HOLD: 11%  SELL: 6%
Signal: BUY 83% — ELIGIBLE
Simulated BUY NVDA x 1 @ $224.63 (SL $222.38 / TP $228.00)
Prediction stored
```

When risk blocks a trade:

```text
Risk: rejected NVDA — max_open_positions
```

When stop-loss or take-profit hits:

```text
Simulated exit NVDA @ $222.38 (stop_loss) PnL $-2.25
```

### Phase 3 Verification Checklist

- [ ] `bot_status.enabled = true` in Supabase
- [ ] Logs show `Risk engine loaded` on startup
- [ ] ELIGIBLE signals either open a simulated trade or log a rejection reason
- [ ] `trades` table has rows with `status=open` or `status=closed`
- [ ] `predictions.trade_created = true` when a trade opens
- [ ] `positions` reflects simulated holdings (not empty IBKR mirror)
- [ ] `portfolio_history` tracks simulated equity / daily PnL
- [ ] No orders submitted to IBKR

To test without waiting for 85% BUY, temporarily lower `minimum_jev_confidence` in Supabase (restore to `0.85` after testing).

### Strategy filters (Phase 3+)

The trader applies additional gates before opening a position:

| Filter | Default | Purpose |
|---|---|---|
| BUY − HOLD margin | 15% | Reject weak BUY signals |
| Confirmation cycles | 2 | Require consecutive ELIGIBLE signals |
| Max RSI | 70 | Skip overbought entries |
| Trend filter (EMA) | EMA-20 (Settings) | Off, EMA-9, or EMA-20 — warmup + price above chosen EMA |
| Rotation session % | ≥ 0% vs RTH open | Keep red-day names off active scan (`STRATEGY_ROTATION_MIN_SESSION_CHANGE_PCT`) |
| Max entries / symbol / day | 3 (settings) | Limits repeat stop/re-entry churn (0 = off) |
| SPY 5m change | ≥ −0.3% | Avoid broad-market headwinds |
| Max spread | 0.15% | Skip illiquid quotes |
| Max hold time | 15 min | Time-based exit (matches Jev horizon) |
| Jev SELL exit | 75% | Close on high-confidence SELL |
| Correlated positions | 2 max | Limit mega-cap tech stacking |

Tune via `STRATEGY_*` env vars in `trader/.env` (see `.env.example`).

## Running Phase 4 (IBKR Paper Orders)

Phase 4 places **real bracket orders** on IBKR paper when execution mode is **IBKR paper** (dashboard Overview toggle or `EXECUTION_MODE=ibkr` in env as fallback default).

### Prerequisites

- IB Gateway running on port **4002** (paper)
- **Read-Only API** disabled in Gateway settings
- `DATA_SOURCE=ibkr` in `trader/.env`

### Enable IBKR execution

**Dashboard (recommended):** On Overview, turn on **IBKR paper orders** in Trading controls. The trader picks this up within ~30s (no restart).

**Or via env** (initial default only):

```env
DATA_SOURCE=ibkr
EXECUTION_MODE=ibkr
```

On BUY ELIGIBLE + bot ON + risk pass, the engine places a **market buy** with **stop-loss** and **take-profit** bracket legs at IBKR.

### Expected log output

```text
IBKR BUY NVDA x 1 @ $224.63 (SL $222.38 / TP $228.00)
IBKR exit NVDA @ $228.00 (take_profit) PnL $3.37
```

### Phase 4 Verification Checklist

- [ ] `EXECUTION_MODE=simulated` still works (no IBKR orders)
- [ ] With `EXECUTION_MODE=ibkr`, orders appear in IB Gateway log
- [ ] `trades.execution_mode = 'ibkr'` with `ibkr_*_order_id` populated
- [ ] Positions in dashboard match IBKR (not simulated)
- [ ] SL or TP closes trade in IBKR and Supabase
- [ ] Live mode still requires `LIVE_TRADING_CONFIRMATION` (unchanged)

Execution mode defaults to `ibkr` (paper orders via IB Gateway). Env `EXECUTION_MODE` is the fallback if the database read fails. With `DATA_SOURCE=mock`, the trader uses simulated execution for local dev without IB Gateway.

Status badges show **Trader online/offline** based on heartbeat age (~30s). Stopping the trader clears connection flags immediately.

## Running Phase 5 (Next.js Dashboard)

Browser UI for bot status, portfolio, predictions, trades, and settings. See [`dashboard/README.md`](dashboard/README.md) for full details.

### Setup

```bash
cp dashboard/.env.example dashboard/.env.local
# Add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (anon/publishable — NOT service_role)
```

Create a user in [Supabase Auth](https://supabase.com/dashboard/project/gbprapqifrvhylfazjvs/auth/users), then:

```bash
cd dashboard && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in.

### Phase 5 Verification Checklist

- [ ] Login required — unauthenticated users redirect to `/login`
- [ ] Overview shows equity, connection badges, open positions
- [ ] Overview auto-trading toggle updates `bot_status.enabled` (trader picks up within ~30s)
- [ ] Stopping the trader shows Trader/IBKR/Jev offline on the dashboard
- [ ] Settings save and trader reloads risk params each cycle
- [ ] Predictions and trades populate from engine data
- [ ] Live updates via Supabase Realtime (no manual refresh)
- [ ] No service_role key in client env vars

### Deploy to Vercel

Live at [market-pilot-dashboard](https://vercel.com/mikegaucis-projects/market-pilot-dashboard) (`https://market-pilot-dashboard.vercel.app`). Root directory `dashboard`, env vars per [`dashboard/README.md`](dashboard/README.md). Add the Vercel URL to Supabase Auth redirect URLs for login to work in production.

## Phase 1 Verification Checklist

- [ ] Account balance prints in logs
- [ ] Watchlist symbols return price / bid / ask
- [ ] Positions list matches IBKR (likely empty initially)
- [ ] `bot_status` row updates in Supabase (`last_heartbeat`, `ibkr_connected=true`)
- [ ] `market_snapshots` rows appear for each symbol
- [ ] `portfolio_history` rows are inserted each heartbeat
- [ ] No orders submitted to IBKR

## Database Tables

| Table | Phase 1 | Purpose |
|---|---|---|
| `settings` | seeded | Strategy and risk configuration |
| `bot_status` | read/write | Engine heartbeat and connectivity |
| `portfolio_history` | write | Balance/equity snapshots |
| `market_snapshots` | write | Latest quotes per symbol |
| `positions` | write | Simulated open positions (Phase 3+) |
| `predictions` | write | Jev predictions (Phase 2) |
| `trades` | write | Simulated or IBKR trades (Phase 3+) |

## Development Phases

| Phase | Scope |
|---|---|
| 1 | Scaffold, schema, IBKR paper connectivity |
| 2 | Jev integration, mock data, store predictions |
| 3 | Risk engine, simulated trades |
| 4 | IBKR paper order execution, stop-loss / take-profit |
| 5 | Next.js dashboard on Vercel |
| **6** (current) | 200–300 paper trades and analytics |
## Important Principles

- **Jev predicts** — it never controls the brokerage account
- **Risk engine decides** — whether a prediction becomes a trade (Phase 3+)
- **IBKR executes** — only the Python engine places orders (Phase 4+)
- **Supabase records everything**
- **Next.js displays everything** (Phase 5)
- Start with **paper trading only**
