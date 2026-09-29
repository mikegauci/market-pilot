"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { PredictionIndicators } from "@/components/prediction-indicators";
import { SortableTh } from "@/components/sortable-th";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchPredictions } from "@/lib/data-client";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  compareNumber,
  compareString,
  useTableSort,
  type SortDir,
} from "@/lib/hooks/use-table-sort";
import {
  hasNewsSignal,
  sentimentClass,
  sentimentLabel,
} from "@/lib/news-feed";
import type { EvaluateOptions } from "@/lib/prediction-filters";
import type { MarketSnapshot, Prediction } from "@/lib/types/database";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/utils";

type SortKey =
  | "timestamp"
  | "symbol"
  | "price"
  | "buy_probability"
  | "hold_probability"
  | "sell_probability"
  | "trade_created";

function comparePredictions(
  a: Prediction,
  b: Prediction,
  key: SortKey,
  dir: SortDir,
): number {
  switch (key) {
    case "timestamp":
      return compareNumber(
        new Date(a.timestamp).getTime(),
        new Date(b.timestamp).getTime(),
        dir,
      );
    case "symbol":
      return compareString(a.symbol, b.symbol, dir);
    case "price":
      return compareNumber(a.price, b.price, dir);
    case "buy_probability":
      return compareNumber(a.buy_probability, b.buy_probability, dir);
    case "hold_probability":
      return compareNumber(a.hold_probability, b.hold_probability, dir);
    case "sell_probability":
      return compareNumber(a.sell_probability, b.sell_probability, dir);
    case "trade_created":
      return compareNumber(Number(a.trade_created), Number(b.trade_created), dir);
  }
}

const SKIP_REASON_LABELS: Record<string, string> = {
  below_trade_threshold: "Below confidence threshold",
  buy_hold_margin: "BUY–HOLD margin too narrow",
  hold_dominant: "HOLD dominant",
  sell_dominant: "SELL dominant",
  signal_not_eligible: "Signal not eligible",
  bot_disabled: "Auto-trading off",
  already_open: "Position already open",
  max_open_positions: "Max positions reached",
  insufficient_capital: "Insufficient capital",
  max_daily_loss: "Daily loss limit hit",
  position_too_small: "Position too small",
  invalid_price: "Invalid price",
  ibkr_not_connected: "Broker not connected",
  ibkr_pending_entry_order: "Pending BUY order open",
  price_below_ema20: "Price below EMA-20",
};

function formatSkipReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith("awaiting_confirmation")) {
    const match = reason.match(/awaiting_confirmation \((\d+)\/(\d+)\)/);
    if (match) {
      return `Awaiting confirmation (${match[1]}/${match[2]})`;
    }
    return "Awaiting confirmation";
  }
  if (reason.startsWith("rsi_overbought")) return "RSI overbought";
  if (reason.startsWith("spread_too_wide")) return "Spread too wide";
  if (reason.startsWith("spy_headwind")) return "SPY headwind";
  if (reason.startsWith("news_sentiment_bearish")) return "Bearish news";
  if (reason.startsWith("news_block_tag")) return "Blocked news tag";
  if (reason.startsWith("news_earnings_window")) return "Earnings window";
  if (reason.startsWith("correlation_cap")) return "Correlation cap";
  if (reason.startsWith("ibkr_cooldown")) return "Broker cooldown";
  if (reason.startsWith("ibkr_ineligible")) return "Broker ineligible (KID / permission)";
  if (reason.startsWith("ibkr_insufficient_buying_power")) return "Insufficient buying power";
  if (reason.startsWith("ibkr_order_failed")) return "Broker order failed";
  return SKIP_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}

function TradeCell({ prediction }: { prediction: Prediction }) {
  if (prediction.trade_created) {
    return <Badge className="bg-emerald-900 text-emerald-300">opened</Badge>;
  }

  const label = formatSkipReason(prediction.trade_skip_reason);
  if (!label) {
    return <span className="text-zinc-600">—</span>;
  }

  const isWaiting = label.startsWith("Awaiting confirmation");
  return (
    <span
      className={`text-xs leading-snug ${isWaiting ? "text-amber-400" : "text-zinc-500"}`}
      title={prediction.trade_skip_reason ?? undefined}
    >
      {label}
    </span>
  );
}

function NewsCell({ snapshot }: { snapshot?: MarketSnapshot | null }) {
  if (!hasNewsSignal(snapshot)) {
    return <span className="text-zinc-600">—</span>;
  }

  const sentiment = snapshot?.news_sentiment ?? 0;
  const hasSentimentSignal = Math.abs(sentiment) > 0.1;
  const tags = snapshot?.news_tags ?? [];

  return (
    <div className="max-w-sm space-y-1">
      {snapshot?.news_top_headline && (
        <p
          className="line-clamp-2 text-xs leading-snug text-zinc-300"
          title={snapshot.news_top_headline}
        >
          {snapshot.news_top_headline}
        </p>
      )}
      {(hasSentimentSignal || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {hasSentimentSignal && snapshot?.news_sentiment != null && (
            <Badge
              className={sentimentClass(sentiment)}
              title="Rule-based score from recent headlines (−1 bearish to +1 bullish)"
            >
              {sentimentLabel(sentiment)} {sentiment.toFixed(2)}
            </Badge>
          )}
          {tags.map((tag) => (
            <Badge
              key={tag}
              className="border border-zinc-700 bg-transparent px-1.5 py-0 text-[10px] text-zinc-500"
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function PredictionsFeed({
  predictions,
  filterOptions = {},
  initialExpandedId = null,
  limit = 50,
}: {
  predictions: Prediction[];
  filterOptions?: EvaluateOptions;
  initialExpandedId?: string | null;
  limit?: number;
}) {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId);

  const loadPredictions = useCallback(() => fetchPredictions(limit), [limit]);
  const livePredictions = useLiveQuery(predictions, loadPredictions, ["predictions"]);

  useEffect(() => {
    setExpandedId(initialExpandedId);
  }, [initialExpandedId]);

  useEffect(() => {
    if (!initialExpandedId) return;
    const el = document.getElementById(`prediction-${initialExpandedId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [initialExpandedId, livePredictions]);

  const symbols = [...new Set(livePredictions.map((p) => p.symbol))].sort();

  useEffect(() => {
    if (symbolFilter && !symbols.includes(symbolFilter)) {
      setSymbolFilter("");
    }
  }, [symbols, symbolFilter]);

  const filtered = useMemo(
    () =>
      symbolFilter
        ? livePredictions.filter((p) => p.symbol === symbolFilter)
        : livePredictions,
    [livePredictions, symbolFilter],
  );

  const compare = useCallback(comparePredictions, []);
  const initialDirForKey = useCallback(
    (key: SortKey) => (key === "symbol" ? "asc" : "desc") as const,
    [],
  );

  const { sorted, sortKey, sortDir, handleSort } = useTableSort({
    items: filtered,
    defaultKey: "timestamp",
    defaultDir: "desc",
    compare,
    initialDirForKey,
  });

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Latest Predictions</CardTitle>
        <select
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
        >
          <option value="">All symbols</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No predictions yet</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 pr-2 w-8" />
                <SortableTh
                  label="Time"
                  columnKey="timestamp"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Symbol"
                  columnKey="symbol"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="Price"
                  columnKey="price"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="BUY"
                  columnKey="buy_probability"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="HOLD"
                  columnKey="hold_probability"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <SortableTh
                  label="SELL"
                  columnKey="sell_probability"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <th className="pb-2 pr-3">News</th>
                <SortableTh
                  label="Outcome"
                  columnKey="trade_created"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="pb-2"
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const snapshot = p.market_snapshot;
                const hasExpandableDetail = Boolean(snapshot);
                const isExpanded = expandedId === p.id;

                return (
                  <Fragment key={p.id}>
                    <tr
                      id={`prediction-${p.id}`}
                      className="border-b border-zinc-800/50"
                    >
                      <td className="py-2 pr-2">
                        {hasExpandableDetail ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(p.id)}
                            className="text-zinc-500 hover:text-zinc-300"
                            aria-label={isExpanded ? "Collapse details" : "Expand details"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                      </td>
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
                      <td className="py-2 pr-3">
                        <NewsCell snapshot={snapshot} />
                      </td>
                      <td className="py-2 max-w-[10rem]">
                        <TradeCell prediction={p} />
                      </td>
                    </tr>
                    {isExpanded && hasExpandableDetail && (
                      <tr className="border-b border-zinc-800/50 bg-zinc-900/40">
                        <td />
                        <td colSpan={8} className="py-3 pr-3">
                          <div className="space-y-4">
                            <PredictionIndicators
                              snapshot={snapshot}
                              symbol={p.symbol}
                              filterOptions={filterOptions}
                            />
                            {snapshot?.news_top_headline && (
                              <div className="space-y-2 border-t border-zinc-800/60 pt-3 text-xs text-zinc-400">
                                <p className="text-sm font-medium text-zinc-300">News</p>
                                <p className="text-sm text-zinc-300">{snapshot.news_top_headline}</p>
                                {snapshot?.news_sentiment != null && (
                                  <p>
                                    Sentiment:{" "}
                                    <span
                                      className={
                                        Math.abs(snapshot.news_sentiment) > 0.1
                                          ? snapshot.news_sentiment > 0
                                            ? "text-emerald-400"
                                            : "text-red-400"
                                          : "text-zinc-500"
                                      }
                                    >
                                      {sentimentLabel(snapshot.news_sentiment)}{" "}
                                      ({snapshot.news_sentiment.toFixed(2)})
                                    </span>
                                  </p>
                                )}
                                {snapshot?.news_headline_count != null && (
                                  <p>
                                    {snapshot.news_headline_count} headline
                                    {snapshot.news_headline_count === 1 ? "" : "s"} in lookback
                                  </p>
                                )}
                                {snapshot?.news_fetched_at && (
                                  <p>News fetched: {formatDateTime(snapshot.news_fetched_at)}</p>
                                )}
                              </div>
                            )}
                          </div>
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
