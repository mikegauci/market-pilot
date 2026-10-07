import type { User } from "@supabase/supabase-js";

export type DashboardRole = "owner" | "viewer" | "unknown";

export function getDashboardRole(user: User | null | undefined): DashboardRole {
  if (!user) return "unknown";
  const role = user.app_metadata?.dashboard_role;
  if (role === "owner") return "owner";
  if (role === "viewer") return "viewer";
  return "unknown";
}

export function isReadOnlyUser(user: User | null | undefined): boolean {
  return getDashboardRole(user) === "viewer";
}

export function canDashboardWrite(user: User | null | undefined): boolean {
  return getDashboardRole(user) === "owner";
}

/** True when the signed-in user must not mutate data (viewer or missing owner role). */
export function isDashboardReadOnly(user: User | null | undefined): boolean {
  return Boolean(user) && !canDashboardWrite(user);
}

export const READ_ONLY_ACTION_MESSAGE =
  "Read-only view — sign in with your owner account to change settings or control the bot.";

export function assertDashboardCanWrite(user: User | null | undefined): void {
  if (!canDashboardWrite(user)) {
    throw new Error(READ_ONLY_ACTION_MESSAGE);
  }
}

export function readOnlyActionError(): { ok: false; error: string } {
  return { ok: false, error: READ_ONLY_ACTION_MESSAGE };
}
