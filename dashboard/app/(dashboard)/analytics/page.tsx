import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { ANALYTICS_PORTFOLIO_HISTORY_LIMIT } from "@/lib/analytics-data";
import { lookbackDaysForRange } from "@/lib/favorable-sessions";
import {
  getClosedTrades,
  getFavorableSessionDays,
  getLatestPortfolio,
  getPortfolioHistory,
  getSettings,
} from "@/lib/queries";

export default async function AnalyticsPage() {
  const [portfolioHistory, closedTrades, portfolio, settings, favorableSessions] =
    await Promise.all([
      getPortfolioHistory(ANALYTICS_PORTFOLIO_HISTORY_LIMIT),
      getClosedTrades(),
      getLatestPortfolio(),
      getSettings(),
      getFavorableSessionDays(lookbackDaysForRange("1d")),
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
        favorableSessions={favorableSessions}
      />
    </div>
  );
}
