from __future__ import annotations

import unittest

from database.repository._settings import SupabaseSettingsMixin


class StubSettingsRepository(SupabaseSettingsMixin):
    def __init__(self, rows: list[dict | None]) -> None:
        self.rows = list(rows)

    def _select_settings_row(self, columns: str) -> dict | None:
        del columns
        return self.rows.pop(0)


class OptionalSettingsColumnsTests(unittest.TestCase):
    def test_preserves_existing_optional_columns_when_breakout_columns_are_missing(
        self,
    ) -> None:
        repository = StubSettingsRepository(
            [
                {
                    "max_entries_per_symbol_per_day": 4,
                    "rotation_min_session_change_pct": 0.25,
                    "entry_ema_gate": "ema_9",
                    "max_rsi": 75,
                    "max_spread_pct": 0.002,
                },
                None,
            ]
        )
        data: dict = {}

        repository._merge_optional_settings_columns(data)

        self.assertEqual(data["max_entries_per_symbol_per_day"], 4)
        self.assertEqual(data["rotation_min_session_change_pct"], 0.25)
        self.assertEqual(data["entry_ema_gate"], "ema_9")
        self.assertEqual(data["max_rsi"], 75)
        self.assertEqual(data["max_spread_pct"], 0.002)
        self.assertNotIn("breakout_enabled", data)


if __name__ == "__main__":
    unittest.main()
