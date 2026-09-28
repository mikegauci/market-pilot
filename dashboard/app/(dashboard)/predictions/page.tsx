import { PredictionsFeed } from "@/components/predictions-feed";
import { getPredictions } from "@/lib/queries";

export default async function PredictionsPage() {
  const predictions = await getPredictions(50);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold sm:text-2xl">Predictions</h2>
      <PredictionsFeed predictions={predictions} />
    </div>
  );
}
