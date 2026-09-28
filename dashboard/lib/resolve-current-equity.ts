import { createClient } from "@/lib/supabase/server";

/** Resolve live equity from portfolio snapshot, falling back to account_capital. */
export async function resolveCurrentEquity(): Promise<number> {
  const supabase = await createClient();

  const { data: portfolio } = await supabase
    .from("portfolio_history")
    .select("equity")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (portfolio?.equity != null && portfolio.equity > 0) {
    return portfolio.equity;
  }

  const { data: settings } = await supabase
    .from("settings")
    .select("account_capital")
    .eq("id", 1)
    .single();

  return settings?.account_capital ?? 0;
}
