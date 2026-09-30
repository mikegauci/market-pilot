/** Shared position sizing preview (mirrors trader/risk/sizing.py). */

export type SizingBinding =
  | "risk"
  | "max_position"
  | "cash"
  | "portfolio"
  | "too_small"
  | "invalid";

export type SizingResult = {
  quantity: number;
  positionValue: number;
  requestedRiskUsd: number;
  plannedRiskUsd: number;
  riskBasedNotional: number;
  cappedNotional: number;
  sizingBinding: SizingBinding;
  ok: boolean;
};

export function computePositionSizing(input: {
  price: number;
  riskPerTrade: number;
  stopLossPercentage: number;
  maxPositionSize: number;
  availableCash: number;
  portfolioSlotsFull?: boolean;
}): SizingResult {
  const {
    price,
    riskPerTrade,
    stopLossPercentage,
    maxPositionSize,
    availableCash,
    portfolioSlotsFull = false,
  } = input;

  if (price <= 0 || stopLossPercentage <= 0 || riskPerTrade <= 0) {
    return {
      quantity: 0,
      positionValue: 0,
      requestedRiskUsd: Math.max(0, riskPerTrade),
      plannedRiskUsd: 0,
      riskBasedNotional: 0,
      cappedNotional: 0,
      sizingBinding: "invalid",
      ok: false,
    };
  }

  if (portfolioSlotsFull) {
    return {
      quantity: 0,
      positionValue: 0,
      requestedRiskUsd: riskPerTrade,
      plannedRiskUsd: 0,
      riskBasedNotional: 0,
      cappedNotional: 0,
      sizingBinding: "portfolio",
      ok: false,
    };
  }

  const riskBasedNotional = riskPerTrade / stopLossPercentage;
  let cappedNotional = Math.min(maxPositionSize, riskBasedNotional);
  let sizingBinding: SizingBinding =
    cappedNotional < riskBasedNotional - 1e-9 ? "max_position" : "risk";

  if (availableCash < cappedNotional) {
    cappedNotional = Math.max(0, availableCash);
    sizingBinding = "cash";
  }

  const quantity = Math.floor(cappedNotional / price);
  if (quantity < 1) {
    return {
      quantity: 0,
      positionValue: 0,
      requestedRiskUsd: riskPerTrade,
      plannedRiskUsd: 0,
      riskBasedNotional,
      cappedNotional,
      sizingBinding: "too_small",
      ok: false,
    };
  }

  const positionValue = quantity * price;
  return {
    quantity,
    positionValue,
    requestedRiskUsd: riskPerTrade,
    plannedRiskUsd: positionValue * stopLossPercentage,
    riskBasedNotional,
    cappedNotional,
    sizingBinding,
    ok: true,
  };
}

export function paperAvailableCash(accountCapital: number, deployedNotional: number): number {
  return Math.max(0, accountCapital - deployedNotional);
}

/** True when max_position (not risk budget) binds at the given stop. */
export function isRiskPerTradeNonBinding(
  riskPerTrade: number,
  maxPositionSize: number,
  stopLossPercentage: number,
): boolean {
  if (stopLossPercentage <= 0 || riskPerTrade <= 0) return false;
  return riskPerTrade / stopLossPercentage > maxPositionSize + 1e-9;
}
