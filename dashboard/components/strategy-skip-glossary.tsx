import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { skipReasonLabel } from "@/lib/skip-reason-stats";

const GLOSSARY: { key: string; blurb: string }[] = [
  {
    key: "volume_too_low",
    blurb: "Last minute traded too lightly vs the recent average — poor liquidity.",
  },
  {
    key: "price_below_ema20",
    blurb: "Price at or below the ~20-minute trend line.",
  },
  {
    key: "ema_warming_up",
    blurb: "Not enough 1m bars yet to compute EMA-20 after open or restart.",
  },
  {
    key: "max_entries_per_symbol",
    blurb: "Daily entry cap for that symbol was reached.",
  },
  {
    key: "reentry_cooldown",
    blurb: "Still inside the post-exit wait window for that symbol.",
  },
  {
    key: "spread_too_wide",
    blurb: "Bid–ask spread too wide for a clean fill.",
  },
  {
    key: "rsi_overbought",
    blurb: "Momentum stretched — RSI above the max.",
  },
  {
    key: "benchmark_headwind",
    blurb: "Benchmark dropped sharply on the 5m window.",
  },
];

export function StrategySkipGlossary() {
  return (
    <Card>
      <CardTitle>Common skip reasons</CardTitle>
      <p className="mt-1 text-xs text-zinc-600">
        What you may see on{" "}
        <Link href="/predictions" className="text-emerald-500/80 hover:text-emerald-400">
          Predictions
        </Link>{" "}
        when Jev liked a name but the bot did not trade.
      </p>
      <ul className="mt-4 space-y-2.5">
        {GLOSSARY.map((item) => (
          <li key={item.key} className="text-xs leading-relaxed">
            <span className="font-medium text-zinc-300">{skipReasonLabel(item.key)}</span>
            <span className="text-zinc-500"> — {item.blurb}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
