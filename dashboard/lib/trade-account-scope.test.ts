import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTradeAccountScopeCache,
  resolveTradeAccountScope,
} from "@/lib/trade-account-scope";

vi.mock("@/lib/active-ibkr-account", () => ({
  resolveDashboardIbkrAccount: vi.fn(),
}));

vi.mock("@/lib/ibkr-trade-scope", () => ({
  includeLegacyUntaggedTrades: vi.fn(),
}));

import { resolveDashboardIbkrAccount } from "@/lib/active-ibkr-account";
import { includeLegacyUntaggedTrades } from "@/lib/ibkr-trade-scope";

describe("resolveTradeAccountScope", () => {
  afterEach(() => {
    clearTradeAccountScopeCache();
    vi.clearAllMocks();
  });

  it("recomputes legacy scope when ibkr account id changes", async () => {
    const supabase = {} as never;
    vi.mocked(resolveDashboardIbkrAccount)
      .mockResolvedValueOnce({ accountId: "DU111", source: "live" })
      .mockResolvedValueOnce({ accountId: "DU222", source: "live" });
    vi.mocked(includeLegacyUntaggedTrades)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const first = await resolveTradeAccountScope(supabase);
    clearTradeAccountScopeCache(); // what useBotStatus does when ibkr_account_id changes
    const second = await resolveTradeAccountScope(supabase);

    expect(first).toEqual({ accountId: "DU111", includeLegacy: true, source: "live" });
    expect(second).toEqual({ accountId: "DU222", includeLegacy: false, source: "live" });
    expect(includeLegacyUntaggedTrades).toHaveBeenCalledTimes(2);
  });

  it("shares one lookup between callers on the same client", async () => {
    const supabase = {} as never;
    vi.mocked(resolveDashboardIbkrAccount).mockResolvedValue({ accountId: "DU111", source: "live" });
    vi.mocked(includeLegacyUntaggedTrades).mockResolvedValue(false);

    const [a, b] = await Promise.all([
      resolveTradeAccountScope(supabase),
      resolveTradeAccountScope(supabase),
    ]);
    await resolveTradeAccountScope(supabase);

    expect(a).toBe(b);
    expect(resolveDashboardIbkrAccount).toHaveBeenCalledTimes(1);
  });
});
