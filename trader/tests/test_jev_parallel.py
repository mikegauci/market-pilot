from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from jev.client import JevClient
from main import _fetch_jev_predictions
from models.types import JevPrediction, MarketState


def _state(symbol: str) -> MarketState:
    return MarketState(
        symbol=symbol,
        price=100.0,
        change_1m=0.1,
        change_5m=0.2,
        change_15m=0.3,
        volume_ratio=1.0,
        rsi=50.0,
        ema_9=99.0,
        ema_20=98.0,
        bid=99.9,
        ask=100.1,
        spread=0.2,
        spy_change_5m=0.1,
    )


class TestFetchJevPredictionsParallel(unittest.TestCase):
    def test_returns_predictions_for_all_symbols(self) -> None:
        jev = MagicMock(spec=JevClient)

        def predict(state: MarketState) -> JevPrediction:
            return JevPrediction(
                symbol=state.symbol,
                buy=0.1,
                hold=0.8,
                sell=0.1,
                timestamp=datetime.now(timezone.utc),
                model="jev-latest",
            )

        jev.predict.side_effect = predict
        ready = [("AAPL", _state("AAPL")), ("MSFT", _state("MSFT"))]

        result = _fetch_jev_predictions(jev, ready, max_workers=2)

        self.assertEqual(set(result), {"AAPL", "MSFT"})
        self.assertEqual(jev.predict.call_count, 2)

    def test_continues_when_one_symbol_fails(self) -> None:
        jev = MagicMock(spec=JevClient)

        def predict(state: MarketState) -> JevPrediction:
            if state.symbol == "MSFT":
                raise RuntimeError("timeout")
            return JevPrediction(
                symbol=state.symbol,
                buy=0.2,
                hold=0.7,
                sell=0.1,
                timestamp=datetime.now(timezone.utc),
                model="jev-latest",
            )

        jev.predict.side_effect = predict
        ready = [("AAPL", _state("AAPL")), ("MSFT", _state("MSFT"))]

        result = _fetch_jev_predictions(jev, ready, max_workers=2)

        self.assertEqual(set(result), {"AAPL"})


if __name__ == "__main__":
    unittest.main()
