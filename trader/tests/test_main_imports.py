from __future__ import annotations

import unittest


class MainImportTests(unittest.TestCase):
    def test_process_ready_states_is_imported_for_eval_loop(self) -> None:
        import main

        from runtime.entry_eval import process_ready_states

        self.assertIs(main.process_ready_states, process_ready_states)


if __name__ == "__main__":
    unittest.main()
