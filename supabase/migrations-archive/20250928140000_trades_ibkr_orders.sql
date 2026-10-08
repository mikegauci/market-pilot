-- Phase 4: IBKR order tracking on trades

ALTER TABLE trades
    ADD COLUMN IF NOT EXISTS ibkr_parent_order_id integer,
    ADD COLUMN IF NOT EXISTS ibkr_sl_order_id integer,
    ADD COLUMN IF NOT EXISTS ibkr_tp_order_id integer,
    ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'simulated'
        CHECK (execution_mode IN ('simulated', 'ibkr'));
