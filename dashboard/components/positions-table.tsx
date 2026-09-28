"use client";

import { useCallback } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { Position } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

export function PositionsTable({ positions }: { positions: Position[] }) {
  const fetchList = useCallback(() => fetchPositions(), []);
  const livePositions = useLiveQuery(positions, fetchList, ["positions"]);

  return (
    <Card>
      <CardTitle>Open Positions ({livePositions.length})</CardTitle>
      {livePositions.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No open positions</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 pr-4">Symbol</th>
                <th className="pb-2 pr-4">Qty</th>
                <th className="pb-2 pr-4">Avg</th>
                <th className="pb-2 pr-4">Price</th>
                <th className="pb-2">Unrealized</th>
              </tr>
            </thead>
            <tbody>
              {livePositions.map((p) => (
                <tr key={p.id} className="border-b border-zinc-800/50">
                  <td className="py-2 pr-4 font-medium">{p.symbol}</td>
                  <td className="py-2 pr-4">{p.quantity}</td>
                  <td className="py-2 pr-4">{formatCurrency(p.avg_cost)}</td>
                  <td className="py-2 pr-4">{formatCurrency(p.market_price)}</td>
                  <td
                    className={`py-2 ${
                      (p.unrealized_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {formatCurrency(p.unrealized_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
