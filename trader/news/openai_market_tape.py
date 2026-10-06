from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, List, Optional, Sequence

import httpx

from news.cache import CooldownTracker
from news.openai_scorer import OPENAI_CHAT_URL, _parse_retry_after
from news.sentiment import NewsArticle

logger = logging.getLogger(__name__)

_AUTH_COOLDOWN_KEY = "__openai_auth__"

KNOWN_TAPE_TAGS: frozenset[str] = frozenset(
    {
        "fed",
        "rates",
        "inflation",
        "geopolitics",
        "market_selloff",
        "market_rally",
        "sector_rotation",
        "regulation",
        "jobs_report",
    }
)

_TAPE_SCORE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentiment": {
            "type": "number",
            "description": "Broad tape sentiment from -1 (risk-off) to 1 (risk-on).",
        },
        "tags": {
            "type": "array",
            "items": {"type": "string", "enum": sorted(KNOWN_TAPE_TAGS)},
        },
        "top_headline": {
            "type": "string",
            "description": "One headline that best explains the tape mood.",
        },
    },
    "required": ["sentiment", "tags", "top_headline"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = (
    "You score general US market news headlines for a day-trading bot's broad tape context. "
    "Return aggregate risk-on/risk-off sentiment from -1 to 1, tags from the allowed list only, "
    "and the single headline that best captures today's macro mood for equities. "
    "Penalize sentiment on war escalation, banking stress, hot inflation surprises, "
    "or broad selloff narratives. Favor positive sentiment on soft landing, strong jobs "
    "without inflation scare, or broad rally narratives."
)


def _headlines_cache_key(articles: Sequence[NewsArticle]) -> str:
    parts: List[str] = []
    for article in articles[:12]:
        parts.append(article.headline.strip())
        parts.append(article.summary.strip())
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return f"tape:{digest}"


class OpenAiMarketTapeScorer:
    """Optional LLM scorer for general market headlines; never raises."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "gpt-4o-mini",
        timeout_sec: float = 8.0,
        max_retries: int = 2,
        cache_max_entries: int = 32,
        failure_cooldown_sec: float = 120.0,
    ) -> None:
        if not api_key.strip():
            raise ValueError("OPENAI_API_KEY is required for OpenAiMarketTapeScorer")
        self.api_key = api_key.strip()
        self.model = model
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries
        self._cache: OrderedDict[str, tuple[float, str, List[str]]] = OrderedDict()
        self._cache_max_entries = max(1, cache_max_entries)
        self._failure_cooldown = CooldownTracker(
            failure_cooldown_sec,
            max_ttl_sec=failure_cooldown_sec,
        )
        self._lock = threading.Lock()

    def score(
        self,
        articles: Sequence[NewsArticle],
    ) -> Optional[tuple[float, List[str], str]]:
        if not articles:
            return None

        cache_key = _headlines_cache_key(articles)
        with self._lock:
            if self._failure_cooldown.is_active(_AUTH_COOLDOWN_KEY):
                return None
            if self._failure_cooldown.is_active("tape"):
                return None
            cached = self._cache.get(cache_key)
            if cached is not None:
                self._cache.move_to_end(cache_key)
                return cached

        result = self._request_score(articles)
        if result is None:
            with self._lock:
                self._failure_cooldown.record("tape")
            return None

        with self._lock:
            self._failure_cooldown.clear("tape")
            self._cache[cache_key] = result
            self._cache.move_to_end(cache_key)
            while len(self._cache) > self._cache_max_entries:
                self._cache.popitem(last=False)
        return result

    def _request_score(
        self,
        articles: Sequence[NewsArticle],
    ) -> Optional[tuple[float, List[str], str]]:
        payload_articles = [
            {
                "headline": article.headline,
                "summary": article.summary or "",
            }
            for article in articles[:12]
        ]
        user_content = json.dumps({"articles": payload_articles}, ensure_ascii=False)
        body = {
            "model": self.model,
            "temperature": 0,
            "max_tokens": 256,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "tape_score",
                    "strict": True,
                    "schema": _TAPE_SCORE_JSON_SCHEMA,
                },
            },
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        last_error: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout_sec) as client:
                    response = client.post(OPENAI_CHAT_URL, json=body, headers=headers)

                if response.status_code == 429:
                    retry_after = _parse_retry_after(
                        response.headers.get("retry-after"),
                        float(2**attempt),
                    )
                    logger.warning(
                        "OpenAI market tape scorer rate limited (attempt %s/%s)",
                        attempt,
                        self.max_retries,
                    )
                    if attempt < self.max_retries:
                        time.sleep(retry_after)
                        continue
                    return None

                response.raise_for_status()
                parsed = self._parse_response(response.json())
                if parsed is not None:
                    return parsed

            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code in {401, 403}:
                    with self._lock:
                        self._failure_cooldown.record(
                            _AUTH_COOLDOWN_KEY,
                            retry_after_sec=300.0,
                        )
                    return None
                logger.warning(
                    "OpenAI market tape HTTP error on attempt %s: %s",
                    attempt,
                    exc,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "OpenAI market tape failed on attempt %s: %s",
                    attempt,
                    exc,
                )

            if attempt < self.max_retries:
                time.sleep(2**attempt)

        logger.debug("OpenAI market tape gave up: %s", last_error)
        return None

    def _parse_response(self, data: dict) -> Optional[tuple[float, List[str], str]]:
        try:
            choices = data.get("choices") or []
            if not choices:
                return None
            message = choices[0].get("message") or {}
            content = message.get("content")
            if not content or not isinstance(content, str):
                return None
            payload = json.loads(content)
            sentiment = max(-1.0, min(1.0, round(float(payload["sentiment"]), 3)))
            raw_tags = payload.get("tags") or []
            tags = sorted(
                {str(tag) for tag in raw_tags if str(tag) in KNOWN_TAPE_TAGS}
            )
            top_headline = str(payload.get("top_headline", "")).strip()
            if not top_headline:
                return None
            return sentiment, tags, top_headline[:500]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("OpenAI market tape invalid JSON: %s", exc)
            return None
