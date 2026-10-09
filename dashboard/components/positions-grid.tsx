"use client";

import { useCallback, useMemo } from "react";
import { ClosePositionButton } from "@/components/close-position-button";
import { CoverShortButton } from "@/components/cover-short-button";
import { PositionOpenExplanation } from "@/components/position-open-explanation";
import { PositionRiskGauge } from "@/components/position-risk-gauge";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import { Card, CardTitle } from "@/components/ui/card";
import { overlaysForPosition } from "@/lib/chart-overlays";
import { usePositionsWithSsrFallback } from "@/components/open-positions-count-provider";
import {
  fetchActivePositionCommands,
  fetchActiveTradeCommands,
  fetchOpenTrades,
} from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { useTraderOnline } from "@/lib/hooks/use-trader-online";
import { tradeForPosition } from "@/lib/trade-matching";
import type {
  Position,
  PositionCommand,
  Settings,
  Trade,
  TradeCommand,
} from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

const SERVER_SEEDED = { skipInitialFetch: true } as const;

type Props = {
  positions: Position[];
  openTrades: Trade[];
  tradeCommands: TradeCommand[];
  positionCommands: PositionCommand[];
  settings?: Settings | null;
};

export function PositionsGrid({
  positions,
  openTrades,
  tradeCommands,
  positionCommands,
  settings,
}: Props) {
  const traderOnline = useTraderOnline();
  const livePositions = usePositionsWithSsrFallback(positions);
  const fetchTrades = useCallback(() => fetchOpenTrades(), []);
  const fetchCommands = useCallback(() => fetchActiveTradeCommands(), []);
  const fetchPositionCommands = useCallback(() => fetchActivePositionCommands(), []);

  const liveOpenTrades = useLiveQuery(openTrades, fetchTrades, ["trades"], undefined, SERVER_SEEDED);
  const liveCommands = useLiveQuery(
    tradeCommands,
    fetchCommands,
    ["trade_commands"],
    undefined,
    SERVER_SEEDED,
  );
  const livePositionCommands = useLiveQuery(
    positionCommands,
    fetchPositionCommands,
    ["position_commands"],
    undefined,
    SERVER_SEEDED,
  );

  const commandByTradeId = useMemo(() => {
    const map = new Map<string, TradeCommand>();
    for (const command of liveCommands) {
      if (!map.has(command.trade_id)) {
        map.set(command.trade_id, command);
      }
    }
    return map;
  }, [liveCommands]);

  const coverCommandBySymbol = useMemo(() => {
    const map = new Map<string, PositionCommand>();
    for (const command of livePositionCommands) {
      if (!map.has(command.symbol)) {
        map.set(command.symbol, command);
      }
    }
    return map;
  }, [livePositionCommands]);

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
            const coverCommand = coverCommandBySymbol.get(p.symbol);
            const pending =
              command?.status === "pending" ||
              command?.status === "processing" ||
              coverCommand?.status === "pending" ||
              coverCommand?.status === "processing";
            const failed = command?.status === "failed" || coverCommand?.status === "failed";
            const pnl = p.unrealized_pnl ?? 0;

            return (
              <Card key={p.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-zinc-100">
                      <span className="inline-flex items-center gap-2">
                        {p.symbol}
                        {p.quantity < 0 ? (
                          <span
                            className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400"
                            title="Short at the broker. Use Cover short below (or IBKR) to flatten."
                          >
                            Short
                          </span>
                        ) : null}
                        {!trade && p.quantity > 0 ? (
                          <span
                            className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400"
                            title="Broker still holds this symbol. The bot has no open trade for it, so exit rules do not apply."
                          >
                            Untracked
                          </span>
                        ) : null}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {p.quantity} @ {formatCurrency(p.avg_cost)} · mkt{" "}
                      {formatCurrency(p.market_price)}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-xl font-semibold tabular-nums ${
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
                    refreshIntervalMs={30_000}
                  />
                </div>

                <PositionRiskGauge position={p} trade={trade ?? null} settings={settings} />

                <PositionOpenExplanation
                  symbol={p.symbol}
                  quantity={p.quantity}
                  avgCost={p.avg_cost}
                  marketPrice={p.market_price}
                  unrealizedPnl={p.unrealized_pnl}
                  trade={trade ?? null}
                />

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
                  ) : p.quantity < 0 ? (
                    <CoverShortButton
                      symbol={p.symbol}
                      quantity={p.quantity}
                      traderOnline={traderOnline}
                      pending={pending}
                      failed={failed}
                      errorMessage={coverCommand?.error}
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
