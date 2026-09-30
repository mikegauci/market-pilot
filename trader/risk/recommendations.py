from __future__ import annotations

# Medium profile only — dashboard owns Low/Medium/High presets; trader uses saved dollar amounts.
# Share count is driven by risk_per_trade and stop distance; max_position_size is a notional cap
# (see RiskManager.compute_position_size). Keep max_position_size above typical risk-sized notionals
# or expect clip logs when the cap binds before the risk budget does.
RISK_RECOMMENDATIONS = {
    "risk_per_trade": 0.0025,
    "max_position_size": 0.005,
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
