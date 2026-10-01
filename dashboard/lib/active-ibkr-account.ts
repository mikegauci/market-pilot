import type { SupabaseClient } from "@supabase/supabase-js";

/** IBKR account id the trader last reported (Gateway login or pinned IBKR_ACCOUNT). */
export async function fetchActiveIbkrAccountId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("bot_status")
    .select("ibkr_account_id")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return null;
  }
  const id = data?.ibkr_account_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
