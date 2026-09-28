import { TradesTable } from "@/components/trades-table";
import { getActiveTradeCommands, getAllTrades, getBotStatus } from "@/lib/queries";

export default async function TradesPage() {
  const [trades, tradeCommands, botStatus] = await Promise.all([
    getAllTrades("all"),
    getActiveTradeCommands(),
    getBotStatus(),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold sm:text-2xl">Trades</h2>
      <TradesTable
        trades={trades}
        tradeCommands={tradeCommands}
        botStatus={botStatus}
        showFilter
        showCloseAction
        title="All Trades"
      />
    </div>
  );
}
