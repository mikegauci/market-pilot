export type TradeRecapTone = {
  netPnl: number | null;
  entryPrice: number;
  exitPrice: number | null;
};

export const RECAP_PROFIT_CLASS = "font-medium text-emerald-400";
export const RECAP_LOSS_CLASS = "font-medium text-red-400";
export const RECAP_MONEY_NEUTRAL_CLASS = "tabular-nums text-zinc-200";

/** Split recap prose into alternating plain and highlightable tokens. */
export const RECAP_TOKEN_PATTERN =
  /(\$\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?%|\bnet loss of \$\d[\d,]*(?:\.\d+)?\b|\bgain of \$\d[\d,]*(?:\.\d+)?\b|\b(?:stopped out|stop loss|take profit|Soft Sell|Soft Stop|in the green|never moved into profit|hard stop)\b)/gi;

export function recapHeadlineClass(netPnl: number | null | undefined): string {
  if (netPnl == null) return "font-medium text-zinc-200";
  return netPnl >= 0
    ? "font-medium text-emerald-300"
    : "font-medium text-red-300";
}

export function classForRecapPercent(textBefore: string): string {
  const ctx = textBefore.slice(-72).toLowerCase();
  if (
    ctx.includes("hard stop") ||
    ctx.includes("soft stop") ||
    ctx.includes("toward the stop") ||
    ctx.includes("toward stop") ||
    ctx.includes("stop path") ||
    ctx.includes("drawdown") ||
    ctx.includes("toward the hard stop")
  ) {
    return RECAP_LOSS_CLASS;
  }
  if (
    ctx.includes("take profit") ||
    ctx.includes("soft sell") ||
    ctx.includes("path to take profit") ||
    ctx.includes("toward take profit") ||
    ctx.includes("moved into profit")
  ) {
    return RECAP_PROFIT_CLASS;
  }
  return "tabular-nums font-medium text-zinc-300";
}

export function classForRecapPhrase(part: string): string | null {
  const lower = part.toLowerCase();
  if (
    lower.includes("net loss") ||
    lower.includes("stopped out") ||
    lower.includes("stop loss") ||
    lower.includes("never moved into profit") ||
    lower.includes("hard stop") ||
    lower === "soft stop"
  ) {
    return RECAP_LOSS_CLASS;
  }
  if (
    lower.includes("gain of") ||
    lower.includes("in the green") ||
    lower.includes("take profit") ||
    lower.includes("soft sell") ||
    lower.includes("moved into profit")
  ) {
    return RECAP_PROFIT_CLASS;
  }
  return null;
}

export function parseRecapMoney(part: string): number | null {
  const match = part.match(/^\$(\d[\d,]*(?:\.\d+)?)$/);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function classForRecapDollar(part: string, tone: TradeRecapTone | undefined): string {
  const value = parseRecapMoney(part);
  if (value == null || !tone) return RECAP_MONEY_NEUTRAL_CLASS;

  const { entryPrice, exitPrice } = tone;
  if (exitPrice != null) {
    if (Math.abs(value - exitPrice) < 0.02) {
      return exitPrice >= entryPrice ? RECAP_PROFIT_CLASS : RECAP_LOSS_CLASS;
    }
    if (Math.abs(value - entryPrice) < 0.02) {
      return RECAP_MONEY_NEUTRAL_CLASS;
    }
  }

  if (tone.netPnl != null && tone.netPnl < 0) {
    return RECAP_LOSS_CLASS;
  }
  if (tone.netPnl != null && tone.netPnl > 0) {
    return RECAP_PROFIT_CLASS;
  }
  return RECAP_MONEY_NEUTRAL_CLASS;
}

export type RecapTokenStyle = "neutral" | "profit" | "loss" | "money-neutral";

export function styleRecapToken(
  part: string,
  textBefore: string,
  tone: TradeRecapTone | undefined,
): RecapTokenStyle {
  if (/^net loss of \$/i.test(part)) return "loss";
  if (/^gain of \$/i.test(part)) return "profit";
  if (/^\$/.test(part)) {
    const cls = classForRecapDollar(part, tone);
    if (cls === RECAP_PROFIT_CLASS) return "profit";
    if (cls === RECAP_LOSS_CLASS) return "loss";
    return "money-neutral";
  }
  if (/%/.test(part) && /\d/.test(part)) {
    const cls = classForRecapPercent(textBefore);
    if (cls === RECAP_PROFIT_CLASS) return "profit";
    if (cls === RECAP_LOSS_CLASS) return "loss";
    return "neutral";
  }
  if (classForRecapPhrase(part)) {
    return classForRecapPhrase(part) === RECAP_PROFIT_CLASS ? "profit" : "loss";
  }
  return "neutral";
}

export function recapTokenClassName(style: RecapTokenStyle): string | undefined {
  switch (style) {
    case "profit":
      return RECAP_PROFIT_CLASS;
    case "loss":
      return RECAP_LOSS_CLASS;
    case "money-neutral":
      return RECAP_MONEY_NEUTRAL_CLASS;
    default:
      return undefined;
  }
}
