from __future__ import annotations

import unittest

from config import load_settings
from tests.fake_supabase import fake_repository
from tests.settings_row_fixtures import SCENARIOS, SchemaSettingsClient
from strategy.config import strategy_config_from_risk
from strategy.ema_gate import normalize_entry_ema_gate


class StrategyConfigFromRiskTests(unittest.TestCase):
    def test_dashboard_values_override_env_defaults(self) -> None:
        risk = fake_repository(SchemaSettingsClient(SCENARIOS["full"]())).get_risk_settings()
        base = load_settings().strategy_config
        cfg = strategy_config_from_risk(base, risk)
        self.assertEqual(cfg.min_volume_ratio, 0.8)
        self.assertEqual(cfg.min_dollar_volume, 500000)
        self.assertEqual(cfg.confirmation_cycles, 3)
        self.assertEqual(cfg.rotation_min_session_change_pct, 0.4)
        self.assertEqual(cfg.entry_ema_gate, normalize_entry_ema_gate("ema_9"))
        self.assertEqual(cfg.max_rsi, 72)
        self.assertEqual(cfg.max_spread_pct, 0.002)
        self.assertFalse(cfg.breakout_enabled)
        self.assertEqual(cfg.breakout_lookback_minutes, 15)

    def test_unset_optionals_keep_env_values(self) -> None:
        risk = fake_repository(SchemaSettingsClient(SCENARIOS["core_only"]())).get_risk_settings()
        base = load_settings().strategy_config
        cfg = strategy_config_from_risk(base, risk)
        self.assertEqual(cfg.max_rsi, base.max_rsi)
        self.assertEqual(cfg.max_spread_pct, base.max_spread_pct)
        self.assertEqual(cfg.entry_ema_gate, base.entry_ema_gate)
        self.assertEqual(cfg.breakout_enabled, base.breakout_enabled)


if __name__ == "__main__":
    unittest.main()
