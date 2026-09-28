-- Tighten default strategy settings for pickier entries

ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS risk_profile text DEFAULT 'low';

UPDATE settings
SET
    minimum_jev_confidence = 0.8500,
    signal_record_threshold = 0.8000,
    max_open_positions = 2,
    watchlist = ARRAY['NVDA', 'AAPL', 'MSFT', 'META', 'GOOGL'],
    risk_profile = COALESCE(risk_profile, 'low')
WHERE id = 1;
