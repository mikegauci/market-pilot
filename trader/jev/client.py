from __future__ import annotations

import logging
import statistics
import time
from datetime import datetime, timezone
from typing import List, Optional

import httpx

from models.types import JevPrediction, MarketState

logger = logging.getLogger(__name__)

JEV_API_URL = "https://api.typesafe.ai/v1/systemone"

TRADE_ACTION_QUESTION = {
    "type": "choice",
    "instructions": (
        "Evaluate the short-term day-trading direction for this US equity "
        "from the supplied market state. Return calibrated buy, hold, or sell "
        "probabilities for the next 15 minutes of intraday movement. "
        "Prefer BUY only when momentum, volume, and trend alignment (price vs EMA-9/20 "
        "on 1-minute bars, RSI-14 on 1-minute bars not overbought) support a long "
        "entry. Penalize BUY when the stock is extended, spread is wide, or the broad "
        "benchmark (benchmark_change_5m on 1-minute bars) is weak. When change_1d, "
        "change_5d, or change_1w are present, use them as secondary daily context only. "
        "When news_sentiment, news_tags, or news_top_headline are present, fold "
        "headline context into the decision: penalize BUY on bearish sentiment "
        "(news_sentiment below zero) or tags such as downgrade, lawsuit, "
        "sec_investigation, guidance_cut, or earnings_miss; favor caution (hold/sell) "
        "on high-impact negative tags. Treat missing news fields as neutral."
    ),
    "criteria": {
        "buy": (
            "Clear intraday edge: bullish momentum, supportive volume, price above "
            "key EMAs, RSI not overbought, no broad-market headwind, and no bearish "
            "news sentiment or blocking news tags."
        ),
        "hold": (
            "No clear edge; waiting is preferable to acting — including when news "
            "is ambiguous or mildly negative."
        ),
        "sell": (
            "Indicators favor exiting or avoiding a long position now — weakening "
            "momentum, overbought RSI, price breaking below short-term support, or "
            "bearish news sentiment/tags."
        ),
    },
}

UNIVERSE_ACTION_QUESTION = {
    "type": "choice",
    "instructions": (
        "Evaluate whether this US-listed emerging markets ADR or single-name stock "
        "deserves a near-term long watchlist slot. Do not treat broad EM ETFs as "
        "candidates — only individual names. Return calibrated buy, hold, or sell "
        "probabilities reflecting short-term intraday edge. Favor higher BUY when "
        "momentum, volume, and trend (price vs EMA-9/20 on 1-minute bars, RSI-14 on "
        "1-minute bars not overbought) align and change_1d/change_5d/change_1w support "
        "the move versus a weak EM benchmark. "
        "Penalize BUY for wide spreads, thin volume, benchmark headwinds, or bearish "
        "news. This ranking selects which symbols to monitor — prefer calibrated "
        "differentiation across candidates."
    ),
    "criteria": TRADE_ACTION_QUESTION["criteria"],
}

ACTION_QUESTION = TRADE_ACTION_QUESTION


def extract_jev_confidence(data: dict) -> Optional[float]:
    """Parse optional confidence; never invent from buy/hold/sell probabilities."""
    if not isinstance(data, dict):
        return None
    action = (data.get("answers") or {}).get("action") or {}
    for candidate in (action.get("confidence"), data.get("confidence")):
        if candidate is None:
            continue
        try:
            return float(candidate)
        except (TypeError, ValueError):
            continue
    return None


def average_predictions(samples: List[JevPrediction]) -> JevPrediction:
    """Average B/H/S across samples; stddev = max of population stdevs."""
    if not samples:
        raise ValueError("average_predictions requires at least one sample")
    if len(samples) == 1:
        only = samples[0]
        only.samples_used = 1
        only.prob_stddev = 0.0
        return only

    buys = [p.buy for p in samples]
    holds = [p.hold for p in samples]
    sells = [p.sell for p in samples]
    stddev = max(
        statistics.pstdev(buys),
        statistics.pstdev(holds),
        statistics.pstdev(sells),
    )
    confidences = [p.confidence for p in samples if p.confidence is not None]
    avg_confidence = (
        sum(confidences) / len(confidences) if confidences else None
    )
    first = samples[0]
    last = samples[-1]
    return JevPrediction(
        symbol=first.symbol,
        buy=sum(buys) / len(buys),
        hold=sum(holds) / len(holds),
        sell=sum(sells) / len(sells),
        timestamp=last.timestamp,
        model=last.model,
        raw=last.raw,
        confidence=avg_confidence,
        question_key=first.question_key,
        request_at=first.request_at,
        samples_used=len(samples),
        prob_stddev=float(stddev),
    )


class JevClient:
    """TypeSafe Jev API client for buy/hold/sell predictions."""

    def __init__(
        self,
        api_key: str,
        model: str = "jev-latest",
        timeout_sec: float = 2.0,
        max_retries: int = 2,
    ) -> None:
        if not api_key:
            raise ValueError("TYPESAFE_AI_API_KEY is required for JevClient")
        self.api_key = api_key
        self.model = model
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries

    def predict(
        self,
        state: MarketState,
        *,
        universe_scan: bool = False,
        samples: int = 1,
    ) -> JevPrediction:
        """Call Jev once, or K times and average when samples > 1."""
        k = max(1, int(samples))
        if k == 1:
            return self._predict_once(state, universe_scan=universe_scan)
        collected: List[JevPrediction] = []
        for _ in range(k):
            collected.append(self._predict_once(state, universe_scan=universe_scan))
        return average_predictions(collected)

    def _predict_once(
        self, state: MarketState, *, universe_scan: bool = False
    ) -> JevPrediction:
        question_key = "universe" if universe_scan else "trade"
        question = UNIVERSE_ACTION_QUESTION if universe_scan else TRADE_ACTION_QUESTION
        request_at = datetime.now(timezone.utc)
        payload = {
            "model": self.model,
            "state": state.to_dict(),
            "questions": {"action": question},
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
                return self._parse_response(
                    state.symbol,
                    data,
                    question_key=question_key,
                    request_at=request_at,
                )

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

    def _parse_response(
        self,
        symbol: str,
        data: dict,
        *,
        question_key: str = "trade",
        request_at: Optional[datetime] = None,
    ) -> JevPrediction:
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
            raw=data if isinstance(data, dict) else None,
            confidence=extract_jev_confidence(data if isinstance(data, dict) else {}),
            question_key=question_key,
            request_at=request_at or datetime.now(timezone.utc),
            samples_used=1,
            prob_stddev=None,
        )
