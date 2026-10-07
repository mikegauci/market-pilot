/** Label rotation session % for Strategy UI (NULL/undefined off = off). */
export function formatRotationSessionPct(
  value: number | null | undefined,
): string {
  if (value == null) {
    return "Off";
  }
  return `≥ ${value.toFixed(2)}% since open`;
}

export function rotationSessionPctInputValue(
  value: number | null | undefined,
): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

/** Parse Settings rotation session % input (blank/off → null). */
export function parseRotationSessionPctInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "off") {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}
