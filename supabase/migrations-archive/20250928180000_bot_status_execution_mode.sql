-- Dashboard-controlled execution mode (simulated vs ibkr paper orders)

ALTER TABLE bot_status
    ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'simulated'
        CHECK (execution_mode IN ('simulated', 'ibkr'));

UPDATE bot_status SET execution_mode = 'simulated' WHERE id = 1;

-- Recreate update policy to allow execution_mode changes (paper mode only)
DROP POLICY IF EXISTS "authenticated_update_bot_status" ON bot_status;

CREATE POLICY "authenticated_update_bot_status"
    ON bot_status FOR UPDATE TO authenticated
    USING (id = 1)
    WITH CHECK (
        id = 1
        AND trading_mode = 'paper'
        AND execution_mode IN ('simulated', 'ibkr')
    );
