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
    _parse_general_articles,
    parse_related_symbols,
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
        article = NewsArticle(
            headline="Company faces lawsuit",
            summary="Investors react to filing",
            url="https://example.com/lawsuit",
            source="Reuters",
            published_at="2026-01-01T11:00:00+00:00",
        )
        context = NewsContext(
            sentiment=-0.35,
            headline_count=1,
            top_headline="Company faces lawsuit",
            tags=["lawsuit"],
            fetched_at="2026-01-01T12:00:00+00:00",
            articles=[article],
        )
        enriched = apply_news_context(_state(), context)
        self.assertEqual(enriched.news_sentiment, -0.35)
        self.assertEqual(enriched.news_tags, ["lawsuit"])
        self.assertIsNotNone(enriched.news_articles)
        assert enriched.news_articles is not None
        self.assertEqual(enriched.news_articles[0]["url"], "https://example.com/lawsuit")
        self.assertEqual(enriched.news_articles[0]["source"], "Reuters")
        self.assertEqual(
            enriched.news_articles[0]["published_at"],
            "2026-01-01T11:00:00+00:00",
        )
        self.assertEqual(enriched.news_status, "active")

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
        articles = _parse_articles(
            raw,
            max_headlines=5,
            since_ts=now_ts - 3600,
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0].headline, "Fresh headline")

    def test_keeps_url_summary_source_and_published_at(self) -> None:
        now_ts = int(datetime.now(timezone.utc).timestamp())
        raw = [
            {
                "datetime": now_ts - 30,
                "headline": "NVDA upgrades outlook",
                "summary": "Chipmaker raises guidance.",
                "url": "https://example.com/nvda",
                "source": "Bloomberg",
                "image": "https://example.com/nvda.jpg",
            }
        ]
        articles = _parse_articles(
            raw,
            max_headlines=5,
            since_ts=now_ts - 3600,
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
        self.assertEqual(len(articles), 1)
        article = articles[0]
        self.assertEqual(article.url, "https://example.com/nvda")
        self.assertEqual(article.summary, "Chipmaker raises guidance.")
        self.assertEqual(article.source, "Bloomberg")
        self.assertEqual(article.image, "https://example.com/nvda.jpg")
        self.assertIsNotNone(article.published_at)
        assert article.published_at is not None
        self.assertTrue(article.published_at.endswith("+00:00"))


class TestParseGeneralArticles(unittest.TestCase):
    def test_parses_general_market_news_payload(self) -> None:
        now_ts = int(datetime.now(timezone.utc).timestamp())
        raw = [
            {
                "id": 42,
                "datetime": now_ts - 120,
                "headline": "Markets rally on jobs data",
                "summary": "Stocks climb after payrolls.",
                "url": "https://example.com/rally",
                "source": "Reuters",
                "image": "",
                "related": "SPY,QQQ",
                "category": "general",
            }
        ]
        articles = _parse_general_articles(raw, category="general")
        self.assertEqual(len(articles), 1)
        article = articles[0]
        self.assertEqual(article.id, 42)
        self.assertEqual(article.source, "Reuters")
        self.assertEqual(article.url, "https://example.com/rally")
        self.assertEqual(article.related_symbols, ["SPY", "QQQ"])
        self.assertIsNotNone(article.published_at)

    def test_parse_related_symbols(self) -> None:
        self.assertEqual(parse_related_symbols("AAPL, msft;NVDA"), ["AAPL", "MSFT", "NVDA"])
        self.assertEqual(parse_related_symbols(""), [])


class TestDedupeMarketNewsRows(unittest.TestCase):
    def test_dedupes_by_id_and_url_keeping_first(self) -> None:
        from news.market_news import dedupe_market_news_rows

        rows = [
            {"id": 1, "url": "https://example.com/a", "headline": "First"},
            {"id": 2, "url": "https://example.com/a", "headline": "Dup url"},
            {"id": 1, "url": "https://example.com/b", "headline": "Dup id"},
            {"id": 3, "url": "", "headline": "No url"},
            {"id": 4, "url": None, "headline": "Null url"},
        ]
        deduped = dedupe_market_news_rows(rows)
        self.assertEqual([row["id"] for row in deduped], [1, 3, 4])
        self.assertEqual(deduped[0]["headline"], "First")


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
        self.assertIsNotNone(outcome.context)
        assert outcome.context is not None
        self.assertEqual(outcome.context.status, "neutral")
        self.assertEqual(outcome.context.headline_count, 0)

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
        skipped = service.get_context("SPY")
        self.assertIsNotNone(skipped)
        assert skipped is not None
        self.assertEqual(skipped.status, "missing")
        client.fetch_news.assert_not_called()

    def test_caches_successful_fetch(self) -> None:
        service, client = self._service()
        context = NewsContext(
            sentiment=0.2,
            headline_count=1,
            top_headline="NVDA beats estimates",
            tags=["earnings_beat"],
            fetched_at="2026-01-01T12:00:00+00:00",
            status="active",
            articles=[
                NewsArticle(
                    headline="NVDA beats estimates",
                    url="https://example.com/beat",
                )
            ],
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

    def test_empty_result_caches_neutral_and_applies_cooldown(self) -> None:
        service, client = self._service()
        empty_ctx = NewsContext(
            sentiment=0.0,
            headline_count=0,
            top_headline="",
            tags=[],
            fetched_at="2026-01-01T12:00:00+00:00",
            articles=[],
            status="neutral",
        )
        client.fetch_news.return_value = FetchOutcome(
            context=empty_ctx,
            status=FetchStatus.EMPTY,
            retry_after_sec=60.0,
        )

        first = service.get_context("NVDA")
        second = service.get_context("NVDA")
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.status, "neutral")
        self.assertEqual(second, first)
        client.fetch_news.assert_called_once()

    def test_failure_applies_backoff(self) -> None:
        service, client = self._service()
        client.fetch_news.return_value = FetchOutcome(
            context=None,
            status=FetchStatus.ERROR,
            retry_after_sec=60.0,
        )

        first = service.get_context("NVDA")
        second = service.get_context("NVDA")
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.status, "missing")
        self.assertEqual(second.status, "missing")
        client.fetch_news.assert_called_once()


class TestNewsSettings(unittest.TestCase):
    def test_news_disabled_without_api_key(self) -> None:
        from config import Settings

        settings = Settings(news_enabled=True, finnhub_api_key="")
        self.assertFalse(settings.news_enabled)


if __name__ == "__main__":
    unittest.main()
