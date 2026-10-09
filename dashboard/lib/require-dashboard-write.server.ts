import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDashboardCanWrite } from "@/lib/dashboard-role";
export { readOnlyActionError } from "@/lib/dashboard-role";
import { createClient } from "@/lib/supabase/server";

export async function assertDashboardWriteFromSession(
  supabase: SupabaseClient,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  assertDashboardCanWrite(user);
}

export async function requireDashboardWriteClient(): Promise<
  Awaited<ReturnType<typeof createClient>>
> {
  const supabase = await createClient();
  await assertDashboardWriteFromSession(supabase);
  return supabase;
}
