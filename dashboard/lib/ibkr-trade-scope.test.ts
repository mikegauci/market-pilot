import { describe, expect, it, vi } from "vitest";
import {
  filterTradesByActiveIbkrAccount,
  includeLegacyUntaggedTrades,
} from "@/lib/ibkr-trade-scope";
import type { SupabaseClient } from "@supabase/supabase-js";

function mockLegacyCountSupabase(count: number | null, error: { message: string } | null) {
  const terminal = vi.fn().mockResolvedValue({ count, error });
  const chain = {
    select: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    neq: terminal,
  };
  return {
    from: vi.fn().mockReturnValue(chain),
  } as unknown as SupabaseClient;
}

describe("includeLegacyUntaggedTrades", () => {
  it("returns true when no trades are tagged to other accounts", async () => {
    const supabase = mockLegacyCountSupabase(0, null);
    await expect(includeLegacyUntaggedTrades(supabase, "DU111")).resolves.toBe(true);
  });

  it("returns false when another account has tagged trades", async () => {
    const supabase = mockLegacyCountSupabase(3, null);
    await expect(includeLegacyUntaggedTrades(supabase, "DU111")).resolves.toBe(false);
  });

  it("returns false when the count query fails", async () => {
    const supabase = mockLegacyCountSupabase(null, { message: "boom" });
    await expect(includeLegacyUntaggedTrades(supabase, "DU111")).resolves.toBe(false);
  });
});

type TradeQuery = {
  or: (filter: string) => TradeQuery;
  eq: (column: string, value: string) => TradeQuery;
};

function mockTradeQuery(): TradeQuery {
  const query = {} as TradeQuery;
  query.or = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  return query;
}

describe("filterTradesByActiveIbkrAccount", () => {
  it("includes null ibkr_account_id when legacy untagged trades are allowed", async () => {
    const supabase = mockLegacyCountSupabase(0, null);
    const query = mockTradeQuery();

    const result = await filterTradesByActiveIbkrAccount(supabase, "DU111", query);

    expect(query.or).toHaveBeenCalledWith(
      "ibkr_account_id.eq.DU111,ibkr_account_id.is.null",
    );
    expect(query.eq).not.toHaveBeenCalled();
    expect(result).toBe(query);
  });

  it("scopes strictly to the active account when other tags exist", async () => {
    const supabase = mockLegacyCountSupabase(1, null);
    const query = mockTradeQuery();

    const result = await filterTradesByActiveIbkrAccount(supabase, "DU111", query);

    expect(query.eq).toHaveBeenCalledWith("ibkr_account_id", "DU111");
    expect(query.or).not.toHaveBeenCalled();
    expect(result).toBe(query);
  });
});
