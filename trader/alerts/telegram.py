"""Alert notifiers (Telegram). Non-blocking with short timeouts."""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional, Protocol

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_TIMEOUT_SEC = 2.0


class Notifier(Protocol):
    def configured(self) -> bool: ...

    def send(self, message: str) -> None: ...


class NullNotifier:
    def configured(self) -> bool:
        return False

    def send(self, message: str) -> None:
        logger.warning("Notifier unconfigured; dropping alert: %s", message[:200])


class TelegramNotifier:
    """Fire-and-forget Telegram Bot API alerts."""

    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        *,
        timeout_sec: float = TELEGRAM_TIMEOUT_SEC,
    ) -> None:
        self.bot_token = bot_token.strip()
        self.chat_id = chat_id.strip()
        self.timeout_sec = timeout_sec

    def configured(self) -> bool:
        return bool(self.bot_token and self.chat_id)

    def send(self, message: str) -> None:
        if not self.configured():
            NullNotifier().send(message)
            return
        thread = threading.Thread(
            target=self._send_sync,
            args=(message,),
            name="telegram-notify",
            daemon=True,
        )
        thread.start()

    def _send_sync(self, message: str) -> None:
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        try:
            with httpx.Client(timeout=self.timeout_sec) as client:
                response = client.post(
                    url,
                    json={"chat_id": self.chat_id, "text": message[:4000]},
                )
                if response.status_code >= 400:
                    logger.warning(
                        "Telegram alert failed HTTP %s: %s",
                        response.status_code,
                        response.text[:200],
                    )
        except Exception as exc:
            logger.warning("Telegram alert error: %s", exc)


def build_notifier_from_env(
    *,
    bot_token: Optional[str] = None,
    chat_id: Optional[str] = None,
) -> Notifier:
    token = bot_token if bot_token is not None else os.getenv("TELEGRAM_BOT_TOKEN", "")
    cid = chat_id if chat_id is not None else os.getenv("TELEGRAM_CHAT_ID", "")
    notifier = TelegramNotifier(token or "", cid or "")
    if notifier.configured():
        return notifier
    return NullNotifier()
