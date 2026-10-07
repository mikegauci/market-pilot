import { PredictionsFeed } from "@/components/predictions-feed";
import { SkipReasonAnalytics } from "@/components/skip-reason-analytics";
import { tradingDayStartUtc } from "@/lib/market-hours";
import { PREDICTION_FEED_PAGE_SIZE } from "@/lib/prediction-feed";
import { getAnalyticsPredictions, getPredictionsPage, getSettings } from "@/lib/queries";

function parsePositiveInt(value: string | string[] | undefined, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    prediction?: string | string[];
    page?: string | string[];
    symbol?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const predictionParam = params.prediction;
  const initialExpandedId = Array.isArray(predictionParam)
    ? predictionParam[0] ?? null
    : predictionParam ?? null;

  const symbolParam = params.symbol;
  const symbolFilter = Array.isArray(symbolParam) ? symbolParam[0]?.trim() : symbolParam?.trim();

  const hasExplicitPage = params.page != null && params.page !== "";
  const requestedPage = parsePositiveInt(params.page, 1);
  const sessionStartIso = tradingDayStartUtc();

  const [predictionsLoad, analyticsPredictions, settings] = await Promise.all([
    getPredictionsPage(requestedPage, PREDICTION_FEED_PAGE_SIZE, {
      symbol: symbolFilter || undefined,
      sessionStartIso,
      expandToPredictionId: initialExpandedId && !hasExplicitPage ? initialExpandedId : null,
    }),
    getAnalyticsPredictions(),
    getSettings(),
  ]);

  const recordThreshold = settings?.signal_record_threshold ?? 0.75;
  const minConfidence = settings?.minimum_jev_confidence ?? 0.85;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold sm:text-2xl">Predictions</h2>
      <PredictionsFeed
        predictions={predictionsLoad.predictions}
        loadError={predictionsLoad.loadError}
        analyticsCount={analyticsPredictions.length}
        initialExpandedId={initialExpandedId}
        page={predictionsLoad.page}
        pageSize={predictionsLoad.pageSize}
        totalCount={predictionsLoad.totalCount}
        sessionStartIso={predictionsLoad.sessionStartIso}
        symbolFilter={symbolFilter || ""}
        symbolOptions={predictionsLoad.symbols}
        filterOptions={
          settings
            ? {
                minVolumeRatio: settings.min_volume_ratio,
                minSharePrice: settings.min_share_price,
                benchmarkSymbol: settings.benchmark_symbol,
                entryEmaGate: settings.entry_ema_gate,
              }
            : {}
        }
      />
      <SkipReasonAnalytics
        predictions={analyticsPredictions}
        recordThreshold={recordThreshold}
        minConfidence={minConfidence}
        sessionStartIso={sessionStartIso}
      />
    </div>
  );
}
