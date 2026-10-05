const STORAGE_PREFIX = "market-pilot:settings-brief-applied:v1:";

export function briefSettingsDismissStorageKey(sessionDate: string): string {
  return `${STORAGE_PREFIX}${sessionDate}`;
}

export function isBriefSettingsDismissed(sessionDate: string | null | undefined): boolean {
  if (!sessionDate || typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(briefSettingsDismissStorageKey(sessionDate)) === "1";
}

export function dismissBriefSettings(sessionDate: string): void {
  sessionStorage.setItem(briefSettingsDismissStorageKey(sessionDate), "1");
}
