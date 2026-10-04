from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, List, Optional, Protocol, Sequence

import httpx

from news.cache import CooldownTracker
from news.sentiment import KNOWN_NEWS_TAGS, NewsArticle

logger = logging.getLogger(__name__)

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

_AUTH_COOLDOWN_KEY = "__openai_auth__"

_NEWS_SCORE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentiment": {
            "type": "number",
            "description": "Aggregate sentiment from -1 (bearish) to 1 (bullish).",
        },
        "tags": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": sorted(KNOWN_NEWS_TAGS),
            },
        },
    },
    "required": ["sentiment", "tags"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = (
    "You score recent company news headlines for a US equity day-trading bot. "
    "Return aggregate sentiment from -1 to 1 and tags from the allowed list only. "
    "Use negative sentiment when headlines imply risk (downgrades, lawsuits, misses, "
    "guidance cuts, layoffs, recalls, bankruptcy). Mixed headlines (e.g. beat plus "
    "guidance cut) should reflect the net risk for a long entry. "
    "Tags are factual labels for events mentioned, not duplicates of sentiment."
)


@dataclass(frozen=True)
class ScoredNews:
    sentiment: float
    tags: List[str]


class NewsLlmScorer(Protocol):
    def score(
        self,
        symbol: str,
        articles: Sequence[NewsArticle],
    ) -> Optional[ScoredNews]: ...


def _parse_retry_after(header_value: Optional[str], default: float) -> float:
    if not header_value:
        return default
    try:
        return float(header_value)
    except (TypeError, ValueError):
        return default


def _headlines_cache_key(symbol: str, articles: Sequence[NewsArticle]) -> str:
    parts = [symbol.upper()]
    for article in articles:
        parts.append(article.headline.strip())
        parts.append(article.summary.strip())
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return f"{symbol.upper()}:{digest}"


class OpenAiNewsScorer:
    """Optional LLM scorer for company news; never raises."""

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "gpt-4o-mini",
        timeout_sec: float = 8.0,
        max_retries: int = 2,
        cache_max_entries: int = 512,
        failure_cooldown_sec: float = 120.0,
    ) -> None:
        if not api_key.strip():
            raise ValueError("OPENAI_API_KEY is required for OpenAiNewsScorer")
        self.api_key = api_key.strip()
        self.model = model
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries
        self._cache: OrderedDict[str, ScoredNews] = OrderedDict()
        self._cache_max_entries = max(1, cache_max_entries)
        self._failure_cooldown = CooldownTracker(
            failure_cooldown_sec,
            max_ttl_sec=failure_cooldown_sec,
        )
        self._lock = threading.Lock()
        self._in_flight: dict[str, threading.Event] = {}

    def score(
        self,
        symbol: str,
        articles: Sequence[NewsArticle],
    ) -> Optional[ScoredNews]:
        if not articles:
            return None

        sym = symbol.upper()
        cache_key = _headlines_cache_key(symbol, articles)

        with self._lock:
            if self._failure_cooldown.is_active(_AUTH_COOLDOWN_KEY):
                return None
            if self._failure_cooldown.is_active(sym):
                return None
            cached = self._cache.get(cache_key)
            if cached is not None:
                self._cache.move_to_end(cache_key)
                return cached
            waiter = self._in_flight.get(cache_key)
            if waiter is not None:
                event = waiter
                is_leader = False
            else:
                event = threading.Event()
                self._in_flight[cache_key] = event
                is_leader = True

        if not is_leader:
            deadline = time.monotonic() + (
                self.timeout_sec * self.max_retries + 15.0
            )
            while time.monotonic() < deadline:
                if event.wait(timeout=0.25):
                    break
            with self._lock:
                cached = self._cache.get(cache_key)
                if cached is not None:
                    self._cache.move_to_end(cache_key)
                    return cached
            return None

        try:
            result = self._request_score(sym, symbol, articles)
            with self._lock:
                if result is not None:
                    self._store_cache(cache_key, result)
            return result
        finally:
            with self._lock:
                self._in_flight.pop(cache_key, None)
                event.set()

    def _request_score(
        self,
        sym: str,
        symbol: str,
        articles: Sequence[NewsArticle],
    ) -> Optional[ScoredNews]:
        payload_articles = [
            {
                "headline": article.headline,
                "summary": article.summary or "",
            }
            for article in articles
        ]
        user_content = json.dumps(
            {"symbol": sym, "articles": payload_articles},
            ensure_ascii=False,
        )

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
                    "name": "news_score",
                    "strict": True,
                    "schema": _NEWS_SCORE_JSON_SCHEMA,
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
                        "OpenAI news scorer rate limited for %s (attempt %s/%s)",
                        symbol,
                        attempt,
                        self.max_retries,
                    )
                    if attempt < self.max_retries:
                        time.sleep(retry_after)
                        continue
                    self._record_failure(sym)
                    return None

                response.raise_for_status()
                data = response.json()
                parsed = self._parse_response(data)
                if parsed is None:
                    self._record_failure(sym)
                    return None

                self._clear_failure(sym)
                return parsed

            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code in {401, 403}:
                    logger.warning("OpenAI news scorer auth error for %s", symbol)
                    self._record_failure(
                        _AUTH_COOLDOWN_KEY,
                        retry_after_sec=300.0,
                    )
                    return None
                logger.warning(
                    "OpenAI news scorer HTTP error for %s on attempt %s: %s",
                    symbol,
                    attempt,
                    exc,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "OpenAI news scorer failed for %s on attempt %s: %s",
                    symbol,
                    attempt,
                    exc,
                )

            if attempt < self.max_retries:
                time.sleep(2**attempt)

        logger.debug(
            "OpenAI news scorer gave up for %s: %s",
            symbol,
            last_error,
        )
        self._record_failure(sym)
        return None

    def _record_failure(
        self,
        key: str,
        *,
        retry_after_sec: Optional[float] = None,
    ) -> None:
        with self._lock:
            self._failure_cooldown.record(
                key,
                retry_after_sec=retry_after_sec,
            )

    def _clear_failure(self, key: str) -> None:
        with self._lock:
            self._failure_cooldown.clear(key)

    def _parse_response(self, data: dict) -> Optional[ScoredNews]:
        try:
            choices = data.get("choices") or []
            if not choices:
                return None
            message = choices[0].get("message") or {}
            content = message.get("content")
            if not content or not isinstance(content, str):
                return None
            payload = json.loads(content)
            sentiment = float(payload["sentiment"])
            raw_tags = payload.get("tags") or []
            tags = sorted(
                {
                    str(tag)
                    for tag in raw_tags
                    if str(tag) in KNOWN_NEWS_TAGS
                }
            )
            sentiment = max(-1.0, min(1.0, round(sentiment, 3)))
            return ScoredNews(sentiment=sentiment, tags=tags)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("OpenAI news scorer invalid JSON: %s", exc)
            return None

    def _store_cache(self, key: str, value: ScoredNews) -> None:
        self._cache[key] = value
        self._cache.move_to_end(key)
        while len(self._cache) > self._cache_max_entries:
            self._cache.popitem(last=False)
