import { describe, expect, it } from "vitest";
import { buildDailyEquitySeries } from "@/lib/portfolio-analytics";
import { tradingEquityFromSnapshot } from "@/lib/trading-equity";
import type { PortfolioSnapshot } from "@/lib/types/database";

describe("tradingEquityFromSnapshot", () => {
  it("subtracts IBKR accrued cash from net liquidation", () => {
    expect(
      tradingEquityFromSnapshot({
        equity: 999_980.68,
        ibkr_accrued_cash: 186.8,
      }),
    ).toBeCloseTo(999_793.88);
  });

  it("leaves equity unchanged when accrued cash is missing", () => {
    expect(
      tradingEquityFromSnapshot({
        equity: 10_000,
        ibkr_accrued_cash: null,
      }),
    ).toBe(10_000);
  });

  it("uses full net liquidation in live mode", () => {
    expect(
      tradingEquityFromSnapshot(
        { equity: 999_980.68, ibkr_accrued_cash: 186.8 },
        "live",
      ),
    ).toBeCloseTo(999_980.68);
  });
});

describe("buildDailyEquitySeries with accrued cash", () => {
  it("uses trading equity per day", () => {
    const history: PortfolioSnapshot[] = [
      {
        id: "1",
        timestamp: "2026-01-01T10:00:00Z",
        balance: 0,
        equity: 1_000_100,
        daily_pnl: 0,
        total_pnl: 0,
        currency: "USD",
        ibkr_account_id: "DU1",
        ibkr_accrued_cash: 100,
        created_at: "",
      },
      {
        id: "2",
        timestamp: "2026-01-02T10:00:00Z",
        balance: 0,
        equity: 1_000_250,
        daily_pnl: 0,
        total_pnl: 0,
        currency: "USD",
        ibkr_account_id: "DU1",
        ibkr_accrued_cash: 150,
        created_at: "",
      },
    ];
    expect(buildDailyEquitySeries(history)).toEqual([
      { date: "2026-01-01", equity: 1_000_000, changeFromPriorDay: null },
      { date: "2026-01-02", equity: 1_000_100, changeFromPriorDay: 100 },
    ]);
  });
});
