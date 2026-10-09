-- Breakout promotion knobs (dashboard Settings; env fallback when columns absent on old rows).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS breakout_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS breakout_max_rsi double precision NOT NULL DEFAULT 82,
  ADD COLUMN IF NOT EXISTS breakout_window_minutes double precision NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS breakout_max_promotions_per_cycle integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS breakout_lookback_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS breakout_min_volume_ratio double precision NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS breakout_min_change_5m_pct double precision NOT NULL DEFAULT 0.15;
