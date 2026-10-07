"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkViewerSignInCooldown } from "@/lib/viewer-sign-in-cooldown";
import { viewerLoginConfigured } from "@/lib/viewer-login-config";

export type ViewerSignInResult = { ok: true } | { ok: false; error: string };

export async function signInAsViewer(): Promise<ViewerSignInResult> {
  if (!viewerLoginConfigured()) {
    return { ok: false, error: "Read-only access is not enabled on this deployment." };
  }

  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  const clientKey = forwarded?.split(",")[0]?.trim() ?? headerStore.get("x-real-ip") ?? "unknown";
  const cooldownError = checkViewerSignInCooldown(clientKey);
  if (cooldownError) {
    return { ok: false, error: cooldownError };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.DASHBOARD_VIEWER_EMAIL!.trim(),
    password: process.env.DASHBOARD_VIEWER_PASSWORD!,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function isViewerLoginEnabled(): Promise<boolean> {
  return viewerLoginConfigured();
}
