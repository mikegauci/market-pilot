import { PredictionsFeed } from "@/components/predictions-feed";
import { getPredictions } from "@/lib/queries";

export default async function PredictionsPage() {
  const predictions = await getPredictions(50);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Predictions</h2>
      <PredictionsFeed predictions={predictions} />
    </div>
  );
}
