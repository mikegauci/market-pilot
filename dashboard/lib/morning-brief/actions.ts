"use server";

import { OPENAI_COOLDOWN_MS } from "@/lib/openai-action-cooldown";
import {
  isAiActionFailure,
  loadSettingsForAi,
  withAiAction,
} from "@/lib/openai/with-ai-action.server";
import { buildMorningBriefPacket, MORNING_BRIEF_WINDOW_HOURS } from "@/lib/morning-brief/packet";
import { generateMorningBriefFromPacket } from "@/lib/morning-brief/openai.server";
import { constrainMorningBrief, type MorningBrief } from "@/lib/morning-brief/schema";
import type { MarketNewsRow } from "@/lib/types/database";

export type GenerateMorningBriefResult =
  | { ok: true; brief: MorningBrief; generatedAt: string }
  | { ok: false; error: string };

export async function generateMorningBrief(): Promise<GenerateMorningBriefResult> {
  return withAiAction<GenerateMorningBriefResult>(
    {
      signInMessage: "Sign in to generate a morning brief.",
      cooldown: { key: "morning-brief", ms: OPENAI_COOLDOWN_MS.morningBrief },
    },
    async ({ supabase }) => {
      const settings = await loadSettingsForAi(supabase);
      if (isAiActionFailure(settings)) return settings;

      const since = new Date(Date.now() - MORNING_BRIEF_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
      const { data: newsRows, error: newsError } = await supabase
        .from("market_news")
        .select("headline, related_symbols, published_at, sentiment, tags")
        .gte("published_at", since)
        .order("published_at", { ascending: false })
        .limit(100);

      if (newsError) {
        return { ok: false, error: newsError.message };
      }

      const now = new Date();
      const packet = buildMorningBriefPacket({
        settings,
        articles: (newsRows ?? []) as MarketNewsRow[],
        now,
      });

      const result = await generateMorningBriefFromPacket(packet);
      const allowed = new Set(packet.watchlist.map((row) => row.symbol));
      return {
        ok: true,
        brief: constrainMorningBrief(result.brief, allowed),
        generatedAt: now.toISOString(),
      };
    },
  );
}
