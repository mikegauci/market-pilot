import { TradesTable } from "@/components/trades-table";
import { getActiveTradeCommands, getBotStatus, getTradesPageLoad } from "@/lib/queries";
import { formatIbkrAccountDisplay } from "@/lib/ibkr-account-display";
import { isTraderOnline } from "@/lib/trader-status";

export default async function TradesPage() {
  const [{ trades, tradeScope }, tradeCommands, botStatus] = await Promise.all([
    getTradesPageLoad("all"),
    getActiveTradeCommands(),
    getBotStatus(),
  ]);

  const accountDisplay = formatIbkrAccountDisplay(tradeScope.accountId);
  const usingFallback = tradeScope.source != null && tradeScope.source !== "live";
  const traderOnline = isTraderOnline(botStatus?.last_heartbeat ?? null);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold sm:text-2xl">Trades</h2>
        <p className="text-sm text-zinc-500">
          Full trade history for your paper account. Rows refresh about every 10 seconds while this
          tab is open.
        </p>
      </div>
      {usingFallback && accountDisplay ? (
        <p className="rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200/90">
          {traderOnline
            ? "Live IBKR account not reported yet"
            : "Trader offline"}
          {" — showing trades for "}
          {accountDisplay.title}
          {accountDisplay.accountId ? ` (${accountDisplay.accountId})` : ""}.
        </p>
      ) : null}
      <TradesTable
        trades={trades}
        tradeCommands={tradeCommands}
        botStatus={botStatus}
        showFilter
        showCloseAction
        defaultStatusFilter="closed"
        title="All Trades"
      />
    </div>
  );
}
