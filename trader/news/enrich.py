from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Optional

from models.types import MarketState
from news.sentiment import NewsContext

if TYPE_CHECKING:
    from news.client import NewsService


def apply_news_context(state: MarketState, context: NewsContext) -> MarketState:
    articles = [article.to_dict() for article in context.articles] or None
    return replace(
        state,
        news_sentiment=context.sentiment,
        news_headline_count=context.headline_count,
        news_top_headline=context.top_headline or None,
        news_tags=context.tags or None,
        news_fetched_at=context.fetched_at,
        news_articles=articles,
    )


def enrich_market_state_with_news(
    state: MarketState,
    news_service: Optional[NewsService],
) -> MarketState:
    if news_service is None:
        return state
    context = news_service.get_context(state.symbol)
    if context is None:
        return state
    return apply_news_context(state, context)
