-- Remove unused settings.bot_enabled (trader uses bot_status.enabled).
-- Store why a prediction did not open a trade.

ALTER TABLE settings DROP COLUMN IF EXISTS bot_enabled;

ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS trade_skip_reason text;
