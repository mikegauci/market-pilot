-- Phase 5: Dashboard RLS policies for authenticated read + limited write

GRANT SELECT ON settings TO authenticated;
GRANT SELECT ON bot_status TO authenticated;
GRANT SELECT ON predictions TO authenticated;
GRANT SELECT ON trades TO authenticated;
GRANT SELECT ON positions TO authenticated;
GRANT SELECT ON portfolio_history TO authenticated;
GRANT SELECT ON market_snapshots TO authenticated;

GRANT UPDATE ON bot_status TO authenticated;
GRANT UPDATE ON settings TO authenticated;

-- Read all rows for authenticated users (single-user personal dashboard)
CREATE POLICY "authenticated_select_settings"
    ON settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select_bot_status"
    ON bot_status FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select_predictions"
    ON predictions FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select_trades"
    ON trades FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select_positions"
    ON positions FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select_portfolio_history"
    ON portfolio_history FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_select_market_snapshots"
    ON market_snapshots FOR SELECT TO authenticated USING (true);

-- Dashboard may toggle bot and edit settings; cannot switch to live mode
CREATE POLICY "authenticated_update_bot_status"
    ON bot_status FOR UPDATE TO authenticated
    USING (id = 1)
    WITH CHECK (id = 1 AND trading_mode = 'paper');

CREATE POLICY "authenticated_update_settings"
    ON settings FOR UPDATE TO authenticated
    USING (id = 1)
    WITH CHECK (id = 1 AND trading_mode = 'paper');

-- Realtime subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE bot_status;
ALTER PUBLICATION supabase_realtime ADD TABLE predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE positions;
ALTER PUBLICATION supabase_realtime ADD TABLE portfolio_history;
