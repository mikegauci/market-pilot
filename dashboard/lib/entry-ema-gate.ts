export const ENTRY_EMA_GATE_VALUES = ["off", "ema_9", "ema_20"] as const;

export type EntryEmaGate = (typeof ENTRY_EMA_GATE_VALUES)[number];

export const DEFAULT_ENTRY_EMA_GATE: EntryEmaGate = "ema_20";

export function normalizeEntryEmaGate(raw: unknown): EntryEmaGate {
  if (typeof raw !== "string") {
    return DEFAULT_ENTRY_EMA_GATE;
  }
  const value = raw.trim().toLowerCase();
  if (value === "off" || value === "ema_9" || value === "ema_20") {
    return value;
  }
  return DEFAULT_ENTRY_EMA_GATE;
}

export function entryEmaGateLabel(gate: EntryEmaGate): string {
  switch (gate) {
    case "off":
      return "Off";
    case "ema_9":
      return "Price above EMA-9";
    case "ema_20":
      return "Price above EMA-20";
  }
}

export function entryEmaFilterName(gate: EntryEmaGate): string | null {
  if (gate === "off") return null;
  return gate === "ema_9" ? "EMA-9" : "EMA-20";
}

export function entryEmaWarmupBars(gate: EntryEmaGate): number | null {
  if (gate === "off") return null;
  return gate === "ema_9" ? 9 : 20;
}
