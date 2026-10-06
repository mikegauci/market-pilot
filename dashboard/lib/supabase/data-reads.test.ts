import { describe, expect, it, vi } from "vitest";
import { readSettings } from "@/lib/supabase/data-reads";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("readSettings", () => {
  it("normalizes partial settings rows like server getSettings", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 1,
                trading_mode: "paper",
                minimum_jev_confidence: 0.8,
                signal_record_threshold: 0.5,
                risk_per_trade: 1,
                max_position_size: 100,
                max_daily_loss: 10,
                max_open_positions: 5,
                stop_loss_percentage: 0.01,
                take_profit_percentage: 0.02,
                max_hold_minutes: 0,
                min_volume_ratio: 0,
                account_capital: 1000,
                risk_sync_equity: null,
                watchlist: [],
                benchmark_symbol: null,
                updated_at: "",
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const { data, error } = await readSettings(supabase);
    expect(error).toBeNull();
    expect(data?.min_share_price).toBe(20);
    expect(data?.confirmation_cycles).toBe(2);
  });
});
