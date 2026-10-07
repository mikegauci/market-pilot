import { describe, expect, it } from "vitest";
import { tradeClosedToastVariant } from "@/components/toast-provider";

describe("tradeClosedToastVariant", () => {
  it("maps PnL sign to close toast colors", () => {
    expect(tradeClosedToastVariant(12.5)).toBe("trade-closed-profit");
    expect(tradeClosedToastVariant(-3)).toBe("trade-closed-loss");
    expect(tradeClosedToastVariant(0)).toBe("trade-closed");
    expect(tradeClosedToastVariant(null)).toBe("trade-closed");
  });
});
