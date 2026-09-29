import { OverviewStats } from "@/components/overview-stats";
import { PositionsGrid } from "@/components/positions-grid";
import { SettingsSummary } from "@/components/settings-summary";
import { TradesTable } from "@/components/trades-table";
import {
  getActiveTradeCommands,
  getBotStatus,
  getLatestPortfolio,
  getOpenTrades,
  getPositions,
  getRecentTrades,
  getSettings,
} from "@/lib/queries";
import { resolveBaselineEquity } from "@/lib/risk-recommendations";
export default async function OverviewPage() {
  const [
    botStatus,
    portfolio,
    positions,
    openTrades,
    tradeCommands,
    trades,
    settings,
  ] = await Promise.all([
    getBotStatus(),
    getLatestPortfolio(),
    getPositions(),
    getOpenTrades(),
    getActiveTradeCommands(),
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
      <h2 className="text-xl font-semibold sm:text-2xl">Overview</h2>

      <div className="grid grid-cols-1 gap-4 items-stretch sm:grid-cols-2">
        <OverviewStats portfolio={portfolio} positions={positions} currency={currency} />
        {settings && (
          <SettingsSummary
            settings={settings}
            currentEquity={currentEquity}
            baselineEquity={baselineEquity}
            currency={currency}
          />
        )}
      </div>

      <PositionsGrid
        positions={positions}
        openTrades={openTrades}
        tradeCommands={tradeCommands}
        settings={settings}
        botStatus={
          botStatus ?? {
            id: 1,
            enabled: false,
            trading_mode: "paper",
            execution_mode: "ibkr",
            ibkr_connected: false,
            jev_connected: false,
            last_heartbeat: null,
            last_error: null,
            updated_at: "",
          }
        }
      />

      <TradesTable
        trades={trades}
        tradeCommands={tradeCommands}
        botStatus={botStatus}
        showCloseAction
        showSignalColumn
        showViewAllLink
        showChartExpand={false}
        title="Recent Trades"
      />
    </div>
  );
}
