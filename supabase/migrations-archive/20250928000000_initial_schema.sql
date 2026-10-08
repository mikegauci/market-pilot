-- Phase 1: initial schema for market-pilot trading platform

-- ---------------------------------------------------------------------------
-- settings (singleton row)
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    bot_enabled boolean NOT NULL DEFAULT false,
    trading_mode text NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),
    minimum_jev_confidence numeric(5, 4) NOT NULL DEFAULT 0.8000,
    signal_record_threshold numeric(5, 4) NOT NULL DEFAULT 0.7500,
    risk_per_trade numeric(18, 6) NOT NULL DEFAULT 2.50,
    max_position_size numeric(18, 6) NOT NULL DEFAULT 250.00,
    max_daily_loss numeric(18, 6) NOT NULL DEFAULT 10.00,
    max_open_positions integer NOT NULL DEFAULT 2,
    stop_loss_percentage numeric(8, 6) NOT NULL DEFAULT 0.010000,
    take_profit_percentage numeric(8, 6) NOT NULL DEFAULT 0.015000,
    account_capital numeric(18, 6) NOT NULL DEFAULT 1000.00,
    watchlist text[] NOT NULL DEFAULT ARRAY['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'AMD', 'META'],
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- bot_status (singleton row)
-- ---------------------------------------------------------------------------
CREATE TABLE bot_status (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled boolean NOT NULL DEFAULT false,
    trading_mode text NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper', 'live')),
    ibkr_connected boolean NOT NULL DEFAULT false,
    jev_connected boolean NOT NULL DEFAULT false,
    last_heartbeat timestamptz,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- predictions (Phase 2+)
-- ---------------------------------------------------------------------------
CREATE TABLE predictions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol text NOT NULL,
    timestamp timestamptz NOT NULL DEFAULT now(),
    price numeric(18, 6) NOT NULL,
    buy_probability numeric(5, 4) NOT NULL,
    hold_probability numeric(5, 4) NOT NULL,
    sell_probability numeric(5, 4) NOT NULL,
    market_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    trade_created boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX predictions_symbol_timestamp_idx ON predictions (symbol, timestamp DESC);

-- ---------------------------------------------------------------------------
-- trades (Phase 3+)
-- ---------------------------------------------------------------------------
CREATE TABLE trades (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol text NOT NULL,
    side text NOT NULL CHECK (side IN ('buy', 'sell')),
    entry_time timestamptz NOT NULL,
    entry_price numeric(18, 6) NOT NULL,
    exit_time timestamptz,
    exit_price numeric(18, 6),
    quantity numeric(18, 6) NOT NULL,
    position_value numeric(18, 6) NOT NULL,
    stop_loss numeric(18, 6),
    take_profit numeric(18, 6),
    gross_pnl numeric(18, 6),
    commission numeric(18, 6) NOT NULL DEFAULT 0,
    slippage numeric(18, 6) NOT NULL DEFAULT 0,
    net_pnl numeric(18, 6),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
    paper_or_live text NOT NULL DEFAULT 'paper' CHECK (paper_or_live IN ('paper', 'live')),
    jev_buy_probability numeric(5, 4),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trades_status_idx ON trades (status);
CREATE INDEX trades_symbol_entry_time_idx ON trades (symbol, entry_time DESC);

-- ---------------------------------------------------------------------------
-- positions (mirrors IBKR open positions)
-- ---------------------------------------------------------------------------
CREATE TABLE positions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol text NOT NULL UNIQUE,
    quantity numeric(18, 6) NOT NULL,
    avg_cost numeric(18, 6) NOT NULL,
    market_price numeric(18, 6),
    market_value numeric(18, 6),
    unrealized_pnl numeric(18, 6),
    currency text NOT NULL DEFAULT 'USD',
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- portfolio_history
-- ---------------------------------------------------------------------------
CREATE TABLE portfolio_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp timestamptz NOT NULL DEFAULT now(),
    balance numeric(18, 6) NOT NULL,
    equity numeric(18, 6) NOT NULL,
    daily_pnl numeric(18, 6) NOT NULL DEFAULT 0,
    total_pnl numeric(18, 6) NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'USD',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX portfolio_history_timestamp_idx ON portfolio_history (timestamp DESC);

-- ---------------------------------------------------------------------------
-- market_snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE market_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol text NOT NULL,
    timestamp timestamptz NOT NULL DEFAULT now(),
    price numeric(18, 6),
    bid numeric(18, 6),
    ask numeric(18, 6),
    spread numeric(18, 6),
    volume bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_snapshots_symbol_timestamp_idx ON market_snapshots (symbol, timestamp DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;

-- Phase 1: no public policies. Trader uses service_role (bypasses RLS).
-- Dashboard read policies will be added in Phase 5.

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------
INSERT INTO settings (
    id,
    bot_enabled,
    trading_mode,
    minimum_jev_confidence,
    signal_record_threshold,
    risk_per_trade,
    max_position_size,
    max_daily_loss,
    max_open_positions,
    stop_loss_percentage,
    take_profit_percentage,
    account_capital,
    watchlist
) VALUES (
    1,
    false,
    'paper',
    0.8000,
    0.7500,
    2.50,
    250.00,
    10.00,
    2,
    0.010000,
    0.015000,
    1000.00,
    ARRAY['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'AMD', 'META']
);

INSERT INTO bot_status (
    id,
    enabled,
    trading_mode,
    ibkr_connected,
    jev_connected
) VALUES (
    1,
    false,
    'paper',
    false,
    false
);
