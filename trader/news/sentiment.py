from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Sequence


@dataclass(frozen=True)
class NewsArticle:
    headline: str
    summary: str = ""


@dataclass(frozen=True)
class NewsContext:
    sentiment: float
    headline_count: int
    top_headline: str
    tags: List[str]
    fetched_at: str


_NEGATIVE_RULES: Sequence[tuple[re.Pattern[str], str, float]] = (
    (re.compile(r"\bdowngrade[ds]?\b", re.I), "downgrade", -0.35),
    (re.compile(r"\blawsuit\b", re.I), "lawsuit", -0.4),
    (re.compile(r"\bsec investigation\b", re.I), "sec_investigation", -0.4),
    (re.compile(r"\bmiss(es|ed)? estimates\b", re.I), "earnings_miss", -0.35),
    (re.compile(r"\bguidance cut\b", re.I), "guidance_cut", -0.35),
    (re.compile(r"\brecall\b", re.I), "recall", -0.3),
    (re.compile(r"\bbankruptcy\b", re.I), "bankruptcy", -0.5),
    (re.compile(r"\blayoffs?\b", re.I), "layoffs", -0.25),
)

_POSITIVE_RULES: Sequence[tuple[re.Pattern[str], str, float]] = (
    (re.compile(r"\bbeat(s|ing)? estimates\b", re.I), "earnings_beat", 0.35),
    (re.compile(r"\bupgrade[ds]?\b", re.I), "upgrade", 0.3),
    (re.compile(r"\braises? guidance\b", re.I), "guidance_raise", 0.3),
    (re.compile(r"\bfda approval\b", re.I), "fda_approval", 0.35),
)

_EVENT_RULES: Sequence[tuple[re.Pattern[str], str]] = (
    (re.compile(r"\bearnings\b", re.I), "earnings"),
    (re.compile(r"\bmerger\b", re.I), "merger"),
    (re.compile(r"\bacquisition\b", re.I), "merger"),
)


def _article_text(article: NewsArticle) -> str:
    return f"{article.headline} {article.summary}".strip()


def score_articles(
    articles: Iterable[NewsArticle],
    *,
    fetched_at: str,
    max_headline_len: int = 200,
) -> NewsContext:
    article_list = list(articles)
    score = 0.0
    tags: set[str] = set()

    for article in article_list:
        text = _article_text(article)
        for pattern, tag, delta in _NEGATIVE_RULES:
            if pattern.search(text):
                tags.add(tag)
                score += delta
        for pattern, tag, delta in _POSITIVE_RULES:
            if pattern.search(text):
                tags.add(tag)
                score += delta
        for pattern, tag in _EVENT_RULES:
            if pattern.search(text):
                tags.add(tag)

    sentiment = max(-1.0, min(1.0, score))
    top = article_list[0].headline if article_list else ""
    if len(top) > max_headline_len:
        top = top[: max_headline_len - 3] + "..."

    return NewsContext(
        sentiment=round(sentiment, 3),
        headline_count=len(article_list),
        top_headline=top,
        tags=sorted(tags),
        fetched_at=fetched_at,
    )
