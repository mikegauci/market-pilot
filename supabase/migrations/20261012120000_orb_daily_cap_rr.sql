-- Fewer, better trades: global daily entry cap, minimum reward-to-risk, breakeven exit,
-- and an opening range breakout (ORB) entry mode that does not need Jev.
-- Defaults keep existing behaviour: cap off (0), reward-to-risk floor off (0),
-- breakeven off (NULL), entry_mode 'jev'.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS max_trades_per_day integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_reward_risk numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breakeven_at_r numeric,
  ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'jev',
  ADD COLUMN IF NOT EXISTS orb_range_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS orb_entry_cutoff_minutes integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS orb_jev_veto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_play_min_rvol numeric DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS in_play_min_gap_pct numeric;

ALTER TABLE public.settings
  DROP CONSTRAINT IF EXISTS settings_max_trades_per_day_check,
  ADD CONSTRAINT settings_max_trades_per_day_check
    CHECK (max_trades_per_day >= 0 AND max_trades_per_day <= 100),
  DROP CONSTRAINT IF EXISTS settings_min_reward_risk_check,
  ADD CONSTRAINT settings_min_reward_risk_check
    CHECK (min_reward_risk >= 0 AND min_reward_risk <= 5),
  DROP CONSTRAINT IF EXISTS settings_breakeven_at_r_check,
  ADD CONSTRAINT settings_breakeven_at_r_check
    CHECK (breakeven_at_r IS NULL OR (breakeven_at_r >= 0.25 AND breakeven_at_r <= 5)),
  DROP CONSTRAINT IF EXISTS settings_entry_mode_check,
  ADD CONSTRAINT settings_entry_mode_check
    CHECK (entry_mode = ANY (ARRAY['jev'::text, 'orb'::text])),
  DROP CONSTRAINT IF EXISTS settings_orb_range_minutes_check,
  ADD CONSTRAINT settings_orb_range_minutes_check
    CHECK (orb_range_minutes >= 5 AND orb_range_minutes <= 60 AND orb_range_minutes % 5 = 0),
  DROP CONSTRAINT IF EXISTS settings_orb_entry_cutoff_minutes_check,
  ADD CONSTRAINT settings_orb_entry_cutoff_minutes_check
    CHECK (orb_entry_cutoff_minutes >= 10 AND orb_entry_cutoff_minutes <= 330),
  DROP CONSTRAINT IF EXISTS settings_in_play_min_rvol_check,
  ADD CONSTRAINT settings_in_play_min_rvol_check
    CHECK (in_play_min_rvol IS NULL OR (in_play_min_rvol >= 0 AND in_play_min_rvol <= 50)),
  DROP CONSTRAINT IF EXISTS settings_in_play_min_gap_pct_check,
  ADD CONSTRAINT settings_in_play_min_gap_pct_check
    CHECK (in_play_min_gap_pct IS NULL OR (in_play_min_gap_pct >= 0 AND in_play_min_gap_pct <= 50));
