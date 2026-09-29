import Link from "next/link";
import { StrategyGuide } from "@/components/strategy-guide";
import { getSettings } from "@/lib/queries";

export default async function StrategyPage() {
  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold sm:text-2xl">Indicators & Filters</h2>
        <p className="text-sm leading-relaxed text-zinc-500">
          Before every trade, the bot gathers market signals, asks Jev for an opinion, then
          runs hard safety checks.
        </p>
        <p className="text-xs text-zinc-600">
          Configure min volume ratio in{" "}
          <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
            Settings
          </Link>
          . Filter outcomes appear on the{" "}
          <Link href="/predictions" className="text-emerald-500/80 hover:text-emerald-400">
            Predictions
          </Link>{" "}
          feed.
        </p>
      </header>

      <StrategyGuide
        benchmarkSymbol={settings?.benchmark_symbol ?? "EEM"}
        minVolumeRatio={settings?.min_volume_ratio ?? 0}
      />
    </div>
  );
}
