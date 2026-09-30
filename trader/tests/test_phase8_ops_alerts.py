"""Phase 8: IBKR disconnect edge alerts and audit payload helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

from risk.ibkr_disconnect_alert import IbkrDisconnectAlertTracker


def test_disconnect_alerts_once_on_edge() -> None:
    tracker = IbkrDisconnectAlertTracker(min_gap_sec=60.0)
    notifier = MagicMock()

    assert tracker.observe(True, notifier=notifier, now_mono=100.0) is False
    notifier.send.assert_not_called()

    assert tracker.observe(False, notifier=notifier, now_mono=110.0) is True
    notifier.send.assert_called_once()
    assert "disconnected" in notifier.send.call_args[0][0].lower()

    notifier.reset_mock()
    assert tracker.observe(False, notifier=notifier, now_mono=120.0) is False
    notifier.send.assert_not_called()


def test_disconnect_alert_respects_debounce() -> None:
    tracker = IbkrDisconnectAlertTracker(min_gap_sec=60.0)
    notifier = MagicMock()
    tracker.observe(True, notifier=notifier, now_mono=0.0)
    assert tracker.observe(False, notifier=notifier, now_mono=1.0) is True
    notifier.reset_mock()
    tracker.observe(True, notifier=notifier, now_mono=2.0)
    notifier.reset_mock()
    # Second disconnect inside gap — no alert
    assert tracker.observe(False, notifier=notifier, now_mono=10.0) is False
    notifier.send.assert_not_called()
    # After gap — alert again
    tracker.observe(True, notifier=notifier, now_mono=11.0)
    notifier.reset_mock()
    assert tracker.observe(False, notifier=notifier, now_mono=80.0) is True
    notifier.send.assert_called()
