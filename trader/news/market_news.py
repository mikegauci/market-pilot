from __future__ import annotations

from typing import List


def dedupe_market_news_rows(rows: List[dict]) -> List[dict]:
    """Keep first occurrence per id and per non-empty url (caller should pass newest-first)."""
    seen_ids: set[int] = set()
    seen_urls: set[str] = set()
    deduped: List[dict] = []
    for row in rows:
        row_id = row.get("id")
        if row_id is None or row_id in seen_ids:
            continue
        url = str(row.get("url") or "").strip()
        if url and url in seen_urls:
            continue
        seen_ids.add(int(row_id))
        if url:
            seen_urls.add(url)
        deduped.append(row)
    return deduped
