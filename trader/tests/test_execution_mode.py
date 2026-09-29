from __future__ import annotations

import unittest

from execution_mode import effective_execution_mode
from models.types import DataSource, ExecutionMode


class TestEffectiveExecutionMode(unittest.TestCase):
    def test_mock_data_source_uses_simulated(self) -> None:
        mode = effective_execution_mode(DataSource.MOCK, ExecutionMode.IBKR)
        self.assertEqual(mode, ExecutionMode.SIMULATED)

    def test_ibkr_data_source_uses_configured(self) -> None:
        mode = effective_execution_mode(DataSource.IBKR, ExecutionMode.IBKR)
        self.assertEqual(mode, ExecutionMode.IBKR)


if __name__ == "__main__":
    unittest.main()
