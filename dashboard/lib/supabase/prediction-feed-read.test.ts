import { describe, expect, it, vi } from "vitest";
import { PREDICTION_FEED_COLUMNS } from "@/lib/prediction-columns";
import { readPredictionFeed } from "@/lib/supabase/data-reads";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("readPredictionFeed", () => {
  it("queries scalar feed columns and normalizes rows", async () => {
    const range = vi.fn().mockResolvedValue({
      data: [
        {
          id: "pred-1",
          symbol: "AAPL",
          timestamp: "2026-10-06T12:00:00Z",
          price: 100,
          buy_probability: 0.9,
          hold_probability: 0.05,
          sell_probability: 0.05,
          trade_created: false,
          trade_skip_reason: null,
          created_at: "2026-10-06T12:00:00Z",
        },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ range });
    const selectFeed = vi.fn().mockReturnValue({ order });
    const selectCount = vi.fn().mockResolvedValue({ count: 1, error: null });

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table !== "predictions") {
          throw new Error(`unexpected table ${table}`);
        }
        return {
          select: (columns: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return selectCount();
            }
            return selectFeed(columns);
          },
        };
      }),
    } as unknown as SupabaseClient;

    const { data, error } = await readPredictionFeed(supabase, 50);

    expect(error).toBeNull();
    expect(selectFeed).toHaveBeenCalledWith(PREDICTION_FEED_COLUMNS);
    expect(range).toHaveBeenCalledWith(0, 49);
    expect(data).toHaveLength(1);
    expect(data[0]?.market_snapshot).toBeNull();
  });

  it("retries once after a failed query", async () => {
    const range = vi.fn();
    range
      .mockResolvedValueOnce({
        data: null,
        error: { message: "timeout", name: "PostgrestError", code: "" },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "pred-2",
            symbol: "MSFT",
            timestamp: "2026-10-06T12:00:00Z",
            price: 50,
            buy_probability: 0.8,
            hold_probability: 0.1,
            sell_probability: 0.1,
            trade_created: false,
            trade_skip_reason: null,
            created_at: "2026-10-06T12:00:00Z",
          },
        ],
        error: null,
      });

    const order = vi.fn().mockReturnValue({ range });
    const selectFeed = vi.fn().mockReturnValue({ order });
    const selectCount = vi
      .fn()
      .mockResolvedValueOnce({ count: null, error: { message: "timeout", name: "PostgrestError", code: "" } })
      .mockResolvedValueOnce({ count: 1, error: null })
      .mockResolvedValue({ count: 1, error: null });

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: (columns: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) {
            return selectCount();
          }
          return selectFeed(columns);
        },
      }),
    } as unknown as SupabaseClient;

    const { data, error } = await readPredictionFeed(supabase, 50);

    expect(range).toHaveBeenCalledTimes(2);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]?.symbol).toBe("MSFT");
  });
});
