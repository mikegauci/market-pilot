/** Label rotation session % for Strategy UI (NULL/undefined off = off). */
export function formatRotationSessionPct(
  value: number | null | undefined,
): string {
  if (value == null) {
    return "Off";
  }
  return `≥ ${value.toFixed(2)}% vs RTH open`;
}

export function rotationSessionPctInputValue(
  value: number | null | undefined,
): string {
  if (value == null) {
    return "";
  }
  return String(value);
}
