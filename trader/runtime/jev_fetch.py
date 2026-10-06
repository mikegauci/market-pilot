from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Tuple

from jev.client import JevClient
from models.types import JevPrediction, MarketState

logger = logging.getLogger(__name__)


def fetch_jev_predictions(
    jev: JevClient,
    ready_states: List[Tuple[str, MarketState]],
    max_workers: int,
) -> Dict[str, JevPrediction]:
    """Call Jev in parallel so one slow symbol does not block the watchlist."""
    if not ready_states:
        return {}

    workers = min(max_workers, len(ready_states))
    predictions: Dict[str, JevPrediction] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(jev.predict, state): symbol for symbol, state in ready_states
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                predictions[symbol] = future.result()
            except Exception as exc:
                logger.error("Jev prediction failed for %s: %s", symbol, exc)
    return predictions
