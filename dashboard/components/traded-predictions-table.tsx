"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchRecentTrades, fetchTradedPredictions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import type { Prediction, Trade } from "@/lib/types/database";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/utils";

type Props = {
  predictions: Prediction[];
  trades: Trade[];
  limit?: number;
};

function findTradeForPrediction(prediction: Prediction, trades: Trade[]): Trade | undefined {
  const predictionTime = new Date(prediction.timestamp).getTime();
  return trades.find((trade) => {
    if (trade.symbol !== prediction.symbol) return false;
    const entryTime = new Date(trade.entry_time).getTime();
    return Math.abs(entryTime - predictionTime) < 5_000;
  });
}

function TradeOutcomeBadge({ trade }: { trade: Trade | undefined }) {
  if (!trade) {
    return <Badge className="bg-zinc-800 text-zinc-400">traded</Badge>;
  }

  if (trade.status === "open") {
    return <Badge className="bg-emerald-900 text-emerald-300">open</Badge>;
  }

  const pnl = trade.net_pnl ?? 0;
  const profitable = pnl >= 0;
  return (
    <Badge className={profitable ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}>
      closed {formatCurrency(pnl)}
    </Badge>
  );
}

export function TradedPredictionsTable({ predictions, trades, limit = 10 }: Props) {
  const fetchPredictions = useCallback(() => fetchTradedPredictions(limit), [limit]);
  const fetchTrades = useCallback(() => fetchRecentTrades(50), []);
  const livePredictions = useLiveQuery(predictions, fetchPredictions, ["predictions"]);
  const liveTrades = useLiveQuery(trades, fetchTrades, ["trades"]);
  const tradesByPrediction = useMemo(
    () =>
      new Map(
        livePredictions.map((prediction) => [
          prediction.id,
          findTradeForPrediction(prediction, liveTrades),
        ]),
      ),
    [livePredictions, liveTrades],
  );

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Signals That Opened Trades</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Predictions that opened a real IBKR order — check outcome for open vs closed
          </p>
        </div>
        <Link
          href="/predictions"
          className="text-xs text-emerald-400 hover:text-emerald-300"
        >
          All predictions →
        </Link>
      </div>
      {livePredictions.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          No trades opened from predictions yet. Enable the bot and wait for a confirmed
          signal above your confidence threshold.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Symbol</th>
                <th className="pb-2 pr-3">Price</th>
                <th className="pb-2 pr-3">BUY</th>
                <th className="pb-2 pr-3">HOLD</th>
                <th className="pb-2 pr-3">SELL</th>
                <th className="pb-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {livePredictions.map((p) => {
                const trade = tradesByPrediction.get(p.id);
                return (
                  <tr key={p.id} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-3 text-zinc-400">{formatDateTime(p.timestamp)}</td>
                    <td className="py-2 pr-3 font-medium">{p.symbol}</td>
                    <td className="py-2 pr-3">{formatCurrency(p.price)}</td>
                    <td className="py-2 pr-3 text-emerald-400">
                      {formatPercent(p.buy_probability)}
                    </td>
                    <td className="py-2 pr-3 text-zinc-300">
                      {formatPercent(p.hold_probability)}
                    </td>
                    <td className="py-2 pr-3 text-red-400">
                      {formatPercent(p.sell_probability)}
                    </td>
                    <td className="py-2">
                      <div className="space-y-1">
                        <TradeOutcomeBadge trade={trade} />
                        {trade?.exit_time && (
                          <p className="text-[11px] text-zinc-500">
                            Exited {formatDateTime(trade.exit_time)}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
