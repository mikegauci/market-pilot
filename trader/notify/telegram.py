"""Telegram alerts when a trade opens or closes.

Credentials come from TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. When either is
blank, alerts are skipped and no HTTP request is made.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict

from models.types import TradeRecord

logger = logging.getLogger(__name__)

_TIMEOUT_SEC = 5.0

# Keep in sync with dashboard/lib/trade-analytics.ts exitReasonLabel.
_EXIT_REASON_LABELS = {
    "stop_loss": "Stop loss",
    "take_profit": "Top profit take",
    "profit_take": "JEV soft sell / early take",
    "time_exit": "Max hold",
    "jev_sell": "JEV hard sell",
    "demotion_exit": "Demotion exit",
    "eod_flatten": "EOD flatten (incl. losers)",
    "manual": "Manual close",
    "broker_flat": "Already flat at broker",
    "unknown": "Unknown",
}


class _TelegramSettings(BaseSettings):
    """Read alert credentials without the full trader Settings validators."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

_credentials_configured: bool = False
_configured_token: str = ""
_configured_chat_id: str = ""


def configure_telegram(bot_token: str, chat_id: str) -> None:
    """Apply trader Settings once at startup (env + .env merge)."""
    global _credentials_configured, _configured_token, _configured_chat_id
    _credentials_configured = True
    _configured_token = bot_token.strip()
    _configured_chat_id = chat_id.strip()


def exit_reason_label(reason: Optional[str]) -> str:
    if not reason:
        return _EXIT_REASON_LABELS["unknown"]
    if reason in _EXIT_REASON_LABELS:
        return _EXIT_REASON_LABELS[reason]
    if reason.startswith("ibkr_"):
        return "Broker bracket"
    return reason.replace("_", " ")


def format_pnl(net_pnl: float) -> str:
    if net_pnl < 0:
        return f"-${abs(net_pnl):.2f}"
    if net_pnl > 0:
        return f"+${net_pnl:.2f}"
    return "$0.00"


def format_open_message(
    symbol: str,
    jev_buy_probability: Optional[float],
    stop_loss: float,
    take_profit: float,
) -> str:
    lines = [f"OPENED {symbol}"]
    if jev_buy_probability is not None:
        lines.append(f"JEV buy {jev_buy_probability:.0%}")
    lines.append(f"Stop ${stop_loss:.2f} · target ${take_profit:.2f}")
    return "\n".join(lines)


def format_close_message(
    symbol: str,
    exit_reason: Optional[str],
    net_pnl: float,
) -> str:
    label = exit_reason_label(exit_reason)
    return f"CLOSED {symbol} — {label}\nNet PnL {format_pnl(net_pnl)}"


def _credentials() -> Optional[tuple[str, str]]:
    if _credentials_configured:
        if _configured_token and _configured_chat_id:
            return _configured_token, _configured_chat_id
        return None
    loaded = _TelegramSettings()
    token = loaded.telegram_bot_token.strip()
    chat_id = loaded.telegram_chat_id.strip()
    if not token or not chat_id:
        return None
    return token, chat_id


def _send(token: str, chat_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        with httpx.Client(timeout=_TIMEOUT_SEC) as client:
            response = client.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": text,
                    "disable_web_page_preview": True,
                },
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Telegram trade alert failed: HTTP %s",
            exc.response.status_code,
        )
    except Exception as exc:
        logger.warning("Telegram trade alert failed: %s", type(exc).__name__)


def _schedule(text: str) -> None:
    try:
        creds = _credentials()
    except Exception as exc:
        logger.warning("Telegram trade alert skipped: %s", type(exc).__name__)
        return
    if creds is None:
        return
    token, chat_id = creds
    threading.Thread(
        target=_send,
        args=(token, chat_id, text),
        daemon=True,
        name="telegram-trade-alert",
    ).start()


def notify_trade_opened(trade: TradeRecord) -> None:
    text = format_open_message(
        trade.symbol,
        trade.jev_buy_probability,
        trade.stop_loss,
        trade.take_profit,
    )
    _schedule(text)


def notify_trade_closed(
    symbol: str,
    net_pnl: float,
    exit_reason: Optional[str],
) -> None:
    _schedule(format_close_message(symbol, exit_reason, net_pnl))
