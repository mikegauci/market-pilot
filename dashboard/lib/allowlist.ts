/** Dashboard owner allowlist helpers (Phase 8). */

const DEFAULT_OWNER_ID = "a580f939-c1ad-4098-9221-b89506cd9291";

export function allowedUserIdsFromEnv(
  envValue: string | undefined = process.env.DASHBOARD_ALLOWED_USER_IDS,
): Set<string> {
  const ids = new Set<string>();
  ids.add(DEFAULT_OWNER_ID);
  for (const part of (envValue ?? "").split(",")) {
    const id = part.trim();
    if (id) ids.add(id);
  }
  return ids;
}

export function isUserIdAllowlisted(
  userId: string | null | undefined,
  envValue?: string,
): boolean {
  if (!userId) return false;
  return allowedUserIdsFromEnv(envValue).has(userId);
}

export type SettingsAuditAction = "settings_update" | "bot_toggle";

export function buildSettingsAuditPayload(input: {
  action: SettingsAuditAction;
  actorUserId: string;
  actorEmail?: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  return {
    action: input.action,
    actor_user_id: input.actorUserId,
    actor_email: input.actorEmail ?? null,
    before: input.before,
    after: input.after,
  };
}
