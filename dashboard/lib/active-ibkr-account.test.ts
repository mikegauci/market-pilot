import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dashboardIbkrAccountEnvPin,
  resolveDashboardIbkrAccount,
} from "@/lib/active-ibkr-account";

describe("dashboardIbkrAccountEnvPin", () => {
  const originalEnv = process.env.DASHBOARD_IBKR_ACCOUNT_ID;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DASHBOARD_IBKR_ACCOUNT_ID;
    } else {
      process.env.DASHBOARD_IBKR_ACCOUNT_ID = originalEnv;
    }
  });

  it("returns trimmed pin when set", () => {
    process.env.DASHBOARD_IBKR_ACCOUNT_ID = "  DUR217910  ";
    expect(dashboardIbkrAccountEnvPin()).toBe("DUR217910");
  });
});

describe("resolveDashboardIbkrAccount", () => {
  const originalEnv = process.env.DASHBOARD_IBKR_ACCOUNT_ID;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DASHBOARD_IBKR_ACCOUNT_ID;
    } else {
      process.env.DASHBOARD_IBKR_ACCOUNT_ID = originalEnv;
    }
  });

  it("prefers live bot_status account", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { ibkr_account_id: "DU111" },
              error: null,
            }),
          }),
        }),
      }),
    } as never;

    await expect(resolveDashboardIbkrAccount(supabase)).resolves.toEqual({
      accountId: "DU111",
      source: "live",
    });
  });

  it("uses env pin when live account is missing", async () => {
    process.env.DASHBOARD_IBKR_ACCOUNT_ID = "DUR217910";
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { ibkr_account_id: null },
              error: null,
            }),
          }),
        }),
      }),
    } as never;

    await expect(resolveDashboardIbkrAccount(supabase)).resolves.toEqual({
      accountId: "DUR217910",
      source: "env",
    });
  });

  it("infers account from trade counts per ibkr_account_profiles row", async () => {
    delete process.env.DASHBOARD_IBKR_ACCOUNT_ID;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "bot_status") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { ibkr_account_id: null },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "ibkr_account_profiles") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ account_id: "DUR217910" }, { account_id: "DU222" }],
              error: null,
            }),
          };
        }
        if (table === "trades") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((_col: string, accountId: string) =>
                Promise.resolve({
                  count: accountId === "DUR217910" ? 10 : 2,
                  error: null,
                }),
              ),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as never;

    await expect(resolveDashboardIbkrAccount(supabase)).resolves.toEqual({
      accountId: "DUR217910",
      source: "inferred",
    });
  });
});
