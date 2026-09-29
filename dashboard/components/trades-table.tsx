"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ClosePositionButton } from "@/components/close-position-button";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { overlaysForTrade } from "@/lib/chart-overlays";
import {
  fetchActiveTradeCommands,
  fetchAllTrades,
  fetchRecentTrades,
} from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import { useTraderOnline } from "@/lib/hooks/use-trader-online";
import type { BotStatus, Trade, TradeCommand } from "@/lib/types/database";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/utils";

type Props = {
  trades: Trade[];
  tradeCommands?: TradeCommand[];
  botStatus?: BotStatus | null;
  showFilter?: boolean;
  showCloseAction?: boolean;
  showSignalColumn?: boolean;
  showViewAllLink?: boolean;
  title?: string;
  recentLimit?: number;
};

export function TradesTable({
  trades,
  tradeCommands = [],
  botStatus = null,
  showFilter = false,
  showCloseAction = false,
  showSignalColumn = false,
  showViewAllLink = false,
  title = "Trades",
  recentLimit = 10,
}: Props) {
  const traderOnline = useTraderOnline(
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
    },
  );
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fetchTrades = useCallback(
    () => (showFilter ? fetchAllTrades() : fetchRecentTrades(recentLimit)),
    [showFilter, recentLimit],
  );
  const fetchCommands = useCallback(() => fetchActiveTradeCommands(), []);

  const liveTrades = useLiveQuery(trades, fetchTrades, ["trades"]);
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

  const filtered =
    filter === "all" ? liveTrades : liveTrades.filter((t) => t.status === filter);

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  const colCount =
    8 + (showSignalColumn ? 1 : 0) + (showCloseAction ? 1 : 0);

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{title}</CardTitle>
        {showViewAllLink && (
          <Link
            href="/trades"
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            View all trades →
          </Link>
        )}
        {showFilter && (
          <div className="flex gap-1">
            {(["all", "open", "closed"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-1 text-xs capitalize ${
                  filter === f ? "bg-emerald-900 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No trades</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 w-8" />
                <th className="pb-2 pr-3">Symbol</th>
                <th className="pb-2 pr-3">Mode</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Entry</th>
                <th className="pb-2 pr-3">Exit</th>
                <th className="pb-2 pr-3">Qty</th>
                <th className="pb-2 pr-3">SL / TP</th>
                {showSignalColumn ? <th className="pb-2 pr-3">Signal</th> : null}
                <th className="pb-2 pr-3">PnL</th>
                {showCloseAction ? <th className="pb-2">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const command = commandByTradeId.get(t.id);
                const pending =
                  command?.status === "pending" || command?.status === "processing";
                const failed = command?.status === "failed";
                const isExpanded = expandedId === t.id;

                return (
                  <Fragment key={t.id}>
                  <tr className="border-b border-zinc-800/50">
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(t.id)}
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
                    <td className="py-2 pr-3 font-medium">{t.symbol}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        className={
                          t.execution_mode === "ibkr"
                            ? "bg-orange-900 text-orange-300"
                            : "bg-zinc-800 text-zinc-400"
                        }
                      >
                        {t.execution_mode ?? "ibkr"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge
                        className={
                          t.status === "open"
                            ? "bg-blue-900 text-blue-300"
                            : "bg-zinc-800 text-zinc-400"
                        }
                      >
                        {t.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{formatCurrency(t.entry_price)}</div>
                      <div className="text-xs text-zinc-500">{formatDateTime(t.entry_time)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {t.exit_price != null ? (
                        <>
                          <div>{formatCurrency(t.exit_price)}</div>
                          <div className="text-xs text-zinc-500">{formatDateTime(t.exit_time)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{t.quantity}</td>
                    <td className="py-2 pr-3 text-xs text-zinc-400">
                      {formatCurrency(t.stop_loss)} / {formatCurrency(t.take_profit)}
                    </td>
                    {showSignalColumn ? (
                      <td className="py-2 pr-3">
                        {t.jev_buy_probability != null ? (
                          <span className="text-emerald-400">
                            BUY {formatPercent(t.jev_buy_probability)}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    ) : null}
                    <td
                      className={`py-2 pr-3 ${
                        (t.net_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {t.net_pnl != null ? formatCurrency(t.net_pnl) : "—"}
                    </td>
                    {showCloseAction ? (
                      <td className="py-2">
                        {t.status === "open" ? (
                          <ClosePositionButton
                            tradeId={t.id}
                            symbol={t.symbol}
                            traderOnline={traderOnline}
                            pending={pending}
                            failed={failed}
                            errorMessage={command?.error}
                          />
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-zinc-800/50 bg-zinc-900/40">
                      <td />
                      <td colSpan={colCount - 1} className="py-3 pr-3">
                        <SymbolChartPanel
                          symbol={t.symbol}
                          overlays={overlaysForTrade(t)}
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
