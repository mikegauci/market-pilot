from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Set


@dataclass
class TraderRuntimeState:
    """Mutable per-process trader loop state (formerly module globals)."""

    shutdown_requested: bool = False
    warmup_logged: Set[str] = field(default_factory=set)
    last_closed_market_log: float = 0.0
    last_market_data_warn: float = 0.0
    ibkr_market_data_mode: str = "stream"
    ibkr_entry_cooldown_until: Dict[str, float] = field(default_factory=dict)
    ibkr_entry_blocked: Set[str] = field(default_factory=set)
    eod_sim_last_attempt_mono: float = 0.0
    eod_ibkr_last_attempt_mono: Dict[str, float] = field(default_factory=dict)
    last_trader_status_log_mono: float = 0.0
    last_rotation_mono: float = 0.0
    last_ibkr_bracket_target_refresh_mono: float = 0.0
    cycle_elapsed_sec: list[float] = field(default_factory=list)
    minute_seed_attempt_mono: Dict[str, float] = field(default_factory=dict)
    breakout_until_mono: Dict[str, float] = field(default_factory=dict)
    deferred_backfill_queue: List[str] = field(default_factory=list)
