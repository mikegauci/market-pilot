export function parseSettingsNumberDraft(raw: string, integer: boolean): number | null {
  if (raw === "" || raw === "-") return null;
  const n = integer ? parseInt(raw, 10) : parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function isIncompleteSettingsNumberDraft(raw: string): boolean {
  return raw.endsWith(".") || raw.endsWith("e") || raw.endsWith("E") || raw === "-";
}
