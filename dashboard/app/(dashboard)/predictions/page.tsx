import { PredictionsFeed } from "@/components/predictions-feed";
import { SkipReasonAnalytics } from "@/components/skip-reason-analytics";
import { getAnalyticsPredictions, getPredictions, getSettings } from "@/lib/queries";

export default async function PredictionsPage() {
  const [predictions, analyticsPredictions, settings] = await Promise.all([
    getPredictions(50),
    getAnalyticsPredictions(),
    getSettings(),
  ]);

  const recordThreshold = settings?.signal_record_threshold ?? 0.75;
  const minConfidence = settings?.minimum_jev_confidence ?? 0.85;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold sm:text-2xl">Predictions</h2>
      <SkipReasonAnalytics
        predictions={analyticsPredictions}
        recordThreshold={recordThreshold}
        minConfidence={minConfidence}
      />
      <PredictionsFeed
        predictions={predictions}
        filterOptions={{
          minVolumeRatio: settings?.min_volume_ratio,
          benchmarkSymbol: settings?.benchmark_symbol,
        }}
      />
    </div>
  );
}
