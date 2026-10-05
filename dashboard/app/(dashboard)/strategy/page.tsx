import Link from "next/link";
import { LiveStrategyGrid } from "@/components/live-strategy-grid";
import { LatestPredictionsProvider } from "@/lib/latest-predictions-context";
import { StrategyGuide } from "@/components/strategy-guide";
import { getLatestPredictionsBySymbol, getSettings } from "@/lib/queries";
import { formatPercent } from "@/lib/utils";

export default async function StrategyPage() {
  const settings = await getSettings();
  const minConfidence = settings?.minimum_jev_confidence ?? 0.85;
  const recordThreshold = settings?.signal_record_threshold ?? 0.75;
  const latestPredictions = settings ? await getLatestPredictionsBySymbol() : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold sm:text-2xl">Indicators & Filters</h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          <span className="font-medium text-zinc-300">Jev</span> is the AI that scores each
          watched stock as buy, hold, or sell from live market data — the indicators below are
          the context it reads on every call.
        </p>
        <p className="text-sm leading-relaxed text-zinc-400">
          On each eval cycle, Jev returns confidence percentages for all three sides. The bot
          only opens a trade when BUY is the top signal, meets your{" "}
          <span className="text-zinc-300">min threshold</span> (
          {formatPercent(minConfidence)}), and beats HOLD by a wide enough margin. BUY signals
          between {formatPercent(recordThreshold)} and {formatPercent(minConfidence)} are logged
          on Predictions as near-misses but do not trade. After a qualifying BUY, hard safety
          checks below can still veto the entry; a strong SELL can also help close open
          positions.
        </p>
        <p className="text-xs text-zinc-600">
          Change min and record thresholds in{" "}
          <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
            Settings → Jev & signals
          </Link>
          . Min volume ratio is under{" "}
          <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
            Exits & entry filters
          </Link>
          . Outcomes appear on the{" "}
          <Link href="/predictions" className="text-emerald-500/80 hover:text-emerald-400">
            Predictions
          </Link>{" "}
          feed.
        </p>
      </header>

      {settings && (
        <LatestPredictionsProvider initial={latestPredictions}>
          <LiveStrategyGrid predictions={latestPredictions} settings={settings} />
        </LatestPredictionsProvider>
      )}

      <StrategyGuide
        benchmarkSymbol={settings?.benchmark_symbol ?? ""}
        minVolumeRatio={settings?.min_volume_ratio ?? 0}
      />
    </div>
  );
}
