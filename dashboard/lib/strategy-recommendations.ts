export const STRATEGY_RECOMMENDATIONS = {
  stop_loss_percentage: 0.01,
  take_profit_percentage: 0.015,
} as const;

export type StrategyPercentKey = keyof typeof STRATEGY_RECOMMENDATIONS;

export function fractionToDisplayPercent(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

export function displayPercentToFraction(pct: number): number {
  return pct / 100;
}

export function formatStrategyPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  return `${Number(pct.toFixed(2))}%`;
}

export function isNearStrategyPercent(
  value: number,
  recommended: number,
  tolerance = 0.15,
): boolean {
  if (recommended <= 0) return false;
  return Math.abs(value - recommended) / recommended <= tolerance;
}

export function getRiskRewardRatio(stopLoss: number, takeProfit: number): number | null {
  if (stopLoss <= 0 || takeProfit <= 0) return null;
  return takeProfit / stopLoss;
}

export type StrategyHint = {
  tone: "ok" | "info" | "warn";
  message: string;
};

export function getStopLossHints(stopLoss: number): StrategyHint[] {
  const hints: StrategyHint[] = [];
  const rec = STRATEGY_RECOMMENDATIONS.stop_loss_percentage;
  const recPct = formatStrategyPercent(rec);

  if (isNearStrategyPercent(stopLoss, rec)) {
    hints.push({ tone: "ok", message: `Matches recommended ${recPct}.` });
    return hints;
  }

  hints.push({ tone: "info", message: `Recommended: ${recPct}.` });

  if (stopLoss < rec) {
    hints.push({
      tone: "warn",
      message:
        "Tighter stop — for the same risk per trade the bot buys a larger position, and normal swings may stop you out more often.",
    });
  } else {
    hints.push({
      tone: "warn",
      message: "Wider stop — each losing trade can lose more before the stop is hit.",
    });
  }

  if (stopLoss < 0.003) {
    hints.push({
      tone: "warn",
      message: "Very tight stop — position size may hit your max position cap; noise can trigger exits.",
    });
  }
  if (stopLoss > 0.05) {
    hints.push({
      tone: "warn",
      message: "Very wide stop — losses per trade may be much larger than your risk per trade setting implies.",
    });
  }

  return hints;
}

export function getTakeProfitHints(
  takeProfit: number,
  stopLoss: number,
): StrategyHint[] {
  const hints: StrategyHint[] = [];
  const rec = STRATEGY_RECOMMENDATIONS.take_profit_percentage;
  const recPct = formatStrategyPercent(rec);

  if (takeProfit <= stopLoss) {
    hints.push({
      tone: "warn",
      message: "Take profit is at or below stop loss — you risk more per trade than you aim to gain.",
    });
  } else {
    const ratio = getRiskRewardRatio(stopLoss, takeProfit);
    if (ratio != null) {
      const ratioLabel = ratio >= 1 ? `1:${ratio.toFixed(1)}` : `${(1 / ratio).toFixed(1)}:1`;
      hints.push({
        tone: ratio >= 1 ? "info" : "warn",
        message:
          ratio >= 1
            ? `Risk/reward about ${ratioLabel} (gain vs loss per trade).`
            : `Risk/reward below 1:1 (${ratioLabel}) — you need a very high win rate.`,
      });
    }
  }

  if (isNearStrategyPercent(takeProfit, rec)) {
    hints.push({ tone: "ok", message: `Matches recommended ${recPct}.` });
  } else {
    hints.push({ tone: "info", message: `Recommended: ${recPct}.` });
    if (takeProfit > rec * 2) {
      hints.push({
        tone: "info",
        message: "High take-profit target — wins may be less frequent.",
      });
    }
  }

  return hints;
}
