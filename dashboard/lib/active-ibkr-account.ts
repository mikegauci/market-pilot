import type { SupabaseClient } from "@supabase/supabase-js";

export type IbkrAccountSource = "live" | "env" | "inferred";

export type ResolvedIbkrAccount = {
  accountId: string | null;
  source: IbkrAccountSource | null;
};

/** Env pin for dashboard trade/portfolio scope (server + client via next.config env). */
export function dashboardIbkrAccountEnvPin(): string | null {
  const id = process.env.DASHBOARD_IBKR_ACCOUNT_ID?.trim();
  return id && id.length > 0 ? id : null;
}

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

async function inferIbkrAccountFromTrades(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data: profiles, error: profileError } = await supabase
    .from("ibkr_account_profiles")
    .select("account_id");

  if (!profileError && profiles?.length) {
    let best: string | null = null;
    let bestCount = 0;
    for (const row of profiles) {
      const accountId = row.account_id;
      if (typeof accountId !== "string" || accountId.length === 0) {
        continue;
      }
      const { count, error } = await supabase
        .from("trades")
        .select("id", { count: "exact", head: true })
        .eq("ibkr_account_id", accountId);
      if (error) {
        continue;
      }
      const n = count ?? 0;
      if (n > bestCount) {
        best = accountId;
        bestCount = n;
      }
    }
    if (bestCount > 0) {
      return best;
    }
  }

  const { data, error } = await supabase
    .from("trades")
    .select("ibkr_account_id")
    .not("ibkr_account_id", "is", null)
    .limit(1000);

  if (error || !data?.length) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const row of data) {
    const id = row.ibkr_account_id;
    if (typeof id === "string" && id.length > 0) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Account id for dashboard trade scope: live bot status, then env pin, then trades table.
 */
export async function resolveDashboardIbkrAccount(
  supabase: SupabaseClient,
): Promise<ResolvedIbkrAccount> {
  const live = await fetchActiveIbkrAccountId(supabase);
  if (live) {
    return { accountId: live, source: "live" };
  }

  const env = dashboardIbkrAccountEnvPin();
  if (env) {
    return { accountId: env, source: "env" };
  }

  const inferred = await inferIbkrAccountFromTrades(supabase);
  if (inferred) {
    return { accountId: inferred, source: "inferred" };
  }

  return { accountId: null, source: null };
}
