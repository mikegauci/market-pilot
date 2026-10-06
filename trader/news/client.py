from __future__ import annotations

import hashlib
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx

from news.cache import CooldownTracker, TtlCache
from news.openai_scorer import NewsLlmScorer
from news.sentiment import (
    NewsArticle,
    NewsContext,
    merge_news_scores,
    published_at_from_unix,
    score_articles,
    score_single_article,
)
from news.tape_context import MarketTapeContext, MarketTapeStore

logger = logging.getLogger(__name__)

FINNHUB_NEWS_URL = "https://finnhub.io/api/v1/company-news"
FINNHUB_MARKET_NEWS_URL = "https://finnhub.io/api/v1/news"


class FetchStatus(str, Enum):
    OK = "ok"
    EMPTY = "empty"
    ERROR = "error"
    RATE_LIMITED = "rate_limited"


@dataclass(frozen=True)
class FetchOutcome:
    context: Optional[NewsContext]
    status: FetchStatus
    retry_after_sec: float = 60.0


@dataclass(frozen=True)
class MarketNewsItem:
    id: int
    headline: str
    summary: str
    url: str
    source: str
    image: str
    category: str
    related: str
    related_symbols: List[str]
    published_at: str
    sentiment: float
    tags: List[str]

    def to_row(self, *, fetched_at: str) -> Dict[str, Any]:
        return {
            "id": self.id,
            "headline": self.headline,
            "summary": self.summary or None,
            "url": self.url or None,
            "source": self.source or None,
            "image": self.image or None,
            "category": self.category,
            "related": self.related or None,
            "related_symbols": self.related_symbols,
            "published_at": self.published_at,
            "fetched_at": fetched_at,
            "sentiment": self.sentiment,
            "tags": self.tags,
        }


def _http_status_message(exc: httpx.HTTPStatusError) -> str:
    return f"HTTP {exc.response.status_code}"


def _stable_news_id(
    raw_id: object,
    *,
    url: str,
    headline: str,
    published_ts: int,
) -> int:
    if raw_id is not None and str(raw_id).strip():
        try:
            return int(raw_id)
        except (TypeError, ValueError):
            pass
    key = url or f"{headline}|{published_ts}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:15]
    return int(digest, 16)


def parse_related_symbols(related: str) -> List[str]:
    if not related or not related.strip():
        return []
    symbols: List[str] = []
    seen: set[str] = set()
    for part in related.replace(";", ",").split(","):
        symbol = part.strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols


def _parse_general_articles(
    raw: list,
    *,
    category: str,
    max_items: int = 100,
) -> List[MarketNewsItem]:
    sorted_items = sorted(
        raw,
        key=lambda item: int(item.get("datetime", 0)),
        reverse=True,
    )
    articles: List[MarketNewsItem] = []
    for item in sorted_items:
        headline = str(item.get("headline", "")).strip()
        if not headline:
            continue
        published_ts = int(item.get("datetime", 0))
        published_at = published_at_from_unix(published_ts)
        if not published_at:
            continue
        summary = str(item.get("summary", "")).strip()
        url = str(item.get("url", "")).strip()
        source = str(item.get("source", "")).strip()
        image = str(item.get("image", "")).strip()
        related = str(item.get("related", "")).strip()
        article = NewsArticle(
            headline=headline,
            summary=summary,
            url=url,
            source=source,
            published_at=published_at,
            image=image,
        )
        sentiment, tags = score_single_article(article)
        articles.append(
            MarketNewsItem(
                id=_stable_news_id(
                    item.get("id"),
                    url=url,
                    headline=headline,
                    published_ts=published_ts,
                ),
                headline=headline,
                summary=summary,
                url=url,
                source=source,
                image=image,
                category=str(item.get("category") or category),
                related=related,
                related_symbols=parse_related_symbols(related),
                published_at=published_at,
                sentiment=sentiment,
                tags=tags,
            )
        )
        if len(articles) >= max_items:
            break
    return articles


class FinnhubNewsClient:
    """Fetch company and general market news from Finnhub."""

    def __init__(
        self,
        api_key: str,
        *,
        lookback_hours: int = 24,
        max_headlines: int = 5,
        timeout_sec: float = 10.0,
        max_retries: int = 3,
        scorer: Optional[NewsLlmScorer] = None,
    ) -> None:
        if not api_key:
            raise ValueError("FINNHUB_API_KEY is required for FinnhubNewsClient")
        self.api_key = api_key
        self.lookback_hours = lookback_hours
        self.max_headlines = max_headlines
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries
        self.scorer = scorer

    def fetch_news(self, symbol: str) -> FetchOutcome:
        now = datetime.now(timezone.utc)
        since_ts = (now - timedelta(hours=self.lookback_hours)).timestamp()
        # Widen API date window; filter articles to lookback_hours client-side.
        date_from = (now - timedelta(hours=self.lookback_hours + 24)).strftime("%Y-%m-%d")
        date_to = now.strftime("%Y-%m-%d")
        params = {
            "symbol": symbol,
            "from": date_from,
            "to": date_to,
            "token": self.api_key,
        }

        raw: object = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout_sec) as client:
                    response = client.get(FINNHUB_NEWS_URL, params=params)

                if response.status_code == 429:
                    retry_after = float(response.headers.get("retry-after", 60))
                    logger.warning(
                        "Finnhub rate limited for %s (attempt %s/%s), retry in %.1fs",
                        symbol,
                        attempt,
                        self.max_retries,
                        retry_after,
                    )
                    if attempt < self.max_retries:
                        time.sleep(retry_after)
                        continue
                    return FetchOutcome(
                        context=None,
                        status=FetchStatus.RATE_LIMITED,
                        retry_after_sec=retry_after,
                    )

                response.raise_for_status()
                raw = response.json()
                break

            except httpx.HTTPStatusError as exc:
                logger.warning(
                    "Finnhub news HTTP error for %s: %s",
                    symbol,
                    _http_status_message(exc),
                )
                if exc.response.status_code in {401, 403}:
                    return FetchOutcome(
                        context=None,
                        status=FetchStatus.ERROR,
                        retry_after_sec=300.0,
                    )
            except Exception as exc:
                logger.warning("Finnhub news request failed for %s: %s", symbol, exc)

            if attempt < self.max_retries:
                time.sleep(2 ** attempt)
        else:
            return FetchOutcome(
                context=None,
                status=FetchStatus.ERROR,
                retry_after_sec=60.0,
            )

        if not isinstance(raw, list):
            logger.warning("Unexpected Finnhub news response for %s", symbol)
            return FetchOutcome(
                context=None,
                status=FetchStatus.ERROR,
                retry_after_sec=60.0,
            )

        articles = _parse_articles(raw, self.max_headlines, since_ts=since_ts)
        if not articles:
            return FetchOutcome(
                context=None,
                status=FetchStatus.EMPTY,
                retry_after_sec=300.0,
            )

        fetched_at = now.isoformat()
        context = score_articles(articles, fetched_at=fetched_at)
        if self.scorer is not None:
            llm = self.scorer.score(symbol, articles)
            if llm is not None:
                sentiment, tags = merge_news_scores(
                    context.sentiment,
                    context.tags,
                    llm.sentiment,
                    llm.tags,
                )
                context = replace(
                    context,
                    sentiment=sentiment,
                    tags=tags,
                    materiality_note=llm.materiality_note,
                    still_relevant_for_open=llm.still_relevant_for_open,
                )
        return FetchOutcome(
            context=context,
            status=FetchStatus.OK,
        )

    def fetch_general_news(
        self,
        *,
        category: str = "general",
        max_items: int = 100,
    ) -> tuple[List[MarketNewsItem], FetchStatus]:
        params = {"category": category, "token": self.api_key}
        raw: object = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout_sec) as client:
                    response = client.get(FINNHUB_MARKET_NEWS_URL, params=params)

                if response.status_code == 429:
                    retry_after = float(response.headers.get("retry-after", 60))
                    logger.warning(
                        "Finnhub general news rate limited (attempt %s/%s), retry in %.1fs",
                        attempt,
                        self.max_retries,
                        retry_after,
                    )
                    if attempt < self.max_retries:
                        time.sleep(retry_after)
                        continue
                    return [], FetchStatus.RATE_LIMITED

                response.raise_for_status()
                raw = response.json()
                break
            except httpx.HTTPStatusError as exc:
                logger.warning(
                    "Finnhub general news HTTP error: %s",
                    _http_status_message(exc),
                )
                if exc.response.status_code in {401, 403}:
                    return [], FetchStatus.ERROR
            except Exception as exc:
                logger.warning("Finnhub general news request failed: %s", exc)

            if attempt < self.max_retries:
                time.sleep(2 ** attempt)
        else:
            return [], FetchStatus.ERROR

        if not isinstance(raw, list):
            logger.warning("Unexpected Finnhub general news response")
            return [], FetchStatus.ERROR

        articles = _parse_general_articles(raw, category=category, max_items=max_items)
        if not articles:
            return [], FetchStatus.EMPTY
        return articles, FetchStatus.OK


def _parse_articles(raw: list, max_headlines: int, *, since_ts: float) -> List[NewsArticle]:
    sorted_items = sorted(
        raw,
        key=lambda item: int(item.get("datetime", 0)),
        reverse=True,
    )
    articles: List[NewsArticle] = []
    for item in sorted_items:
        published_ts = int(item.get("datetime", 0))
        if published_ts < since_ts:
            continue
        headline = str(item.get("headline", "")).strip()
        if not headline:
            continue
        summary = str(item.get("summary", "")).strip()
        url = str(item.get("url", "")).strip()
        source = str(item.get("source", "")).strip()
        image = str(item.get("image", "")).strip()
        articles.append(
            NewsArticle(
                headline=headline,
                summary=summary,
                url=url,
                source=source,
                published_at=published_at_from_unix(published_ts),
                image=image,
            )
        )
        if len(articles) >= max_headlines:
            break
    return articles


class NewsService:
    """Cached news enrichment for watchlist symbols."""

    def __init__(
        self,
        client: FinnhubNewsClient,
        cache: TtlCache[NewsContext],
        *,
        skip_symbols: FrozenSet[str] = frozenset(),
        empty_cooldown_sec: float = 300.0,
        failure_cooldown_sec: float = 60.0,
        fetch_workers: int = 3,
        tape_store: MarketTapeStore | None = None,
    ) -> None:
        self.client = client
        self.cache = cache
        self.skip_symbols = skip_symbols
        self.empty_cooldown = CooldownTracker(empty_cooldown_sec, max_ttl_sec=empty_cooldown_sec)
        self.failure_cooldown = CooldownTracker(failure_cooldown_sec)
        self.fetch_workers = max(1, fetch_workers)
        self.tape_store = tape_store or MarketTapeStore()

    def get_market_tape(self) -> MarketTapeContext | None:
        return self.tape_store.get()

    def set_market_tape(self, context: MarketTapeContext) -> None:
        self.tape_store.set(context)

    def _should_fetch(self, symbol: str) -> bool:
        if symbol in self.skip_symbols:
            return False
        if not self.cache.is_stale(symbol):
            return False
        if self.empty_cooldown.is_active(symbol):
            return False
        if self.failure_cooldown.is_active(symbol):
            return False
        return True

    def _apply_outcome(self, symbol: str, outcome: FetchOutcome) -> None:
        if outcome.status == FetchStatus.OK and outcome.context is not None:
            self.cache.set(symbol, outcome.context)
            self.empty_cooldown.clear(symbol)
            self.failure_cooldown.clear(symbol)
            return

        if outcome.status == FetchStatus.EMPTY:
            self.empty_cooldown.record(symbol, retry_after_sec=outcome.retry_after_sec)
            return

        self.failure_cooldown.record(symbol, retry_after_sec=outcome.retry_after_sec)

    def _fetch_and_cache(self, symbol: str) -> None:
        outcome = self.client.fetch_news(symbol)
        self._apply_outcome(symbol, outcome)

    def refresh_stale(self, symbols: list[str]) -> None:
        to_fetch = [symbol for symbol in symbols if self._should_fetch(symbol)]
        if not to_fetch:
            return

        if len(to_fetch) == 1 or self.fetch_workers == 1:
            for symbol in to_fetch:
                self._fetch_and_cache(symbol)
            return

        with ThreadPoolExecutor(max_workers=min(self.fetch_workers, len(to_fetch))) as pool:
            futures = [pool.submit(self._fetch_and_cache, symbol) for symbol in to_fetch]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as exc:
                    logger.warning("News prefetch task failed: %s", exc)

    def get_context(self, symbol: str) -> Optional[NewsContext]:
        if symbol in self.skip_symbols:
            return None

        cached = self.cache.get(symbol)
        if cached is not None:
            return cached

        if self.empty_cooldown.is_active(symbol) or self.failure_cooldown.is_active(symbol):
            return None

        outcome = self.client.fetch_news(symbol)
        self._apply_outcome(symbol, outcome)
        return outcome.context
