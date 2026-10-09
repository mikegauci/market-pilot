import "server-only";

import type { User } from "@supabase/supabase-js";
import { canDashboardWrite } from "@/lib/dashboard-role";
import { checkOpenAiActionCooldown } from "@/lib/openai-action-cooldown";
import { requireOpenAiKey } from "@/lib/openai/structured.server";
import { readOnlyActionError } from "@/lib/require-dashboard-write.server";
import { readSettings } from "@/lib/supabase/data-reads";
import { createClient } from "@/lib/supabase/server";
import type { Settings } from "@/lib/types/database";

export type AiActionFailure = { ok: false; error: string };

export type AiActionContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Shared guard for dashboard AI server actions: OpenAI key, signed-in owner, optional per-user
 * cooldown, then `run`. Any error thrown by `run` becomes `{ ok: false, error }`.
 */
export async function withAiAction<R>(
  opts: {
    signInMessage: string;
    cooldown?: { key: string; ms: number };
  },
  run: (ctx: AiActionContext) => Promise<R | AiActionFailure>,
): Promise<R | AiActionFailure> {
  try {
    requireOpenAiKey();
  } catch (err) {
    return { ok: false, error: errorMessage(err, "OpenAI is not configured.") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: opts.signInMessage };
  }
  if (!canDashboardWrite(user)) {
    return readOnlyActionError();
  }

  if (opts.cooldown) {
    const cooldownError = checkOpenAiActionCooldown(user.id, opts.cooldown.key, opts.cooldown.ms);
    if (cooldownError) {
      return { ok: false, error: cooldownError };
    }
  }

  try {
    return await run({ supabase, user });
  } catch (err) {
    return { ok: false, error: errorMessage(err, "OpenAI request failed.") };
  }
}

/** Normalized settings row for AI packets, or a failure result to return as-is. */
export async function loadSettingsForAi(
  supabase: AiActionContext["supabase"],
): Promise<Settings | AiActionFailure> {
  const { data, error } = await readSettings(supabase);
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Settings not found." };
  }
  return data;
}

export function isAiActionFailure(value: unknown): value is AiActionFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false
  );
}
