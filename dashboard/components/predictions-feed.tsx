"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PredictionIndicators } from "@/components/prediction-indicators";
import { SkipExplanation } from "@/components/skip-explanation";
import { SortableTh } from "@/components/sortable-th";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchPredictionWithSnapshot, fetchPredictions } from "@/lib/data-client";
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
import {
  formatJevProbabilityPercent,
  formatSkipReason,
} from "@/lib/prediction-skip-reason";
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
    <div>
      <span
        className={`text-xs leading-snug ${isWaiting ? "text-amber-400" : "text-zinc-500"}`}
        title={prediction.trade_skip_reason ?? undefined}
      >
        {label}
      </span>
      <SkipExplanation
        key={`${prediction.id}:${prediction.trade_skip_reason ?? ""}:${prediction.trade_created}`}
        predictionId={prediction.id}
      />
    </div>
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

function predictionsEmptyMessage(
  loadError: string | null,
  analyticsCount: number,
): string {
  if (loadError) {
    return "Could not load the predictions list. Stats below may still be current — this page retries every few seconds, or refresh the browser.";
  }
  if (analyticsCount > 0) {
    return "The live list is empty but skip-reason stats loaded successfully. Wait for the next refresh or reload the page.";
  }
  return "No predictions yet";
}

export function PredictionsFeed({
  predictions,
  loadError = null,
  analyticsCount = 0,
  filterOptions = {},
  initialExpandedId = null,
  limit = 50,
}: {
  predictions: Prediction[];
  loadError?: string | null;
  analyticsCount?: number;
  filterOptions?: EvaluateOptions;
  initialExpandedId?: string | null;
  limit?: number;
}) {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId ?? null);
  const [prevExpandedSeed, setPrevExpandedSeed] = useState(initialExpandedId ?? null);
  const [snapshotById, setSnapshotById] = useState<
    Record<string, MarketSnapshot | null | undefined>
  >({});
  const snapshotCacheRef = useRef<Record<string, MarketSnapshot | null>>({});
  const [loadingSnapshotId, setLoadingSnapshotId] = useState<string | null>(null);
  const [pollLoadError, setPollLoadError] = useState<string | null>(null);

  const loadPredictions = useCallback(async () => {
    try {
      const rows = await fetchPredictions(limit);
      setPollLoadError(null);
      return rows;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Load failed";
      setPollLoadError(message);
      return [];
    }
  }, [limit]);
  const livePredictions = useLiveQuery(predictions, loadPredictions, ["predictions"], undefined, {
    keepPreviousOnEmpty: true,
  });
  const effectiveLoadError = pollLoadError ?? loadError;

  const expandedSeed = initialExpandedId ?? null;
  if (prevExpandedSeed !== expandedSeed) {
    setPrevExpandedSeed(expandedSeed);
    setExpandedId(expandedSeed);
  }

  useEffect(() => {
    if (!initialExpandedId) return;
    const el = document.getElementById(`prediction-${initialExpandedId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [initialExpandedId, livePredictions]);

  const symbols = [...new Set(livePredictions.map((p) => p.symbol))].sort();
  const activeSymbolFilter =
    symbolFilter && symbols.includes(symbolFilter) ? symbolFilter : "";

  const filtered = useMemo(
    () =>
      activeSymbolFilter
        ? livePredictions.filter((p) => p.symbol === activeSymbolFilter)
        : livePredictions,
    [livePredictions, activeSymbolFilter],
  );

  const compare = useCallback(
    (a: Prediction, b: Prediction, key: SortKey, dir: SortDir) =>
      comparePredictions(a, b, key, dir),
    [],
  );
  const initialDirForKey = useCallback(
    (key: SortKey): SortDir => (key === "symbol" ? "asc" : "desc"),
    [],
  );

  const { sorted, sortKey, sortDir, handleSort } = useTableSort<
    Prediction,
    SortKey
  >({
    items: filtered,
    defaultKey: "timestamp",
    defaultDir: "desc",
    compare,
    initialDirForKey,
  });

  const ensureSnapshot = useCallback(async (id: string) => {
    if (id in snapshotCacheRef.current || loadingSnapshotId === id) {
      return;
    }
    setLoadingSnapshotId(id);
    const row = await fetchPredictionWithSnapshot(id);
    snapshotCacheRef.current[id] = row?.market_snapshot ?? null;
    setSnapshotById({ ...snapshotCacheRef.current });
    setLoadingSnapshotId(null);
  }, [loadingSnapshotId]);

  useEffect(() => {
    if (!initialExpandedId) return;
    void ensureSnapshot(initialExpandedId);
  }, [initialExpandedId, ensureSnapshot]);

  function toggleExpanded(id: string) {
    setExpandedId((current) => {
      const next = current === id ? null : id;
      if (next) {
        void ensureSnapshot(next);
      }
      return next;
    });
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
        <p className="mt-4 text-sm text-zinc-500">
          {predictionsEmptyMessage(effectiveLoadError, analyticsCount)}
        </p>
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
                const snapshot = snapshotById[p.id] ?? p.market_snapshot;
                const isExpanded = expandedId === p.id;

                return (
                  <Fragment key={p.id}>
                    <tr
                      id={`prediction-${p.id}`}
                      className="border-b border-zinc-800/50"
                    >
                      <td className="py-2 pr-2">
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
                      </td>
                      <td className="py-2 pr-3 text-zinc-400">{formatDateTime(p.timestamp)}</td>
                      <td className="py-2 pr-3 font-medium">{p.symbol}</td>
                      <td className="py-2 pr-3">{formatCurrency(p.price)}</td>
                      <td className="py-2 pr-3 text-emerald-400">
                        {formatJevProbabilityPercent(p.buy_probability, p)}
                      </td>
                      <td className="py-2 pr-3 text-zinc-300">
                        {formatJevProbabilityPercent(p.hold_probability, p)}
                      </td>
                      <td className="py-2 pr-3 text-red-400">
                        {formatJevProbabilityPercent(p.sell_probability, p)}
                      </td>
                      <td className="py-2 pr-3">
                        <NewsCell snapshot={snapshot} />
                      </td>
                      <td className="py-2 align-top">
                        <TradeCell prediction={p} />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-zinc-800/50 bg-zinc-900/40">
                        <td />
                        <td colSpan={8} className="py-3 pr-3">
                          <div className="space-y-4">
                            {loadingSnapshotId === p.id || snapshot === undefined ? (
                              <p className="text-xs text-zinc-500">Loading indicators…</p>
                            ) : snapshot ? (
                              <PredictionIndicators
                                snapshot={snapshot}
                                symbol={p.symbol}
                                filterOptions={filterOptions}
                              />
                            ) : (
                              <p className="text-xs text-zinc-500">No indicator snapshot for this row.</p>
                            )}
                            {snapshot?.ai_shadow_verdict && snapshot.ai_shadow_note ? (
                              <div className="border-t border-zinc-800/60 pt-3 text-xs text-zinc-400">
                                <p className="text-sm font-medium text-zinc-300">OpenAI second read</p>
                                <p className="mt-1 capitalize text-zinc-300">
                                  {snapshot.ai_shadow_verdict.replace("_", " ")}
                                </p>
                                <p className="mt-1">{snapshot.ai_shadow_note}</p>
                                <p className="mt-1 text-zinc-600">Logged with the prediction; does not change trades.</p>
                              </div>
                            ) : null}
                            {(snapshot?.news_top_headline ||
                              snapshot?.tape_top_headline) && (
                              <div className="space-y-2 border-t border-zinc-800/60 pt-3 text-xs text-zinc-400">
                                {snapshot?.news_top_headline ? (
                                  <>
                                    <p className="text-sm font-medium text-zinc-300">Company news</p>
                                    <p className="text-sm text-zinc-300">{snapshot.news_top_headline}</p>
                                  </>
                                ) : null}
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
                                  <p>Company news fetched: {formatDateTime(snapshot.news_fetched_at)}</p>
                                )}
                                {snapshot?.news_materiality_note ? (
                                  <p>{snapshot.news_materiality_note}</p>
                                ) : null}
                                {snapshot?.news_still_relevant_for_open === false ? (
                                  <p className="text-amber-500/90">Headline treated as stale for the open.</p>
                                ) : null}
                                {snapshot?.tape_top_headline ? (
                                  <>
                                    <p className="pt-2 text-sm font-medium text-zinc-300">Broad tape</p>
                                    <p className="text-sm text-zinc-300">{snapshot.tape_top_headline}</p>
                                    {snapshot.tape_sentiment != null ? (
                                      <p>
                                        Tape sentiment:{" "}
                                        <span
                                          className={
                                            snapshot.tape_sentiment > 0.05
                                              ? "text-emerald-400"
                                              : snapshot.tape_sentiment < -0.05
                                                ? "text-red-400"
                                                : "text-zinc-500"
                                          }
                                        >
                                          {sentimentLabel(snapshot.tape_sentiment)} (
                                          {snapshot.tape_sentiment.toFixed(2)})
                                        </span>
                                      </p>
                                    ) : null}
                                  </>
                                ) : null}
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
