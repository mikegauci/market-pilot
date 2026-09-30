import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import {
  getAnalyticsPredictions,
  getClosedTrades,
  getLatestPortfolio,
  getPortfolioHistory,
  getRecentDecisionLogs,
  getSignalForwardReturns,
} from "@/lib/queries";

export default async function AnalyticsPage() {
  const [
    portfolioHistory,
    closedTrades,
    portfolio,
    predictions,
    forwardReturns,
    decisionLogs,
  ] = await Promise.all([
    getPortfolioHistory(),
    getClosedTrades(),
    getLatestPortfolio(),
    getAnalyticsPredictions(2000),
    getSignalForwardReturns(2000),
    getRecentDecisionLogs(500),
  ]);

  const currency = portfolio?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold sm:text-2xl">Analytics</h2>
        <p className="text-sm text-zinc-500">
          Performance, calibration, and execution quality from live Supabase data.
          Paper mode by default — probabilities are not claimed edge until calibration is reliable.
        </p>
      </header>
      <AnalyticsDashboard
        portfolioHistory={portfolioHistory}
        closedTrades={closedTrades}
        predictions={predictions}
        forwardReturns={forwardReturns}
        decisionLogs={decisionLogs}
        currency={currency}
      />
    </div>
  );
}
