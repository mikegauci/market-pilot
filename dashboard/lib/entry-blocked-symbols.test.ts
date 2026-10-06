import { describe, expect, it } from "vitest";
import {
  mergeEntryBlockedSymbols,
  removeEntryBlockedSymbol,
} from "@/lib/entry-blocked-symbols";

describe("entry-blocked-symbols", () => {
  it("merges uppercase unique symbols", () => {
    expect(mergeEntryBlockedSymbols(["isrg"], ["ISRG", "nvda"])).toEqual([
      "ISRG",
      "NVDA",
    ]);
  });

  it("removes a blocked symbol", () => {
    expect(removeEntryBlockedSymbol(["ISRG", "NVDA"], "isrg")).toEqual(["NVDA"]);
  });
});
