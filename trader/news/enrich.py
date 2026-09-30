from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Optional

from models.types import MarketState
from news.sentiment import NewsContext, missing_news_context

if TYPE_CHECKING:
    from news.client import NewsService


def apply_news_context(state: MarketState, context: NewsContext) -> MarketState:
    articles = [article.to_dict() for article in context.articles] or None
    status = context.status
    # Articles imply active even if caller omitted status (defaults to neutral).
    if context.headline_count > 0 and status != "missing":
        status = "active"
    if status == "missing":
        sentiment = None
    elif status == "neutral":
        sentiment = 0.0
    else:
        sentiment = context.sentiment
    return replace(
        state,
        news_sentiment=sentiment,
        news_headline_count=context.headline_count,
        news_top_headline=context.top_headline or None,
        news_tags=context.tags or None,
        news_fetched_at=context.fetched_at,
        news_articles=articles,
        news_status=status,
    )


def enrich_market_state_with_news(
    state: MarketState,
    news_service: Optional[NewsService],
) -> MarketState:
    if news_service is None:
        return state
    context = news_service.get_context(state.symbol)
    if context is None:
        return apply_news_context(state, missing_news_context())
    return apply_news_context(state, context)
