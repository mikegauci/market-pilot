from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Literal, Optional

import httpx

from models.types import JevPrediction, MarketState
from news.openai_scorer import OPENAI_CHAT_URL, _parse_retry_after

logger = logging.getLogger(__name__)

ShadowVerdict = Literal["agree", "hold", "conflict"]

_SHADOW_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["agree", "hold", "conflict"],
        },
        "note": {
            "type": "string",
            "description": "One sentence; plain language.",
        },
    },
    "required": ["verdict", "note"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = (
    "You second-read a day-trading bot's Jev BUY signal from the supplied market snapshot. "
    "Return agree when indicators and news support a long, hold when unclear, conflict when "
    "news or tape contradicts the BUY. This is advisory only — never recommend live trading."
)


def should_shadow_read(
    prediction: JevPrediction,
    *,
    record_threshold: float,
) -> bool:
    """True for BUY-dominant rows at RECORD tier or above."""
    dominant = max(
        [("buy", prediction.buy), ("hold", prediction.hold), ("sell", prediction.sell)],
        key=lambda item: item[1],
    )
    if dominant[0] != "buy":
        return False
    return prediction.buy >= record_threshold


class OpenAiShadowReader:
    """Optional second read on strong BUY signals; never raises."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "gpt-4o-mini",
        timeout_sec: float = 6.0,
        max_retries: int = 1,
    ) -> None:
        if not api_key.strip():
            raise ValueError("OPENAI_API_KEY is required for OpenAiShadowReader")
        self.api_key = api_key.strip()
        self.model = model
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries
        self._lock = threading.Lock()
        self._cooldown_until = 0.0

    def read(
        self,
        state: MarketState,
        prediction: JevPrediction,
    ) -> Optional[tuple[ShadowVerdict, str]]:
        if time.monotonic() < self._cooldown_until:
            return None

        user_payload = {
            "symbol": state.symbol,
            "buy_pct": round(prediction.buy * 100, 1),
            "hold_pct": round(prediction.hold * 100, 1),
            "sell_pct": round(prediction.sell * 100, 1),
            "snapshot": state.to_dict(),
        }
        body = {
            "model": self.model,
            "temperature": 0,
            "max_tokens": 180,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "shadow_read",
                    "strict": True,
                    "schema": _SHADOW_JSON_SCHEMA,
                },
            },
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        for attempt in range(1, self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout_sec) as client:
                    response = client.post(OPENAI_CHAT_URL, json=body, headers=headers)

                if response.status_code == 429:
                    self._set_cooldown(30.0)
                    return None

                response.raise_for_status()
                parsed = self._parse_response(response.json())
                if parsed is not None:
                    return parsed
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in {401, 403}:
                    self._set_cooldown(300.0)
                    return None
                logger.warning("OpenAI shadow read HTTP error: %s", exc)
            except Exception as exc:
                logger.warning("OpenAI shadow read failed: %s", exc)

            if attempt < self.max_retries:
                time.sleep(1.0)
        return None

    def _set_cooldown(self, seconds: float) -> None:
        with self._lock:
            self._cooldown_until = time.monotonic() + seconds

    def _parse_response(self, data: dict) -> Optional[tuple[ShadowVerdict, str]]:
        try:
            choices = data.get("choices") or []
            if not choices:
                return None
            message = choices[0].get("message") or {}
            content = message.get("content")
            if not content or not isinstance(content, str):
                return None
            payload = json.loads(content)
            verdict = str(payload["verdict"])
            if verdict not in {"agree", "hold", "conflict"}:
                return None
            note = str(payload.get("note", "")).strip()
            if not note:
                return None
            return verdict, note[:400]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("OpenAI shadow read invalid JSON: %s", exc)
            return None
