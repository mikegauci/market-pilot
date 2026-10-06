/** 0% = at or above entry; 100% = at or below the stop. */
export function slProximityPct(entry: number, stopLoss: number, price: number): number | null {
  const range = entry - stopLoss;
  if (!(range > 0) || !Number.isFinite(price)) return null;
  const used = ((entry - price) / range) * 100;
  return Math.max(0, Math.min(100, used));
}

/** 0% = at or below entry; 100% = at or above take profit. */
export function tpProgressPct(entry: number, takeProfit: number, price: number): number | null {
  const range = takeProfit - entry;
  if (!(range > 0) || !Number.isFinite(price)) return null;
  const progress = ((price - entry) / range) * 100;
  return Math.max(0, Math.min(100, progress));
}

/** Whole percent. 99.5 and above reads as 100. */
export function formatGaugePercent(value: number): string {
  const shown = Math.round(Math.min(100, Math.max(0, value)));
  return `${shown}%`;
}

export function formatPriceMoveFromEntry(entry: number, price: number): string | null {
  if (!(entry > 0) || !Number.isFinite(price)) return null;
  const pct = ((price - entry) / entry) * 100;
  const text = Math.abs(pct).toFixed(2);
  if (pct < -0.0005) return `down ${text}% from entry`;
  if (pct > 0.0005) return `up ${text}% from entry`;
  return "at entry";
}
