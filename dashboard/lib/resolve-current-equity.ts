import "server-only";

import { resolveDashboardIbkrAccount } from "@/lib/active-ibkr-account";
import { createClient } from "@/lib/supabase/server";

/** Resolve live equity from portfolio snapshot, falling back to account_capital. */
export async function resolveCurrentEquity(): Promise<number> {
  const supabase = await createClient();
  const { accountId } = await resolveDashboardIbkrAccount(supabase);
  if (!accountId) {
    const { data: settings } = await supabase
      .from("settings")
      .select("account_capital")
      .eq("id", 1)
      .single();
    return settings?.account_capital ?? 0;
  }

  const { data: portfolio } = await supabase
    .from("portfolio_history")
    .select("equity")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (portfolio?.equity != null && portfolio.equity > 0) {
    return portfolio.equity;
  }

  if (accountId) {
    const { data: profile } = await supabase
      .from("ibkr_account_profiles")
      .select("account_capital")
      .eq("account_id", accountId)
      .maybeSingle();
    if (profile?.account_capital != null && profile.account_capital > 0) {
      return profile.account_capital;
    }
  }

  const { data: settings } = await supabase
    .from("settings")
    .select("account_capital")
    .eq("id", 1)
    .single();

  return settings?.account_capital ?? 0;
}
