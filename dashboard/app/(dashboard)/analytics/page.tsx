import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import {
  getClosedTrades,
  getLatestPortfolio,
  getPortfolioHistory,
  getSettings,
} from "@/lib/queries";

export default async function AnalyticsPage() {
  const [portfolioHistory, closedTrades, portfolio, settings] = await Promise.all([
    getPortfolioHistory(),
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
          Daily equity, P&L, trade performance, and exit attribution from live Supabase data.
        </p>
      </header>
      <AnalyticsDashboard
        portfolioHistory={portfolioHistory}
        closedTrades={closedTrades}
        currency={currency}
        initialSettings={settings}
      />
    </div>
  );
}
