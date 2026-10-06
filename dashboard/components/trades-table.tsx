"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
import { ClosePositionButton } from "@/components/close-position-button";
import { TradeRecapButton } from "@/components/trade-recap-button";
import { SortableTh } from "@/components/sortable-th";
import { SymbolChartPanel } from "@/components/symbol-chart-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { overlaysForTrade } from "@/lib/chart-overlays";
import {
  fetchActiveTradeCommands,
  fetchAllTrades,
  fetchTradesForTradingDay,
} from "@/lib/data-client";
import {
  exitReasonFilterOptions,
  exitReasonLabel,
  exitReasonSortLabel,
  filterTradesByExitReason,
  tradesEmptyMessage,
  type ExitReasonFilterOption,
  type ExitReasonFilterValue,
} from "@/lib/trade-analytics";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  compareNullableNumber,
  compareNullableTime,
  compareNumber,
  compareString,
  useTableSort,
  type SortDir,
} from "@/lib/hooks/use-table-sort";
import { useTraderOnline } from "@/lib/hooks/use-trader-online";
import type { BotStatus, Trade, TradeCommand } from "@/lib/types/database";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/utils";

type SortKey =
  | "symbol"
  | "status"
  | "exitReason"
  | "entry"
  | "exit"
  | "quantity"
  | "signal"
  | "pnl";

function compareTrades(a: Trade, b: Trade, key: SortKey, dir: SortDir): number {
  switch (key) {
    case "symbol":
      return compareString(a.symbol, b.symbol, dir);
    case "status":
      return compareString(a.status, b.status, dir);
    case "exitReason": {
      const cmp = compareString(exitReasonSortLabel(a), exitReasonSortLabel(b), dir);
      if (cmp !== 0) return cmp;
      return compareNullableTime(a.entry_time, b.entry_time, "desc");
    }
    case "entry":
      return compareNullableTime(a.entry_time, b.entry_time, dir);
    case "exit":
      return compareNullableTime(a.exit_time, b.exit_time, dir);
    case "quantity":
      return compareNumber(a.quantity, b.quantity, dir);
    case "signal":
      return compareNullableNumber(a.jev_buy_probability, b.jev_buy_probability, dir);
    case "pnl":
      return compareNullableNumber(a.net_pnl, b.net_pnl, dir);
  }
}

function SortHeaderButton({
  label,
  active,
  sortDir,
  onClick,
  className = "inline-flex items-center gap-1 hover:text-zinc-300",
}: {
  label: string;
  active: boolean;
  sortDir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-label={
        active
          ? `Sort by ${label}, currently ${sortDir === "asc" ? "ascending" : "descending"}`
          : `Sort by ${label}`
      }
    >
      {label}
      {active &&
        (sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3" aria-hidden />
        ) : (
          <ArrowDown className="h-3 w-3" aria-hidden />
        ))}
    </button>
  );
}

function StatusHeaderCell({
  sortKey,
  sortDir,
  onSort,
  exitReasonFilter,
  onExitReasonFilterChange,
  filterOptions,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  exitReasonFilter: ExitReasonFilterValue;
  onExitReasonFilterChange: (value: ExitReasonFilterValue) => void;
  filterOptions: ExitReasonFilterOption[];
}) {
  const statusActive = sortKey === "status";
  const exitReasonActive = sortKey === "exitReason";
  const ariaSort =
    statusActive || exitReasonActive
      ? sortDir === "asc"
        ? "ascending"
        : "descending"
      : "none";

  return (
    <th className="pb-2 pr-3 align-bottom" aria-sort={ariaSort}>
      <div className="flex min-w-[9rem] flex-col gap-1">
        <SortHeaderButton
          label="Status"
          active={statusActive}
          sortDir={sortDir}
          onClick={() => onSort("status")}
        />
        <div className="flex flex-wrap items-center gap-1">
          <SortHeaderButton
            label="Exit type"
            active={exitReasonActive}
            sortDir={sortDir}
            onClick={() => onSort("exitReason")}
            className="inline-flex items-center gap-0.5 text-xs hover:text-zinc-300"
          />
          {filterOptions.length > 1 ? (
            <select
              value={exitReasonFilter}
              onChange={(e) =>
                onExitReasonFilterChange(e.target.value as ExitReasonFilterValue)
              }
              className="max-w-[10rem] rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-xs text-zinc-300"
              aria-label="Filter by exit reason"
            >
              {filterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
    </th>
  );
}

type Props = {
  trades: Trade[];
  tradeCommands?: TradeCommand[];
  botStatus?: BotStatus | null;
  showFilter?: boolean;
  showCloseAction?: boolean;
  showSignalColumn?: boolean;
  showViewAllLink?: boolean;
  showChartExpand?: boolean;
  title?: string;
  /** Pin live refresh to SSR trading-day boundary (midnight US Eastern). */
  tradingDayStartIso?: string;
};

export function TradesTable({
  trades,
  tradeCommands = [],
  botStatus = null,
  showFilter = false,
  showCloseAction = false,
  showSignalColumn = false,
  showViewAllLink = false,
  showChartExpand = true,
  title = "Trades",
  tradingDayStartIso,
}: Props) {
  const traderOnline = useTraderOnline(
    botStatus ?? {
      id: 1,
      enabled: false,
      trading_mode: "paper",
      execution_mode: "ibkr",
      ibkr_connected: false,
      jev_connected: false,
      ibkr_account_id: null,
      last_heartbeat: null,
      last_error: null,
      updated_at: "",
    },
  );
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [exitReasonFilter, setExitReasonFilter] = useState<ExitReasonFilterValue>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fetchTrades = useCallback(
    () =>
      showFilter
        ? fetchAllTrades()
        : fetchTradesForTradingDay(tradingDayStartIso),
    [showFilter, tradingDayStartIso],
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

  const afterStatus = useMemo(
    () =>
      filter === "all" ? liveTrades : liveTrades.filter((t) => t.status === filter),
    [filter, liveTrades],
  );

  const exitReasonOptions = useMemo(
    () => exitReasonFilterOptions(afterStatus),
    [afterStatus],
  );

  const activeExitReasonFilter = useMemo((): ExitReasonFilterValue => {
    if (exitReasonFilter === "all") return "all";
    if (exitReasonOptions.some((o) => o.value === exitReasonFilter)) {
      return exitReasonFilter;
    }
    return "all";
  }, [exitReasonFilter, exitReasonOptions]);

  const filtered = useMemo(() => {
    return filterTradesByExitReason(afterStatus, activeExitReasonFilter);
  }, [afterStatus, activeExitReasonFilter]);

  const emptyMessage = useMemo(
    () =>
      tradesEmptyMessage(liveTrades.length > 0, filter, activeExitReasonFilter),
    [liveTrades.length, filter, activeExitReasonFilter],
  );

  const compare = useCallback(
    (a: Trade, b: Trade, key: SortKey, dir: SortDir) =>
      compareTrades(a, b, key, dir),
    [],
  );
  const initialDirForKey = useCallback(
    (key: SortKey): SortDir =>
      key === "symbol" || key === "status" || key === "exitReason" ? "asc" : "desc",
    [],
  );

  const { sorted, sortKey, sortDir, handleSort } = useTableSort<Trade, SortKey>({
    items: filtered,
    defaultKey: "entry",
    defaultDir: "desc",
    compare,
    initialDirForKey,
  });

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  const colCount =
    6 +
    (showChartExpand ? 1 : 0) +
    (showSignalColumn ? 1 : 0) +
    (showCloseAction ? 1 : 0);

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
        <p className="mt-4 text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                {showChartExpand ? <th className="pb-2 w-8" /> : null}
                <SortableTh
                  label="Symbol"
                  columnKey="symbol"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <StatusHeaderCell
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  exitReasonFilter={activeExitReasonFilter}
                  onExitReasonFilterChange={setExitReasonFilter}
                  filterOptions={exitReasonOptions}
                />
                <SortableTh
                  label="Entry"
                  columnKey="entry"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Exit"
                  columnKey="exit"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Qty"
                  columnKey="quantity"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                {showSignalColumn ? (
                  <SortableTh
                    label="Signal"
                    columnKey="signal"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="hidden pb-2 pr-3 sm:table-cell"
                  />
                ) : null}
                <SortableTh
                  label="PnL"
                  columnKey="pnl"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                {showCloseAction ? <th className="pb-2">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const command = commandByTradeId.get(t.id);
                const pending =
                  command?.status === "pending" || command?.status === "processing";
                const failed = command?.status === "failed";
                const isExpanded = expandedId === t.id;

                return (
                  <Fragment key={t.id}>
                  <tr className="border-b border-zinc-800/50">
                    {showChartExpand ? (
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
                    ) : null}
                    <td className="py-2 pr-3 font-medium">{t.symbol}</td>
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
                      {t.status === "closed" ? (
                        <div className="mt-1 text-xs text-zinc-500">
                          {exitReasonLabel(t.exit_reason ?? "unknown")}
                          <TradeRecapButton tradeId={t.id} />
                        </div>
                      ) : null}
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
                    {showSignalColumn ? (
                      <td className="hidden py-2 pr-3 sm:table-cell">
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
                  {showChartExpand && isExpanded && (
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
