import { describe, expect, it } from "vitest";
import { mapCalibrationRpcRows } from "@/lib/jev-calibration-rpc";

describe("mapCalibrationRpcRows", () => {
  it("maps RPC rows to chart buckets", () => {
    const buckets = mapCalibrationRpcRows([
      {
        label: "80–90%",
        bucket_count: 12,
        avg_buy: 0.85,
        avg_return_15m: 0.42,
      },
    ]);
    expect(buckets).toEqual([
      {
        label: "80–90%",
        count: 12,
        avgBuy: 0.85,
        avgReturn15m: 0.42,
      },
    ]);
  });

  it("returns empty array for non-array input", () => {
    expect(mapCalibrationRpcRows(null)).toEqual([]);
  });
});
