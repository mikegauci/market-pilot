import "server-only";

import { runStructured } from "@/lib/openai/structured.server";
import type { TradeRecapPacket } from "@/lib/trade-recap/packet";
import {
  parseTradeRecapText,
  TRADE_RECAP_JSON_SCHEMA,
  type TradeRecap,
} from "@/lib/trade-recap/schema";

const SYSTEM_PROMPT = `You recap one bot trade for a dashboard user new to trading bots.

Rules:
- Plain language. Use "the bot" and "Jev". Percents in JSON are already percent.
- entry_story: why the bot opened (Jev buy % at entry if present).
- exit_story: how it closed or what would close it; use exit_reason_label when closed.
- When net_pnl is negative and in_trade_peak is present, add one short sentence in exit_story:
  the trade was briefly in the green before it closed at a loss — use peak_pct_from_entry (already
  percent), peak_pct_of_take_profit_path (percent of the way from entry to take profit), and
  peak_unrealized_dollars. Do not imply the bot should have exited at the peak.
- When profit_take_path is present and profit_take_enabled, add one short sentence in exit_story
  about early Soft Sell path progress. If never_reached_profit_on_path is true, say the trade never
  moved into profit on the way toward take profit (never say "reached 0%" or "0% path"). Otherwise
  use max_path_progress_pct vs early_exit_band_path_pct (min–max), reached_early_exit_min,
  entered_early_exit_band, and band_touch_cycles vs min_band_hits_required when early exit did not fire.
- When loss_cut_path is present and loss_cut_enabled: if never_went_underwater_on_stop_path is false,
  add one short sentence in exit_story (even when net_pnl is positive) with max_stop_path_progress_pct
  — how far toward the hard stop it dipped — vs early_loss_cut_band_path_pct and band touches vs
  required. If never_went_underwater_on_stop_path is true, say briefly that price stayed at or above
  entry (no drawdown toward stop). Never say "reached 0%" toward stop.
- verdict: one sentence sanity-check (worked as designed / stopped out / still open).
- Do not promise profit or suggest live trading.`;

export async function generateTradeRecap(
  packet: TradeRecapPacket,
): Promise<{ recap: TradeRecap; model: string }> {
  const { output, model } = await runStructured({
    name: "trade_recap",
    schema: TRADE_RECAP_JSON_SCHEMA,
    parse: parseTradeRecapText,
    system: SYSTEM_PROMPT,
    packet,
    maxOutputTokens: 700,
    outputLabel: "a trade recap",
  });
  return { recap: output, model };
}
