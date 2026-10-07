import "server-only";

import OpenAI from "openai";
import { makeParseableTextFormat } from "openai/lib/parser";
import { openAiBriefModel, requireOpenAiKey } from "@/lib/session-brief/openai.server";
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
- When profit_take_path is present and profit_take_enabled, add one short sentence in exit_story:
  whether max_path_progress_pct reached the early Soft Sell band (early_exit_band_path_pct min–max),
  using reached_early_exit_min and entered_early_exit_band; mention band_touch_cycles vs
  min_band_hits_required when early exit did not fire. Plain words: "path to take profit".
- verdict: one sentence sanity-check (worked as designed / stopped out / still open).
- Do not promise profit or suggest live trading.`;

const tradeRecapTextFormat = makeParseableTextFormat(
  {
    type: "json_schema",
    name: "trade_recap",
    schema: TRADE_RECAP_JSON_SCHEMA,
    strict: true,
  },
  parseTradeRecapText,
);

export async function generateTradeRecap(
  packet: TradeRecapPacket,
): Promise<{ recap: TradeRecap; model: string }> {
  const client = new OpenAI({ apiKey: requireOpenAiKey() });
  const model = openAiBriefModel();

  const response = await client.responses.parse({
    model,
    max_output_tokens: 700,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(packet) },
    ],
    text: { format: tradeRecapTextFormat },
  });

  if (response.error) {
    throw new Error(response.error.message ?? "OpenAI request failed.");
  }

  const recap = response.output_parsed;
  if (!recap) {
    throw new Error("OpenAI did not return a trade recap. Try again.");
  }

  return { recap, model };
}
