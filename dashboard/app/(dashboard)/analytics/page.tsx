import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { ANALYTICS_PORTFOLIO_HISTORY_LIMIT } from "@/lib/analytics-data";
import {
  getClosedTrades,
  getLatestPortfolio,
  getPortfolioHistory,
  getSettings,
} from "@/lib/queries";

export default async function AnalyticsPage() {
  const [portfolioHistory, closedTrades, portfolio, settings] = await Promise.all([
    getPortfolioHistory(ANALYTICS_PORTFOLIO_HISTORY_LIMIT),
    getClosedTrades(),
    getLatestPortfolio(),
    getSettings(),
  ]);

  const currency = portfolio?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold sm:text-2xl">Analytics</h2>
        <p className="text-sm text-zinc-500">
          Daily equity, P&L, and trade performance refresh about every 2 minutes while this tab is
          open. Jev calibration loads only when you expand it.
        </p>
      </header>
      <AnalyticsDashboard
        portfolioHistory={portfolioHistory}
        closedTrades={closedTrades}
        currency={currency}
        settings={settings}
      />
    </div>
  );
}
