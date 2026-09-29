"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ClosePositionButton } from "@/components/close-position-button";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import { Card, CardTitle } from "@/components/ui/card";
import { overlaysForPosition } from "@/lib/chart-overlays";
import { fetchActiveTradeCommands, fetchOpenTrades, fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { useTraderOnline } from "@/lib/hooks/use-trader-online";
import { tradeForPosition } from "@/lib/trade-matching";
import { isOffEffectiveWatchlist } from "@/lib/demotion";
import type { BotStatus, Position, Settings, Trade, TradeCommand } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

type Props = {
  positions: Position[];
  openTrades: Trade[];
  tradeCommands: TradeCommand[];
  botStatus: BotStatus;
  settings?: Settings | null;
};

export function PositionsTable({
  positions,
  openTrades,
  tradeCommands,
  botStatus,
  settings,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const traderOnline = useTraderOnline(botStatus);
  const fetchList = useCallback(() => fetchPositions(), []);
  const fetchTrades = useCallback(() => fetchOpenTrades(), []);
  const fetchCommands = useCallback(() => fetchActiveTradeCommands(), []);

  const livePositions = useLiveQuery(positions, fetchList, ["positions"]);
  const liveOpenTrades = useLiveQuery(openTrades, fetchTrades, ["trades"]);
  const liveCommands = useLiveQuery(tradeCommands, fetchCommands, ["trade_commands"]);

  const commandByTradeId = useMemo(() => {
    const map = new Map<string, TradeCommand>();
    for (const command of liveCommands) {
      if (!map.has(command.trade_id)) {
        map.set(command.trade_id, command);
      }
    }
    return map;
  }, [liveCommands]);

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

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
                <th className="pb-2 w-8" />
                <th className="pb-2 pr-4">Symbol</th>
                <th className="pb-2 pr-4">Qty</th>
                <th className="pb-2 pr-4">Avg</th>
                <th className="pb-2 pr-4">Price</th>
                <th className="pb-2 pr-4">Unrealized</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {livePositions.map((p) => {
                const trade = tradeForPosition(p, liveOpenTrades);
                const command = trade ? commandByTradeId.get(trade.id) : undefined;
                const pending =
                  command?.status === "pending" || command?.status === "processing";
                const failed = command?.status === "failed";
                const isExpanded = expandedId === p.id;

                return (
                  <Fragment key={p.id}>
                    <tr className="border-b border-zinc-800/50">
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(p.id)}
                          className="text-zinc-500 hover:text-zinc-300"
                          aria-label={isExpanded ? "Collapse chart" : "Expand chart"}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="py-2 pr-4 font-medium">
                        <span className="inline-flex items-center gap-2">
                          {p.symbol}
                          {settings && isOffEffectiveWatchlist(p.symbol, settings) && (
                            <span
                              className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400"
                              title="Open position no longer on the effective top-N watchlist; tighter exit rules apply"
                            >
                              Demoted
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 pr-4">{p.quantity}</td>
                      <td className="py-2 pr-4">{formatCurrency(p.avg_cost)}</td>
                      <td className="py-2 pr-4">{formatCurrency(p.market_price)}</td>
                      <td
                        className={`py-2 pr-4 ${
                          (p.unrealized_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {formatCurrency(p.unrealized_pnl)}
                      </td>
                      <td className="py-2">
                        {trade ? (
                          <ClosePositionButton
                            tradeId={trade.id}
                            symbol={p.symbol}
                            traderOnline={traderOnline}
                            pending={pending}
                            failed={failed}
                            errorMessage={command?.error}
                          />
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-zinc-800/50 bg-zinc-900/40">
                        <td />
                        <td colSpan={6} className="py-3 pr-3">
                          <SymbolChartPanel
                            symbol={p.symbol}
                            overlays={overlaysForPosition(p, trade)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
