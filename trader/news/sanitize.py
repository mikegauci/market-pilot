"""Sanitize untrusted news text before it reaches Jev prompts."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_INJECTION_LINE_RE = re.compile(
    r"^\s*(ignore\s+(all\s+)?previous|disregard\s+(all\s+)?prior|"
    r"system\s*:|assistant\s*:|new\s+instructions\s*:|"
    r"you\s+are\s+now|override\s+(the\s+)?rules)",
    re.IGNORECASE,
)


def sanitize_news_text(text: str, *, max_len: int = 240) -> str:
    """Strip controls, neutralize instruction-like prefixes, truncate."""
    if not text:
        return ""
    cleaned = _CONTROL_RE.sub(" ", text)
    cleaned = cleaned.replace("\r", " ").replace("\n", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if _INJECTION_LINE_RE.search(cleaned):
        cleaned = "[redacted-instruction-like-headline]"
    if len(cleaned) > max_len:
        cleaned = cleaned[: max_len - 3] + "..."
    return cleaned


def sanitize_article_dict(article: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(article)
    out["headline"] = sanitize_news_text(str(out.get("headline") or ""), max_len=200)
    if out.get("summary"):
        out["summary"] = sanitize_news_text(str(out["summary"]), max_len=280)
    return out


def sanitize_market_state_news(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy of market-state dict with news text sanitized for Jev."""
    out = dict(payload)
    if out.get("news_top_headline"):
        out["news_top_headline"] = sanitize_news_text(
            str(out["news_top_headline"]), max_len=200
        )
    articles = out.get("news_articles")
    if isinstance(articles, list):
        sanitized: List[Dict[str, Any]] = []
        for item in articles[:8]:
            if isinstance(item, dict):
                sanitized.append(sanitize_article_dict(item))
        out["news_articles"] = sanitized or None
    # Explicit status for missing vs neutral (do not invent bullish/neutral opinion).
    status = out.get("news_status")
    if status not in {"missing", "neutral", "active"}:
        if out.get("news_articles"):
            out["news_status"] = "active"
        elif out.get("news_fetched_at"):
            out["news_status"] = "neutral"
        else:
            out["news_status"] = "missing"
    return out
