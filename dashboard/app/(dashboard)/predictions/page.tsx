import { PredictionsFeed } from "@/components/predictions-feed";
import { SkipReasonAnalytics } from "@/components/skip-reason-analytics";
import { getAnalyticsPredictions, getPredictions, getSettings } from "@/lib/queries";

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: Promise<{ prediction?: string | string[] }>;
}) {
  const params = await searchParams;
  const predictionParam = params.prediction;
  const initialExpandedId = Array.isArray(predictionParam)
    ? predictionParam[0] ?? null
    : predictionParam ?? null;
  const predictionsLimit = initialExpandedId ? 200 : 50;

  const [predictions, analyticsPredictions, settings] = await Promise.all([
    getPredictions(predictionsLimit),
    getAnalyticsPredictions(),
    getSettings(),
  ]);

  const recordThreshold = settings?.signal_record_threshold ?? 0.75;
  const minConfidence = settings?.minimum_jev_confidence ?? 0.85;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold sm:text-2xl">Predictions</h2>
      <PredictionsFeed
        predictions={predictions}
        initialExpandedId={initialExpandedId}
        limit={predictionsLimit}
        filterOptions={{
          minVolumeRatio: settings?.min_volume_ratio,
          minSharePrice: settings?.min_share_price,
          benchmarkSymbol: settings?.benchmark_symbol,
        }}
      />
      <SkipReasonAnalytics
        predictions={analyticsPredictions}
        recordThreshold={recordThreshold}
        minConfidence={minConfidence}
      />
    </div>
  );
}
