"""Sticky daily-loss / drawdown risk halt coordinator."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Callable, Dict, List, Optional

from market.hours import us_trading_date
from models.types import Quote, RiskSettings
from risk.daily_pnl import (
    compute_daily_loss_pnl,
    drawdown_frac,
    resolved_peak_equity,
)

if TYPE_CHECKING:
    from database.supabase import SupabaseRepository
    from risk.manager import RiskManager

logger = logging.getLogger(__name__)


@dataclass
class RiskHaltState:
    active: bool = False
    reason: str = ""
    halt_type: str = ""
    trading_date: Optional[date] = None
    action_taken: str = "block_entries"
    daily_pnl: float = 0.0
    drawdown_frac: float = 0.0
    last_alerted_key: Optional[str] = None
    last_eval_at: Optional[datetime] = None


@dataclass
class RiskHaltEvalResult:
    state: RiskHaltState
    newly_tripped: bool = False
    flatten_requested: bool = False
    events: List[str] = field(default_factory=list)


class RiskHaltCoordinator:
    """Persist and enforce daily-loss / drawdown halts for the US trading date."""

    def __init__(self) -> None:
        self.state = RiskHaltState()

    def hydrate(
        self,
        db: "SupabaseRepository",
        *,
        now: Optional[datetime] = None,
    ) -> RiskHaltState:
        today = us_trading_date(now)
        try:
            db.clear_stale_risk_halts(before_trading_date=today)
        except Exception as exc:
            logger.warning("clear_stale_risk_halts failed: %s", exc)
        active = db.get_active_risk_halts(trading_date=today)
        if not active:
            self.state = RiskHaltState(trading_date=today, last_eval_at=now)
            return self.state
        # Prefer daily_loss over drawdown for display reason if both present.
        by_type = {row["halt_type"]: row for row in active}
        chosen = by_type.get("daily_loss") or by_type.get("drawdown") or active[0]
        reason = str(chosen["halt_type"])
        self.state = RiskHaltState(
            active=True,
            reason=reason,
            halt_type=str(chosen["halt_type"]),
            trading_date=today,
            action_taken=str(chosen.get("action_taken") or "block_entries"),
            last_eval_at=now,
        )
        logger.info(
            "Hydrated risk halt for %s: type=%s action=%s",
            today.isoformat(),
            self.state.halt_type,
            self.state.action_taken,
        )
        return self.state

    def _roll_day_if_needed(self, today: date) -> None:
        if self.state.trading_date is not None and self.state.trading_date != today:
            # New US day — sticky halt expires automatically.
            self.state = RiskHaltState(trading_date=today)

    def entry_blocked(self) -> Optional[str]:
        if not self.state.active:
            return None
        if self.state.halt_type == "drawdown":
            return "drawdown_halt"
        return "max_daily_loss"

    def evaluate(
        self,
        *,
        risk_manager: "RiskManager",
        risk_settings: RiskSettings,
        db: "SupabaseRepository",
        quotes_by_symbol: Dict[str, Quote],
        equity: Optional[float] = None,
        history_high_water: Optional[float] = None,
        now: Optional[datetime] = None,
        notifier: Optional[Callable[[str], None]] = None,
    ) -> RiskHaltEvalResult:
        now_u = now or datetime.now(timezone.utc)
        today = us_trading_date(now_u)
        self._roll_day_if_needed(today)
        if self.state.trading_date is None:
            self.state.trading_date = today

        include_fees = bool(getattr(risk_settings, "daily_loss_include_fees", False))
        realized = db.get_daily_realized_pnl(
            trading_date=today, include_fees=include_fees
        )
        risk_manager.set_daily_realized_pnl(realized)

        daily_pnl = compute_daily_loss_pnl(
            realized_pnl=realized,
            open_trades=risk_manager.open_trades,
            quotes=quotes_by_symbol,
            risk_settings=risk_settings,
        )
        self.state.daily_pnl = daily_pnl
        self.state.last_eval_at = now_u

        peak = resolved_peak_equity(
            account_capital=float(risk_settings.account_capital),
            history_high_water=history_high_water,
        )
        eq = float(equity) if equity is not None else peak + daily_pnl
        dd = drawdown_frac(equity=eq, peak_equity=peak)
        self.state.drawdown_frac = dd

        newly = False
        flatten = False
        events: List[str] = []
        alert = notifier or (lambda _m: None)

        # Sticky: already halted today — keep blocking even if MTM recovers.
        if self.state.active and self.state.trading_date == today:
            return RiskHaltEvalResult(state=self.state, newly_tripped=False)

        max_loss = float(risk_settings.max_daily_loss)
        if daily_pnl <= -max_loss:
            action = str(
                getattr(risk_settings, "daily_loss_action", None) or "block_entries"
            )
            if action not in {"block_entries", "flatten_and_block"}:
                action = "block_entries"
            inserted = db.insert_risk_halt(
                trading_date=today,
                halt_type="daily_loss",
                action_taken=action,
                detail={
                    "daily_pnl": daily_pnl,
                    "max_daily_loss": max_loss,
                    "realized": realized,
                },
            )
            self.state.active = True
            self.state.reason = "daily_loss"
            self.state.halt_type = "daily_loss"
            self.state.action_taken = action
            newly = bool(inserted)
            flatten = action == "flatten_and_block"
            events.append("daily_loss")
            alert_key = f"daily_loss:{today.isoformat()}"
            if newly or self.state.last_alerted_key != alert_key:
                alert(
                    f"Market Pilot RISK HALT: daily_loss "
                    f"(pnl={daily_pnl:.2f} limit=-{max_loss:.2f}) action={action}"
                )
                self.state.last_alerted_key = alert_key
            return RiskHaltEvalResult(
                state=self.state,
                newly_tripped=newly,
                flatten_requested=flatten,
                events=events,
            )

        if bool(getattr(risk_settings, "drawdown_breaker_enabled", False)):
            max_dd = float(getattr(risk_settings, "drawdown_max_frac", 0.10) or 0.10)
            if dd >= max_dd:
                action = str(
                    getattr(risk_settings, "daily_loss_action", None) or "block_entries"
                )
                if action not in {"block_entries", "flatten_and_block"}:
                    action = "block_entries"
                inserted = db.insert_risk_halt(
                    trading_date=today,
                    halt_type="drawdown",
                    action_taken=action,
                    detail={
                        "drawdown_frac": dd,
                        "drawdown_max_frac": max_dd,
                        "equity": eq,
                        "peak": peak,
                    },
                )
                self.state.active = True
                self.state.reason = "drawdown"
                self.state.halt_type = "drawdown"
                self.state.action_taken = action
                newly = bool(inserted)
                flatten = action == "flatten_and_block"
                events.append("drawdown")
                alert_key = f"drawdown:{today.isoformat()}"
                if newly or self.state.last_alerted_key != alert_key:
                    alert(
                        f"Market Pilot RISK HALT: drawdown "
                        f"(dd={dd:.1%} limit={max_dd:.1%}) action={action}"
                    )
                    self.state.last_alerted_key = alert_key
                return RiskHaltEvalResult(
                    state=self.state,
                    newly_tripped=newly,
                    flatten_requested=flatten,
                    events=events,
                )

        return RiskHaltEvalResult(state=self.state, newly_tripped=False)
