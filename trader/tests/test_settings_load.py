from __future__ import annotations

import dataclasses
import json
import unittest
from pathlib import Path

from tests.fake_supabase import fake_repository
from tests.settings_row_fixtures import SCENARIOS, SchemaSettingsClient

# Captured from the pre-refactor multi-select loader (fallback chain + optional-column merge).
GOLDEN = json.loads((Path(__file__).parent / "settings_golden.json").read_text())


class SettingsLoadTests(unittest.TestCase):
    def test_parsed_settings_match_golden_for_each_schema(self) -> None:
        for name, make in SCENARIOS.items():
            with self.subTest(scenario=name):
                repo = fake_repository(SchemaSettingsClient(make()))
                self.assertEqual(dataclasses.asdict(repo.get_risk_settings()), GOLDEN[name])

    def test_reads_the_settings_row_once(self) -> None:
        client = SchemaSettingsClient(SCENARIOS["full"]())
        fake_repository(client).get_risk_settings()
        self.assertEqual(client.selects, ["*"])

    def test_missing_row_raises(self) -> None:
        class FailingClient(SchemaSettingsClient):
            def execute(self):
                raise RuntimeError("network down")

        with self.assertRaises(RuntimeError):
            fake_repository(FailingClient({})).get_risk_settings()


if __name__ == "__main__":
    unittest.main()
