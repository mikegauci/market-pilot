import { describe, expect, it, vi } from "vitest";
import { PREDICTION_FEED_SELECT } from "@/lib/prediction-columns";
import { readPredictionFeed } from "@/lib/supabase/data-reads";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("readPredictionFeed", () => {
  it("queries feed columns and normalizes news into market_snapshot", async () => {
    const select = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
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
              news_sentiment: 0.2,
              news_top_headline: "Test headline",
              news_tags: ["earnings"],
            },
          ],
          error: null,
        }),
      }),
    });

    const supabase = {
      from: vi.fn().mockReturnValue({ select }),
    } as unknown as SupabaseClient;

    const { data, error } = await readPredictionFeed(supabase, 50);

    expect(error).toBeNull();
    expect(select).toHaveBeenCalledWith(PREDICTION_FEED_SELECT);
    expect(data).toHaveLength(1);
    expect(data[0]?.market_snapshot).toEqual({
      news_sentiment: 0.2,
      news_top_headline: "Test headline",
      news_tags: ["earnings"],
    });
  });
});
