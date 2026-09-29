"use client";

import { useCallback, useMemo } from "react";
import { ClosePositionButton } from "@/components/close-position-button";
import { PositionRiskGauge } from "@/components/position-risk-gauge";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import { Card, CardTitle } from "@/components/ui/card";
import { overlaysForPosition } from "@/lib/chart-overlays";
import { isOffEffectiveWatchlist } from "@/lib/demotion";
import { fetchActiveTradeCommands, fetchOpenTrades, fetchPositions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { useTraderOnline } from "@/lib/hooks/use-trader-online";
import { tradeForPosition } from "@/lib/trade-matching";
import type { BotStatus, Position, Settings, Trade, TradeCommand } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

type Props = {
  positions: Position[];
  openTrades: Trade[];
  tradeCommands: TradeCommand[];
  botStatus: BotStatus;
  settings?: Settings | null;
};

export function PositionsGrid({
  positions,
  openTrades,
  tradeCommands,
  botStatus,
  settings,
}: Props) {
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

  return (
    <div>
      <CardTitle>Open Positions ({livePositions.length})</CardTitle>
      {livePositions.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No open positions</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {livePositions.map((p) => {
            const trade = tradeForPosition(p, liveOpenTrades);
            const command = trade ? commandByTradeId.get(trade.id) : undefined;
            const pending =
              command?.status === "pending" || command?.status === "processing";
            const failed = command?.status === "failed";
            const pnl = p.unrealized_pnl ?? 0;

            return (
              <Card key={p.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-zinc-100">
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
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {p.quantity} @ {formatCurrency(p.avg_cost)} · mkt{" "}
                      {formatCurrency(p.market_price)}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-sm font-medium ${
                      pnl >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {formatCurrency(p.unrealized_pnl)}
                  </p>
                </div>

                <div className="mt-3">
                  <SymbolChartPanel
                    symbol={p.symbol}
                    overlays={overlaysForPosition(p, trade)}
                    lazy
                    refreshIntervalMs={60_000}
                  />
                </div>

                <PositionRiskGauge position={p} trade={trade ?? null} settings={settings} />

                <div className="mt-3 border-t border-zinc-800/60 pt-3">
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
                    <span className="text-xs text-zinc-600">No linked trade</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
