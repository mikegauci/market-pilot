import { OverviewStats } from "@/components/overview-stats";
import { OverviewStatusSection } from "@/components/overview-status-section";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PositionsTable } from "@/components/positions-table";
import { SettingsSummary } from "@/components/settings-summary";
import { TradesTable } from "@/components/trades-table";
import {
  getBotStatus,
  getLatestPortfolio,
  getPortfolioHistory,
  getPositions,
  getRecentTrades,
  getSettings,
} from "@/lib/queries";
import { resolveBaselineEquity } from "@/lib/risk-recommendations";

export default async function OverviewPage() {
  const [botStatus, portfolio, history, positions, trades, settings] = await Promise.all([
    getBotStatus(),
    getLatestPortfolio(),
    getPortfolioHistory(24),
    getPositions(),
    getRecentTrades(10),
    getSettings(),
  ]);

  const currency = portfolio?.currency ?? "USD";
  const currentEquity = portfolio?.equity ?? settings?.account_capital ?? 0;
  const baselineEquity = settings
    ? resolveBaselineEquity(
        settings.risk_sync_equity,
        currentEquity,
        settings.account_capital,
      )
    : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Overview</h2>
        {botStatus && <OverviewStatusSection botStatus={botStatus} />}
      </div>

      <OverviewStats portfolio={portfolio} positions={positions} currency={currency} />

      <div className="grid gap-4 lg:grid-cols-3">
        <PortfolioChart data={history} currency={currency} />
        {settings && (
          <SettingsSummary
            settings={settings}
            currentEquity={currentEquity}
            baselineEquity={baselineEquity}
            currency={currency}
          />
        )}
      </div>

      <PositionsTable positions={positions} />
      <TradesTable trades={trades} title="Recent Trades" />
    </div>
  );
}
