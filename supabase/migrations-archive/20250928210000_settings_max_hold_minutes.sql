-- Max hold time for open trades (0 = disabled; let bracket SL/TP + Jev SELL exit)

ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS max_hold_minutes numeric(8, 2) NOT NULL DEFAULT 0;

UPDATE settings
SET max_hold_minutes = 0
WHERE id = 1;
