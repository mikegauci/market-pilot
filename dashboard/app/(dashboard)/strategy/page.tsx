import Link from "next/link";
import { LiveStrategyGrid } from "@/components/live-strategy-grid";
import { ScenarioPlayer } from "@/components/strategy-scenarios/scenario-player";
import { Card, CardTitle } from "@/components/ui/card";
import { LatestPredictionsProvider } from "@/lib/latest-predictions-context";
import { StrategyGuide } from "@/components/strategy-guide";
import { StrategySkipGlossary } from "@/components/strategy-skip-glossary";
import { TradeDecisionFlow } from "@/components/strategy-diagrams";
import { getLatestPredictionsBySymbol, getSettings } from "@/lib/queries";
import { buildScenarios } from "@/lib/strategy-scenarios";
import { formatPercent } from "@/lib/utils";

export default async function StrategyPage() {
  const [settings, latestPredictions] = await Promise.all([
    getSettings(),
    getLatestPredictionsBySymbol(),
  ]);
  const minConfidence = settings?.minimum_jev_confidence ?? 0.85;
  const recordThreshold = settings?.signal_record_threshold ?? 0.75;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold sm:text-2xl">Strategy</h2>
          <p className="text-sm leading-relaxed text-zinc-400">
            <span className="font-medium text-zinc-300">Jev</span> scores each watched stock as
            buy, hold, or sell. Hard filters and risk caps decide whether a strong BUY becomes a
            trade — everything else is logged on Predictions with a skip reason.
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/25 px-4 py-4">
          <p className="text-xs font-medium text-zinc-300">Decision path</p>
          <div className="mt-3">
            <TradeDecisionFlow />
          </div>
        </div>

        <div className="space-y-2 text-sm leading-relaxed text-zinc-400">
          <p>
            Opens require BUY on top, at least{" "}
            <span className="text-zinc-300">{formatPercent(minConfidence)}</span> confidence, and a
            wide enough margin over HOLD. Signals between{" "}
            {formatPercent(recordThreshold)} and {formatPercent(minConfidence)} are near-misses
            only.
          </p>
          <p className="text-xs text-zinc-600">
            Thresholds:{" "}
            <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
              Settings → Jev & signals
            </Link>
            ,{" "}
            <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
              Exits & entry filters
            </Link>
            ,{" "}
            <Link href="/settings" className="text-emerald-500/80 hover:text-emerald-400">
              Watchlist
            </Link>
            . Outcomes:{" "}
            <Link href="/predictions" className="text-emerald-500/80 hover:text-emerald-400">
              Predictions
            </Link>
            .
          </p>
        </div>
      </header>

      {settings ? (
        <Card>
          <CardTitle>See it in action</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Step through worked examples of how your settings play out, from a breakout to a
            trade or a skip.
          </p>
          <div className="mt-4">
            <ScenarioPlayer scenarios={buildScenarios(settings)} />
          </div>
        </Card>
      ) : null}

      {settings && (
        <LatestPredictionsProvider initial={latestPredictions}>
          <LiveStrategyGrid predictions={latestPredictions} settings={settings} />
        </LatestPredictionsProvider>
      )}

      <StrategySkipGlossary settings={settings} />

      <StrategyGuide settings={settings} benchmarkSymbol={settings?.benchmark_symbol ?? ""} />
    </div>
  );
}
