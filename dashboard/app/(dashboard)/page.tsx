import { BotToggle } from "@/components/bot-toggle";
import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PositionsTable } from "@/components/positions-table";
import { LiveStatus } from "@/components/live-status";
import { TradesTable } from "@/components/trades-table";
import {
  getBotStatus,
  getLatestPortfolio,
  getPortfolioHistory,
  getPositions,
  getRecentTrades,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export default async function OverviewPage() {
  const [botStatus, portfolio, history, positions, trades] = await Promise.all([
    getBotStatus(),
    getLatestPortfolio(),
    getPortfolioHistory(24),
    getPositions(),
    getRecentTrades(10),
  ]);

  const currency = portfolio?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Overview</h2>
          {botStatus && (
            <div className="mt-3">
              <LiveStatus status={botStatus} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <span className="text-sm text-zinc-400">Trading bot</span>
          <BotToggle enabled={botStatus?.enabled ?? false} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardTitle>Equity</CardTitle>
          <CardValue>{formatCurrency(portfolio?.equity, currency)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Daily P&L</CardTitle>
          <CardValue
            className={
              (portfolio?.daily_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
            }
          >
            {formatCurrency(portfolio?.daily_pnl, currency)}
          </CardValue>
        </Card>
        <Card>
          <CardTitle>Total P&L</CardTitle>
          <CardValue
            className={
              (portfolio?.total_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
            }
          >
            {formatCurrency(portfolio?.total_pnl, currency)}
          </CardValue>
        </Card>
        <Card>
          <CardTitle>Open Positions</CardTitle>
          <CardValue>{positions.length}</CardValue>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PortfolioChart data={history} currency={currency} />
      </div>

      <PositionsTable positions={positions} />
      <TradesTable trades={trades} title="Recent Trades" />
    </div>
  );
}
