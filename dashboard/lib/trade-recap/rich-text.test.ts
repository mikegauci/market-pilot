import { describe, expect, it } from "vitest";
import {
  classForRecapPercent,
  recapHeadlineClass,
  styleRecapToken,
} from "@/lib/trade-recap/rich-text";

describe("trade recap rich text", () => {
  it("colors headline from net PnL", () => {
    expect(recapHeadlineClass(-17.45)).toContain("red");
    expect(recapHeadlineClass(9.14)).toContain("emerald");
  });

  it("colors take-profit path percent as profit", () => {
    expect(classForRecapPercent("The path to take profit reached ")).toContain("emerald");
  });

  it("colors stop path percent as loss", () => {
    expect(classForRecapPercent("It drew down 58% of the way toward the hard stop")).toContain(
      "red",
    );
  });

  it("marks net loss phrase as loss", () => {
    expect(styleRecapToken("net loss of $17.45", "", undefined)).toBe("loss");
  });

  it("keeps exit band ranges neutral", () => {
    expect(styleRecapToken("65-99%", "band of ", undefined)).toBe("neutral");
    expect(styleRecapToken("99%", "band of 65-", undefined)).toBe("neutral");
  });
});
