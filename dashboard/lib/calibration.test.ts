import { describe, expect, it } from "vitest";
import {
  brierScore,
  computeCalibration,
  rejectedForwardCalibrationSamples,
  reliabilityBins,
  takenTradeCalibrationSamples,
} from "@/lib/calibration";
import type { Prediction, SignalForwardReturn, Trade } from "@/lib/types/database";

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "symbol">): Trade {
  return {
    side: "buy",
    entry_time: "2026-01-01T15:00:00Z",
    entry_price: 100,
    exit_time: "2026-01-01T16:00:00Z",
    exit_price: 101,
    quantity: 1,
    position_value: 100,
    stop_loss: 99,
    take_profit: 102,
    gross_pnl: 1,
    net_pnl: 1,
    status: "closed",
    paper_or_live: "paper",
    jev_buy_probability: 0.8,
    exit_reason: "take_profit",
    created_at: "2026-01-01T15:00:00Z",
    ...partial,
  };
}

describe("calibration samples", () => {
  it("maps TP/SL taken trades", () => {
    const samples = takenTradeCalibrationSamples([
      trade({ id: "1", symbol: "A", exit_reason: "take_profit", jev_buy_probability: 0.9 }),
      trade({ id: "2", symbol: "B", exit_reason: "stop_loss", jev_buy_probability: 0.7 }),
      trade({ id: "3", symbol: "C", exit_reason: "manual", jev_buy_probability: 0.8 }),
    ]);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.outcome).toBe(1);
    expect(samples[1]!.outcome).toBe(0);
  });

  it("maps rejected forwards by prediction id", () => {
    const preds = [
      {
        id: "p1",
        symbol: "A",
        timestamp: "",
        price: 1,
        buy_probability: 0.6,
        hold_probability: 0.2,
        sell_probability: 0.2,
        trade_created: false,
        created_at: "",
      },
      {
        id: "p2",
        symbol: "B",
        timestamp: "",
        price: 1,
        buy_probability: 0.4,
        hold_probability: 0.3,
        sell_probability: 0.3,
        trade_created: true,
        created_at: "",
      },
    ] as Prediction[];
    const forwards = [
      {
        id: "f1",
        prediction_id: "p1",
        symbol: "A",
        signal_at: "",
        signal_price: 1,
        horizon_minutes: 15,
        forward_at: "",
        forward_price: 1.1,
        forward_return: 0.1,
      },
    ] as SignalForwardReturn[];
    const samples = rejectedForwardCalibrationSamples(preds, forwards);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.outcome).toBe(1);
    expect(samples[0]!.probability).toBe(0.6);
  });
});

describe("brier and bins", () => {
  it("is zero for perfect forecasts", () => {
    expect(
      brierScore([
        { probability: 1, outcome: 1, source: "taken" },
        { probability: 0, outcome: 0, source: "taken" },
      ]),
    ).toBe(0);
  });

  it("counts bins correctly", () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({
      probability: 0.55,
      outcome: (i < 7 ? 1 : 0) as 0 | 1,
      source: "taken" as const,
    }));
    const bins = reliabilityBins(samples);
    const bin = bins.find((b) => b.lo <= 0.55 && 0.55 < b.hi)!;
    expect(bin.n).toBe(10);
    expect(bin.hitRate).toBeCloseTo(0.7);
    expect(bin.insufficient).toBe(false);
  });

  it("computeCalibration returns brier + bins", () => {
    const result = computeCalibration([
      { probability: 0.8, outcome: 1, source: "taken" },
      { probability: 0.2, outcome: 0, source: "rejected" },
    ]);
    expect(result.n).toBe(2);
    expect(result.brier).not.toBeNull();
    expect(result.bins).toHaveLength(10);
  });
});
