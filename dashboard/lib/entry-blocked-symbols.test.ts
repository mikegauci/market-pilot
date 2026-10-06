import { describe, expect, it } from "vitest";
import {
  clearEntryBlockedAt,
  mergeEntryBlockedSymbols,
  removeEntryBlockedSymbol,
  stampEntryBlockedAt,
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

  it("stamps and clears blocked-at timestamps", () => {
    const stamped = stampEntryBlockedAt({}, ["isrg"], "2026-01-01T00:00:00.000Z");
    expect(stamped.ISRG).toBe("2026-01-01T00:00:00.000Z");
    expect(clearEntryBlockedAt(stamped, "ISRG")).toEqual({});
  });
});
