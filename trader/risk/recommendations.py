from __future__ import annotations

# Medium profile only — dashboard owns Low/Medium/High presets; trader uses saved dollar amounts.
RISK_RECOMMENDATIONS = {
    "risk_per_trade": 0.0025,
    "max_position_size": 0.01,
    "max_daily_loss": 0.01,
}

RISK_SYNC_THRESHOLD = 0.05


def should_advance_baseline(
    current_equity: float,
    baseline_equity: float | None,
    threshold: float = RISK_SYNC_THRESHOLD,
) -> bool:
    if current_equity <= 0:
        return False
    if baseline_equity is None or baseline_equity <= 0:
        return True
    return abs(current_equity - baseline_equity) / baseline_equity >= threshold
