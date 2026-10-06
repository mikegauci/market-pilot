import { LatestPredictionsProvider } from "@/lib/latest-predictions-context";
import { MarketConditionCard } from "@/components/market-condition-card";
import { OverviewWatchlistCard } from "@/components/overview-watchlist-card";
import { OverviewStats } from "@/components/overview-stats";
import { PositionsGrid } from "@/components/positions-grid";
import { TradesTable } from "@/components/trades-table";
import { tradingDayStartUtc } from "@/lib/market-hours";
import {
  getActivePositionCommands,
  getActiveTradeCommands,
  getBotStatus,
  getLatestPortfolio,
  getLatestPredictionsBySymbol,
  getOpenTrades,
  getPositions,
  getTradesForTradingDay,
  getSettings,
} from "@/lib/queries";

export default async function OverviewPage() {
  const tradingDayStartIso = tradingDayStartUtc();

  const [
    botStatus,
    portfolio,
    positions,
    openTrades,
    tradeCommands,
    positionCommands,
    trades,
    settings,
    predictions,
  ] = await Promise.all([
    getBotStatus(),
    getLatestPortfolio(),
    getPositions(),
    getOpenTrades(),
    getActiveTradeCommands(),
    getActivePositionCommands(),
    getTradesForTradingDay(tradingDayStartIso),
    getSettings(),
    getLatestPredictionsBySymbol(),
  ]);

  const currency = portfolio?.currency ?? "USD";

  return (
    <LatestPredictionsProvider initial={predictions}>
      <div className="space-y-6">
        <h2 className="text-xl font-semibold sm:text-2xl">Overview</h2>

        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <OverviewStats portfolio={portfolio} positions={positions} currency={currency} />
          <MarketConditionCard
            predictions={predictions}
            settings={settings}
            openSymbols={openTrades.map((trade) => trade.symbol)}
          />
          {settings ? <OverviewWatchlistCard settings={settings} /> : null}
        </div>

        <PositionsGrid
        positions={positions}
        openTrades={openTrades}
        tradeCommands={tradeCommands}
        positionCommands={positionCommands}
        settings={settings}
      />

      <TradesTable
        trades={trades}
        tradeCommands={tradeCommands}
        botStatus={botStatus}
        showCloseAction
        showSignalColumn
        showViewAllLink
        showChartExpand={false}
        title="Today's Trades"
        tradingDayStartIso={tradingDayStartIso}
      />
      </div>
    </LatestPredictionsProvider>
  );
}
