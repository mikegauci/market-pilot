import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTradeAccountScopeCache,
  resolveTradeAccountScope,
} from "@/lib/trade-account-scope";

vi.mock("@/lib/active-ibkr-account", () => ({
  fetchActiveIbkrAccountId: vi.fn(),
}));

vi.mock("@/lib/ibkr-trade-scope", () => ({
  includeLegacyUntaggedTrades: vi.fn(),
}));

import { fetchActiveIbkrAccountId } from "@/lib/active-ibkr-account";
import { includeLegacyUntaggedTrades } from "@/lib/ibkr-trade-scope";

describe("resolveTradeAccountScope", () => {
  afterEach(() => {
    clearTradeAccountScopeCache();
    vi.clearAllMocks();
  });

  it("recomputes legacy scope when ibkr account id changes", async () => {
    const supabase = {} as never;
    vi.mocked(fetchActiveIbkrAccountId)
      .mockResolvedValueOnce("DU111")
      .mockResolvedValueOnce("DU222");
    vi.mocked(includeLegacyUntaggedTrades)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const first = await resolveTradeAccountScope(supabase);
    const second = await resolveTradeAccountScope(supabase);

    expect(first).toEqual({ accountId: "DU111", includeLegacy: true });
    expect(second).toEqual({ accountId: "DU222", includeLegacy: false });
    expect(includeLegacyUntaggedTrades).toHaveBeenCalledTimes(2);
  });
});
