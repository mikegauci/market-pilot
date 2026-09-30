from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set


NewsStatus = str  # "missing" | "neutral" | "active"


@dataclass(frozen=True)
class NewsArticle:
    headline: str
    summary: str = ""
    url: str = ""
    source: str = ""
    published_at: Optional[str] = None
    image: str = ""
    fetched_at: Optional[str] = None
    sentiment: float = 0.0
    tags: tuple[str, ...] = ()
    relevance: float = 0.9
    event_type: str = "other"
    severity: float = 0.0
    novelty: float = 1.0
    fingerprint: str = ""

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["tags"] = list(self.tags)
        for key in ("summary", "url", "source", "image"):
            if not payload.get(key):
                payload[key] = None
        return payload


@dataclass(frozen=True)
class NewsContext:
    sentiment: float
    headline_count: int
    top_headline: str
    tags: List[str]
    fetched_at: str
    articles: List[NewsArticle]
    status: NewsStatus = "neutral"


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

_EVENT_TYPE_RULES: Sequence[tuple[re.Pattern[str], str]] = (
    (re.compile(r"\bearnings\b", re.I), "earnings"),
    (re.compile(r"\bguidance\b", re.I), "guidance"),
    (re.compile(r"\bdowngrade|\bupgrade\b", re.I), "rating"),
    (re.compile(r"\blawsuit|\bsec investigation\b", re.I), "lawsuit"),
    (re.compile(r"\bmerger\b|\bacquisition\b", re.I), "mna"),
)

_EVENT_RULES: Sequence[tuple[re.Pattern[str], str]] = (
    (re.compile(r"\bearnings\b", re.I), "earnings"),
    (re.compile(r"\bmerger\b", re.I), "merger"),
    (re.compile(r"\bacquisition\b", re.I), "merger"),
)


def _article_text(article: NewsArticle) -> str:
    return f"{article.headline} {article.summary}".strip()


def published_at_from_unix(ts: int) -> Optional[str]:
    if ts <= 0:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def headline_fingerprint(headline: str) -> str:
    normalized = re.sub(r"\s+", " ", (headline or "").strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]


def infer_event_type(text: str, tags: Iterable[str]) -> str:
    tag_set = {t.lower() for t in tags}
    if "earnings" in tag_set or "earnings_miss" in tag_set or "earnings_beat" in tag_set:
        return "earnings"
    if "guidance_cut" in tag_set or "guidance_raise" in tag_set:
        return "guidance"
    if "downgrade" in tag_set or "upgrade" in tag_set:
        return "rating"
    if "lawsuit" in tag_set or "sec_investigation" in tag_set:
        return "lawsuit"
    if "merger" in tag_set:
        return "mna"
    for pattern, event in _EVENT_TYPE_RULES:
        if pattern.search(text):
            return event
    return "other"


def score_single_article(article: NewsArticle) -> tuple[float, List[str]]:
    """Rule-based sentiment/tags for one article (used for general market news)."""
    text = _article_text(article)
    score = 0.0
    tags: set[str] = set()
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
    return round(sentiment, 3), sorted(tags)


def enrich_article_structure(
    article: NewsArticle,
    *,
    fetched_at: str,
    seen_fingerprints: Optional[Set[str]] = None,
    company_symbol: str = "",
    company_name: str = "",
) -> NewsArticle:
    """Attach sentiment, tags, relevance, event_type, severity, novelty, fingerprint."""
    sentiment, tags = score_single_article(article)
    text = _article_text(article)
    severity = min(1.0, abs(sentiment) + (0.15 if tags else 0.0))
    fingerprint = article.fingerprint or headline_fingerprint(article.headline)
    novelty = 1.0
    if seen_fingerprints is not None:
        if fingerprint in seen_fingerprints:
            novelty = 0.25
        else:
            seen_fingerprints.add(fingerprint)
    relevance = 0.9
    sym = (company_symbol or "").upper()
    if sym and sym in text.upper():
        relevance = min(1.0, relevance + 0.05)
    name_token = (company_name or "").split(" ")[0].strip().upper()
    if name_token and len(name_token) > 2 and name_token in text.upper():
        relevance = min(1.0, relevance + 0.05)
    return replace(
        article,
        fetched_at=article.fetched_at or fetched_at,
        sentiment=sentiment,
        tags=tuple(tags),
        relevance=round(relevance, 3),
        event_type=infer_event_type(text, tags),
        severity=round(severity, 3),
        novelty=novelty,
        fingerprint=fingerprint,
    )


def dedupe_articles_by_fingerprint(
    articles: Sequence[NewsArticle],
) -> List[NewsArticle]:
    """Keep newest article per fingerprint (input assumed newest-first)."""
    seen: set[str] = set()
    out: List[NewsArticle] = []
    for article in articles:
        fp = article.fingerprint or headline_fingerprint(article.headline)
        if fp in seen:
            continue
        seen.add(fp)
        if not article.fingerprint:
            article = replace(article, fingerprint=fp)
        out.append(article)
    return out


def recompute_context_from_articles(
    articles: Sequence[NewsArticle] | Sequence[dict],
    *,
    fetched_at: str,
    max_headline_len: int = 200,
    status: Optional[NewsStatus] = None,
) -> NewsContext:
    """Rebuild aggregate sentiment/tags/top headline from remaining articles."""
    structured: List[NewsArticle] = []
    for item in articles:
        if isinstance(item, NewsArticle):
            structured.append(item)
            continue
        if not isinstance(item, dict):
            continue
        structured.append(
            NewsArticle(
                headline=str(item.get("headline") or ""),
                summary=str(item.get("summary") or "") or "",
                url=str(item.get("url") or "") or "",
                source=str(item.get("source") or "") or "",
                published_at=item.get("published_at"),
                image=str(item.get("image") or "") or "",
                fetched_at=item.get("fetched_at") or fetched_at,
                sentiment=float(item.get("sentiment") or 0.0),
                tags=tuple(item.get("tags") or ()),
                relevance=float(item.get("relevance") or 0.9),
                event_type=str(item.get("event_type") or "other"),
                severity=float(item.get("severity") or 0.0),
                novelty=float(item.get("novelty") or 1.0),
                fingerprint=str(item.get("fingerprint") or ""),
            )
        )

    if not structured:
        return NewsContext(
            sentiment=0.0,
            headline_count=0,
            top_headline="",
            tags=[],
            fetched_at=fetched_at,
            articles=[],
            status=status or "neutral",
        )

    score = sum(a.sentiment for a in structured)
    tags: set[str] = set()
    for article in structured:
        tags.update(article.tags)
    sentiment = max(-1.0, min(1.0, score))
    top = structured[0].headline if structured else ""
    if len(top) > max_headline_len:
        top = top[: max_headline_len - 3] + "..."
    return NewsContext(
        sentiment=round(sentiment, 3),
        headline_count=len(structured),
        top_headline=top,
        tags=sorted(tags),
        fetched_at=fetched_at,
        articles=list(structured),
        status=status or "active",
    )


def score_articles(
    articles: Iterable[NewsArticle],
    *,
    fetched_at: str,
    max_headline_len: int = 200,
    status: NewsStatus = "active",
    seen_fingerprints: Optional[Set[str]] = None,
    company_symbol: str = "",
    company_name: str = "",
) -> NewsContext:
    """Score, structure, and dedupe company headlines into a NewsContext."""
    if status == "missing":
        return NewsContext(
            sentiment=0.0,
            headline_count=0,
            top_headline="",
            tags=[],
            fetched_at=fetched_at,
            articles=[],
            status="missing",
        )

    raw_list = list(articles)
    if not raw_list:
        return NewsContext(
            sentiment=0.0,
            headline_count=0,
            top_headline="",
            tags=[],
            fetched_at=fetched_at,
            articles=[],
            status="neutral" if status != "missing" else "missing",
        )

    # Newest-first dedupe before structural scoring.
    deduped = dedupe_articles_by_fingerprint(raw_list)
    structured = [
        enrich_article_structure(
            article,
            fetched_at=fetched_at,
            seen_fingerprints=seen_fingerprints,
            company_symbol=company_symbol,
            company_name=company_name,
        )
        for article in deduped
    ]
    # Drop very low-relevance noise if present.
    relevant = [a for a in structured if a.relevance >= 0.5]
    if not relevant:
        return NewsContext(
            sentiment=0.0,
            headline_count=0,
            top_headline="",
            tags=[],
            fetched_at=fetched_at,
            articles=[],
            status="neutral",
        )
    return recompute_context_from_articles(
        relevant,
        fetched_at=fetched_at,
        max_headline_len=max_headline_len,
        status="active",
    )


def missing_news_context(*, fetched_at: Optional[str] = None) -> NewsContext:
    ts = fetched_at or datetime.now(timezone.utc).isoformat()
    return NewsContext(
        sentiment=0.0,
        headline_count=0,
        top_headline="",
        tags=[],
        fetched_at=ts,
        articles=[],
        status="missing",
    )
