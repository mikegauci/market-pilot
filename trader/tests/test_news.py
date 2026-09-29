from __future__ import annotations

import time
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from models.types import MarketState
from news.cache import CooldownTracker, TtlCache
from news.client import (
    FetchOutcome,
    FetchStatus,
    FinnhubNewsClient,
    NewsService,
    _http_status_message,
    _parse_articles,
)
from news.enrich import apply_news_context, enrich_market_state_with_news
from news.sentiment import NewsArticle, NewsContext, score_articles
from strategy.config import StrategyConfig
from strategy.filters import check_entry_filters


def _state(**overrides: object) -> MarketState:
    base = dict(
        symbol="NVDA",
        price=100.0,
        change_5m=0.2,
        change_15m=0.3,
        volume_ratio=1.2,
        rsi=55.0,
        ema_9=99.5,
        ema_20=98.0,
        bid=99.98,
        ask=100.02,
        spread=0.04,
        spy_change_5m=0.1,
    )
    base.update(overrides)
    return MarketState(**base)  # type: ignore[arg-type]


class TestNewsSentiment(unittest.TestCase):
    def test_scores_negative_headline(self) -> None:
        context = score_articles(
            [NewsArticle(headline="Analyst downgrade hits NVDA shares")],
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
        self.assertLess(context.sentiment, 0)
        self.assertIn("downgrade", context.tags)

    def test_scores_positive_headline(self) -> None:
        context = score_articles(
            [NewsArticle(headline="NVDA beats estimates and raises guidance")],
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
        self.assertGreater(context.sentiment, 0)
        self.assertIn("earnings_beat", context.tags)


class TestNewsEnrich(unittest.TestCase):
    def test_apply_news_context(self) -> None:
        context = NewsContext(
            sentiment=-0.35,
            headline_count=2,
            top_headline="Company faces lawsuit",
            tags=["lawsuit"],
            fetched_at="2026-01-01T12:00:00+00:00",
        )
        enriched = apply_news_context(_state(), context)
        self.assertEqual(enriched.news_sentiment, -0.35)
        self.assertEqual(enriched.news_tags, ["lawsuit"])

    def test_enrich_without_service_returns_unchanged(self) -> None:
        state = _state()
        self.assertIs(enrich_market_state_with_news(state, None), state)


class TestNewsFilters(unittest.TestCase):
    def test_rejects_bearish_sentiment(self) -> None:
        result = check_entry_filters(
            _state(news_sentiment=-0.5),
            StrategyConfig(),
        )
        self.assertFalse(result.passed)
        self.assertIn("news_sentiment_bearish", result.reason)

    def test_rejects_at_sentiment_threshold(self) -> None:
        result = check_entry_filters(
            _state(news_sentiment=-0.3),
            StrategyConfig(),
        )
        self.assertFalse(result.passed)

    def test_rejects_block_tag(self) -> None:
        result = check_entry_filters(
            _state(news_tags=["downgrade"]),
            StrategyConfig(),
        )
        self.assertFalse(result.passed)
        self.assertIn("news_block_tag", result.reason)

    def test_rejects_layoffs_tag(self) -> None:
        result = check_entry_filters(
            _state(news_tags=["layoffs"]),
            StrategyConfig(),
        )
        self.assertFalse(result.passed)

    def test_block_on_earnings(self) -> None:
        result = check_entry_filters(
            _state(news_tags=["earnings"]),
            StrategyConfig(block_on_earnings=True),
        )
        self.assertFalse(result.passed)
        self.assertIn("news_earnings_window", result.reason)

    def test_missing_news_is_neutral(self) -> None:
        result = check_entry_filters(_state(), StrategyConfig())
        self.assertTrue(result.passed)


class TestNewsCache(unittest.TestCase):
    def test_ttl_expiry(self) -> None:
        cache: TtlCache[str] = TtlCache(ttl_sec=0.01)
        cache.set("NVDA", "ok")
        self.assertEqual(cache.get("NVDA"), "ok")
        time.sleep(0.02)
        self.assertIsNone(cache.get("NVDA"))

    def test_cooldown_backoff(self) -> None:
        tracker = CooldownTracker(base_ttl_sec=0.05, max_ttl_sec=0.2)
        tracker.record("NVDA")
        self.assertTrue(tracker.is_active("NVDA"))
        time.sleep(0.06)
        self.assertFalse(tracker.is_active("NVDA"))


class TestParseArticles(unittest.TestCase):
    def test_filters_by_since_timestamp(self) -> None:
        now_ts = int(datetime.now(timezone.utc).timestamp())
        raw = [
            {"datetime": now_ts - 7200, "headline": "Old headline", "summary": ""},
            {"datetime": now_ts - 60, "headline": "Fresh headline", "summary": ""},
        ]
        articles = _parse_articles(raw, max_headlines=5, since_ts=now_ts - 3600)
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0].headline, "Fresh headline")


class TestFinnhubClient(unittest.TestCase):
    def test_empty_response_is_empty_status(self) -> None:
        client = FinnhubNewsClient("test-key", max_retries=1)
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []
        mock_response.raise_for_status = MagicMock()

        with patch("news.client.httpx.Client") as mock_client_cls:
            mock_client_cls.return_value.__enter__.return_value.get.return_value = mock_response
            outcome = client.fetch_news("NVDA")

        self.assertEqual(outcome.status, FetchStatus.EMPTY)
        self.assertIsNone(outcome.context)

    def test_http_error_message_omits_request_url(self) -> None:
        exc = MagicMock()
        exc.response.status_code = 401
        self.assertEqual(_http_status_message(exc), "HTTP 401")

    def test_rate_limit_retries_then_returns_rate_limited(self) -> None:
        client = FinnhubNewsClient("test-key", max_retries=2)
        rate_response = MagicMock()
        rate_response.status_code = 429
        rate_response.headers = {"retry-after": "0"}

        with patch("news.client.httpx.Client") as mock_client_cls, patch(
            "news.client.time.sleep"
        ):
            mock_client_cls.return_value.__enter__.return_value.get.return_value = rate_response
            outcome = client.fetch_news("NVDA")

        self.assertEqual(outcome.status, FetchStatus.RATE_LIMITED)


class TestNewsService(unittest.TestCase):
    def _service(self) -> tuple[NewsService, MagicMock]:
        client = MagicMock(spec=FinnhubNewsClient)
        service = NewsService(
            client,
            TtlCache(ttl_sec=600),
            skip_symbols=frozenset({"SPY"}),
            empty_cooldown_sec=60.0,
            failure_cooldown_sec=30.0,
            fetch_workers=1,
        )
        return service, client

    def test_skips_etf_symbols(self) -> None:
        service, client = self._service()
        self.assertIsNone(service.get_context("SPY"))
        client.fetch_news.assert_not_called()

    def test_caches_successful_fetch(self) -> None:
        service, client = self._service()
        context = NewsContext(
            sentiment=0.2,
            headline_count=1,
            top_headline="NVDA beats estimates",
            tags=["earnings_beat"],
            fetched_at="2026-01-01T12:00:00+00:00",
        )
        client.fetch_news.return_value = FetchOutcome(
            context=context,
            status=FetchStatus.OK,
        )

        first = service.get_context("NVDA")
        second = service.get_context("NVDA")

        self.assertEqual(first, context)
        self.assertEqual(second, context)
        client.fetch_news.assert_called_once()

    def test_empty_result_applies_cooldown_without_caching_context(self) -> None:
        service, client = self._service()
        client.fetch_news.return_value = FetchOutcome(
            context=None,
            status=FetchStatus.EMPTY,
            retry_after_sec=60.0,
        )

        self.assertIsNone(service.get_context("NVDA"))
        self.assertIsNone(service.get_context("NVDA"))
        client.fetch_news.assert_called_once()

    def test_failure_applies_backoff(self) -> None:
        service, client = self._service()
        client.fetch_news.return_value = FetchOutcome(
            context=None,
            status=FetchStatus.ERROR,
            retry_after_sec=60.0,
        )

        self.assertIsNone(service.get_context("NVDA"))
        self.assertIsNone(service.get_context("NVDA"))
        client.fetch_news.assert_called_once()


class TestNewsSettings(unittest.TestCase):
    def test_news_disabled_without_api_key(self) -> None:
        from config import Settings

        settings = Settings(news_enabled=True, finnhub_api_key="")
        self.assertFalse(settings.news_enabled)


if __name__ == "__main__":
    unittest.main()
