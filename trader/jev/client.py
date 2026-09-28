from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from models.types import JevPrediction, MarketState

logger = logging.getLogger(__name__)

JEV_API_URL = "https://api.typesafe.ai/v1/systemone"

ACTION_QUESTION = {
    "type": "choice",
    "instructions": (
        "Evaluate the short-term day-trading direction for this US equity "
        "from the supplied market state. Return calibrated buy, hold, or sell "
        "probabilities for the next few minutes of intraday movement. "
        "Prefer BUY only when momentum, volume, and trend alignment (price vs EMAs, "
        "RSI not overbought) support a long entry. Penalize BUY when the stock is "
        "extended, spread is wide, or broad market (SPY) is weak."
    ),
    "criteria": {
        "buy": (
            "Clear intraday edge: bullish momentum, supportive volume, price above "
            "key EMAs, RSI not overbought, and no broad-market headwind."
        ),
        "hold": "No clear edge; waiting is preferable to acting.",
        "sell": (
            "Indicators favor exiting or avoiding a long position now — weakening "
            "momentum, overbought RSI, or price breaking below short-term support."
        ),
    },
}


class JevClient:
    """TypeSafe Jev API client for buy/hold/sell predictions."""

    def __init__(
        self,
        api_key: str,
        model: str = "jev-latest",
        timeout_sec: float = 10.0,
        max_retries: int = 3,
    ) -> None:
        if not api_key:
            raise ValueError("TYPESAFE_AI_API_KEY is required for JevClient")
        self.api_key = api_key
        self.model = model
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries

    def predict(self, state: MarketState) -> JevPrediction:
        payload = {
            "model": self.model,
            "state": state.to_dict(),
            "questions": {"action": ACTION_QUESTION},
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        last_error: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout_sec) as client:
                    response = client.post(JEV_API_URL, json=payload, headers=headers)

                if response.status_code in {429, 529}:
                    retry_after = float(response.headers.get("retry-after", 2 ** attempt))
                    logger.warning(
                        "Jev rate limited (HTTP %s), retry in %.1fs (attempt %s/%s)",
                        response.status_code,
                        retry_after,
                        attempt,
                        self.max_retries,
                    )
                    time.sleep(retry_after)
                    continue

                response.raise_for_status()
                data = response.json()
                return self._parse_response(state.symbol, data)

            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code in {401, 422}:
                    raise
                logger.warning("Jev HTTP error on attempt %s: %s", attempt, exc)
            except Exception as exc:
                last_error = exc
                logger.warning("Jev request failed on attempt %s: %s", attempt, exc)

            if attempt < self.max_retries:
                time.sleep(2 ** attempt)

        raise RuntimeError(f"Jev prediction failed after {self.max_retries} attempts") from last_error

    def _parse_response(self, symbol: str, data: dict) -> JevPrediction:
        answers = data.get("answers", {})
        action = answers.get("action", {})
        probabilities = action.get("probabilities", {})

        buy = float(probabilities.get("buy", 0))
        hold = float(probabilities.get("hold", 0))
        sell = float(probabilities.get("sell", 0))

        return JevPrediction(
            symbol=symbol,
            buy=buy,
            hold=hold,
            sell=sell,
            timestamp=datetime.now(timezone.utc),
            model=data.get("model", self.model),
        )
