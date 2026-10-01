/** Friendly IB Gateway login names for known account ids (extend as needed). */
const KNOWN_IBKR_ACCOUNT_LABELS: Record<string, string> = {
  DUR217910: "mikegauci994paper",
  DUR226344: "mikegauci-paper",
  U16159014: "mikegauci",
};

export type IbkrAccountDisplay = {
  /** Primary line (login name or account id). */
  title: string;
  /** Account id when title is a friendly name. */
  accountId: string | null;
};

export function formatIbkrAccountDisplay(
  accountId: string | null | undefined,
): IbkrAccountDisplay | null {
  if (!accountId) {
    return null;
  }
  const label = KNOWN_IBKR_ACCOUNT_LABELS[accountId];
  if (label) {
    return { title: label, accountId };
  }
  return { title: accountId, accountId: null };
}
