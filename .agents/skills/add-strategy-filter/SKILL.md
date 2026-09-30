---
name: add-strategy-filter
description: Add or tune an entry gate in the market-pilot Python strategy layer — filters.py, StrategyConfig, config.py STRATEGY_* env vars, tests, and README. Use when adding spread/RSI/volume/news/correlation rules or new FilterResult skip reasons shown as trade_skip_reason in the dashboard.
---

# Add a strategy filter

Entry gates live in `trader/strategy/filters.py` and `StrategyConfig`. Failed checks become **`trade_skip_reason`** on `predictions` and appear in dashboard skip-reason analytics — use **stable, lowercase, greppable** reason strings (optionally with parentheses for numbers).

## Checklist

```text
- [ ] trader/strategy/filters.py — FilterResult(False, "reason")
- [ ] trader/strategy/config.py — field + default on StrategyConfig
- [ ] trader/config.py — strategy_* on Settings + strategy_config() mapping
- [ ] trader/.env.example — # STRATEGY_* comment
- [ ] If dashboard-tunable: follow add-trading-setting (Supabase settings + dashboard)
- [ ] trader/tests/test_strategy.py — unit test for pass/fail
- [ ] README.md — Strategy filters table row
- [ ] preflight-checks
```

## 1. Implement the gate

In `check_entry_filters()` or `check_correlation_cap()` in `trader/strategy/filters.py`:

```python
if config.my_threshold > 0 and state.some_metric is not None:
    if state.some_metric > config.my_threshold:
        return FilterResult(False, f"my_reason ({state.some_metric:.2f})")
```

Keep checks ordered: cheap guards first (price, spread) before news/API-heavy logic.

Existing patterns: `min_share_price`, `max_spread_pct`, `max_rsi`, `min_volume_ratio`, `require_price_above_ema20`, `max_spy_drop_5m_pct`, news tags, `max_correlated_positions`.

## 2. StrategyConfig

Add a field with a safe default in `trader/strategy/config.py`:

```python
@dataclass(frozen=True)
class StrategyConfig:
    ...
    my_threshold: float = 0.0  # 0 = off
```

If Supabase `settings` overrides env, wire through `strategy_config_with_risk_overrides()` when the value is stored in `RiskSettings`.

## 3. Env binding (local dev)

In `trader/config.py`:

- Field: `strategy_my_threshold: float = 0.0` (pydantic-settings maps `STRATEGY_MY_THRESHOLD`).
- In `strategy_config()`, pass `my_threshold=self.strategy_my_threshold`.

In `trader/.env.example`:

```env
# STRATEGY_MY_THRESHOLD=0
```

Note: some knobs (e.g. `min_volume_ratio`, `min_share_price`) are **dashboard-first**; env defaults may be unused when Supabase settings load in `main.py`.

## 4. Tests

Extend `trader/tests/test_strategy.py`:

- Build a minimal `MarketState` and `StrategyConfig`.
- Assert `check_entry_filters(...).passed` and `.reason` for edge cases.

Run:

```bash
cd trader && .venv/bin/python -m pytest tests/test_strategy.py -q
```

## 5. README

Add a row to **Strategy filters (Phase 3+)** in root `README.md` with default and purpose.

## 6. Dashboard vs env-only

| Tunable in Settings UI | Env-only dev default |
|------------------------|----------------------|
| Use **add-trading-setting** full checklist | StrategyConfig + config.py + .env.example only |
| Trader merges via `get_risk_settings()` + `strategy_config_with_risk_overrides` | Document in README only |

## Reason string guidelines

- Prefer `snake_case` prefix: `volume_too_low`, not `Volume too low`.
- Dynamic suffix in parentheses is fine: `spread_too_wide (0.25%)`.
- Avoid changing existing reason strings — breaks analytics history comparisons.

## Wiring in main

Entry flow in `trader/main.py` (approx):

1. Jev tier → if not ELIGIBLE, `trade_skip_reason_from_tier`.
2. Confirmation cycles → `awaiting_confirmation (n/m)`.
3. `check_entry_filters` → `entry_filter.reason`.
4. `check_correlation_cap` → `corr_filter.reason`.
5. Risk manager → `decision.reason`.

New filter reasons automatically persist when step 3/4 fails before a trade opens.
