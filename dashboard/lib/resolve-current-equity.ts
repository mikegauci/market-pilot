import "server-only";

import { fetchActiveIbkrAccountId } from "@/lib/active-ibkr-account";
import { createClient } from "@/lib/supabase/server";
import { tradingEquityFromSnapshot } from "@/lib/trading-equity";

/** Resolve live equity from portfolio snapshot, falling back to account_capital. */
export async function resolveCurrentEquity(): Promise<number> {
  const supabase = await createClient();
  const accountId = await fetchActiveIbkrAccountId(supabase);
  if (!accountId) {
    const { data: settings } = await supabase
      .from("settings")
      .select("account_capital")
      .eq("id", 1)
      .single();
    return settings?.account_capital ?? 0;
  }

  const { data: settingsRow } = await supabase
    .from("settings")
    .select("trading_mode")
    .eq("id", 1)
    .single();
  const tradingMode =
    settingsRow?.trading_mode === "live" ? "live" : "paper";

  const { data: portfolio } = await supabase
    .from("portfolio_history")
    .select("equity, ibkr_accrued_cash")
    .eq("ibkr_account_id", accountId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (portfolio?.equity != null && portfolio.equity > 0) {
    return tradingEquityFromSnapshot(portfolio, tradingMode);
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
