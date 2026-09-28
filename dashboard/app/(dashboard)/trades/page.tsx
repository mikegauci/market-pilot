import { TradesTable } from "@/components/trades-table";
import { getAllTrades } from "@/lib/queries";

export default async function TradesPage() {
  const trades = await getAllTrades("all");

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Trades</h2>
      <TradesTable trades={trades} showFilter title="All Trades" />
    </div>
  );
}
