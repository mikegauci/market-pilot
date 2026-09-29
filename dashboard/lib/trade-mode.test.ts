import { describe, expect, it } from "vitest";
import { getBrokerNotice, getTradeModeCopy } from "@/lib/trade-mode";

describe("getTradeModeCopy", () => {
  it("describes live paper broker when IBKR is connected", () => {
    expect(
      getTradeModeCopy({ ibkrConnected: true, traderOnline: true }),
    ).toEqual({
      sidebarLabel: "Paper broker",
      statusLine: "Orders sent to paper broker",
    });
  });

  it("describes waiting state when the engine is stopped", () => {
    expect(
      getTradeModeCopy({ ibkrConnected: false, traderOnline: false }),
    ).toEqual({
      sidebarLabel: "Engine stopped",
      statusLine: "Start the trading engine and IB Gateway to place paper orders",
    });
  });

  it("describes offline broker when the engine is running without IBKR", () => {
    expect(
      getTradeModeCopy({ ibkrConnected: false, traderOnline: true }),
    ).toEqual({
      sidebarLabel: "Broker offline",
      statusLine: "Connect IB Gateway — new orders pause until the broker is reachable",
    });
  });
});

describe("getBrokerNotice", () => {
  it("returns guidance when auto-trading needs broker connectivity", () => {
    expect(getBrokerNotice({ ibkrConnected: false, traderOnline: true })?.tone).toBe(
      "amber",
    );
  });
});
