import { OverviewStats } from "@/components/overview-stats";
import { OverviewStatusSection } from "@/components/overview-status-section";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PositionsTable } from "@/components/positions-table";
import { SettingsSummary } from "@/components/settings-summary";
import { TradedPredictionsTable } from "@/components/traded-predictions-table";
import { TradesTable } from "@/components/trades-table";
import {
  getActiveTradeCommands,
  getBotStatus,
  getLatestPortfolio,
  getOpenTrades,
  getPortfolioHistory,
  getPositions,
  getRecentTrades,
  getSettings,
  getTradedPredictions,
} from "@/lib/queries";
import { resolveBaselineEquity } from "@/lib/risk-recommendations";
export default async function OverviewPage() {
  const [
    botStatus,
    portfolio,
    history,
    positions,
    openTrades,
    tradeCommands,
    trades,
    tradedPredictions,
    settings,
  ] = await Promise.all([
    getBotStatus(),
    getLatestPortfolio(),
    getPortfolioHistory(24),
    getPositions(),
    getOpenTrades(),
    getActiveTradeCommands(),
    getRecentTrades(10),
    getTradedPredictions(10),
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
        <h2 className="text-xl font-semibold sm:text-2xl">Overview</h2>
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

      <PositionsTable
        positions={positions}
        openTrades={openTrades}
        tradeCommands={tradeCommands}
        botStatus={
          botStatus ?? {
            id: 1,
            enabled: false,
            trading_mode: "paper",
            execution_mode: "simulated",
            ibkr_connected: false,
            jev_connected: false,
            last_heartbeat: null,
            last_error: null,
            updated_at: "",
          }
        }
      />
      <TradedPredictionsTable predictions={tradedPredictions} trades={trades} />
      <TradesTable
        trades={trades}
        tradeCommands={tradeCommands}
        botStatus={botStatus}
        showCloseAction
        title="Recent Trades"
      />
    </div>
  );
}
