"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardTitle } from "@/components/ui/card";
import {
  computeCalibration,
  rejectedForwardCalibrationSamples,
  takenTradeCalibrationSamples,
} from "@/lib/calibration";
import {
  fetchAnalyticsPredictions,
  fetchClosedTrades,
  fetchPortfolioHistory,
  fetchSignalForwardReturns,
} from "@/lib/data-client";
import {
  maeMfeScatter,
  slippageHistogram,
  totalExecutionCost,
} from "@/lib/execution-analytics";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  buildDailyPnlSeries,
  buildEquitySeries,
  filterPortfolioByRange,
  maxDrawdownPct,
  type PortfolioRange,
} from "@/lib/portfolio-analytics";
import {
  type AnalyticsMode,
  breakdownByBuyBand,
  breakdownByExitReason,
  breakdownByHourEt,
  breakdownBySymbol,
  computeExpectancy,
  computeExposure,
  evidenceLabel,
  executionCosts,
  filterTradesByMode,
  sharpeFromDailyPnl,
  type BreakdownRow,
} from "@/lib/r-analytics";
import {
  computeTradeStats,
  exitReasonBreakdown,
  pnlBySymbol,
} from "@/lib/trade-analytics";
import type {
  DecisionLogRow,
  PortfolioSnapshot,
  Prediction,
  SignalForwardReturn,
  Trade,
} from "@/lib/types/database";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

type Props = {
  portfolioHistory: PortfolioSnapshot[];
  closedTrades: Trade[];
  predictions: Prediction[];
  forwardReturns: SignalForwardReturn[];
  decisionLogs: DecisionLogRow[];
  currency: string;
};

type TabId = "performance" | "calibration" | "execution";

const RANGE_OPTIONS: { value: PortfolioRange; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "All" },
];

const MODE_OPTIONS: { value: AnalyticsMode; label: string }[] = [
  { value: "paper", label: "Paper" },
  { value: "live", label: "Live" },
  { value: "simulated", label: "Simulated" },
  { value: "all", label: "All (mixed)" },
];

const TABS: { id: TabId; label: string }[] = [
  { id: "performance", label: "Performance" },
  { id: "calibration", label: "Calibration" },
  { id: "execution", label: "Execution" },
];

const PIE_COLORS = [
  "#34d399",
  "#60a5fa",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#fb923c",
  "#94a3b8",
];

function ChartTooltip({
  active,
  payload,
  label,
  currency,
  valueFormatter,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color?: string }[];
  label?: string;
  currency?: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 text-zinc-400">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color ?? "#e4e4e7" }}>
          {entry.name}: {valueFormatter ? valueFormatter(entry.value) : entry.value}
          {currency && !valueFormatter ? ` ${currency}` : ""}
        </p>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <CardTitle>{label}</CardTitle>
      <p className={cn("mt-2 text-xl font-semibold tabular-nums text-zinc-100", valueClassName)}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}

function BreakdownTable({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: BreakdownRow[];
  currency: string;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No R-eligible trades</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Bucket</th>
                <th className="pb-2 font-medium tabular-nums">n</th>
                <th className="pb-2 font-medium tabular-nums">Mean R</th>
                <th className="pb-2 font-medium tabular-nums">P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row) => (
                <tr key={row.key} className="border-t border-zinc-800">
                  <td className="py-2 text-zinc-200">{row.label}</td>
                  <td className="py-2 tabular-nums text-zinc-400">{row.n}</td>
                  <td className="py-2 tabular-nums text-zinc-200">
                    {row.meanR == null ? "—" : row.meanR.toFixed(2)}
                  </td>
                  <td
                    className={cn(
                      "py-2 tabular-nums",
                      row.totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
                    )}
                  >
                    {formatCurrency(row.totalPnl, currency)}
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

function vetoReasonCounts(
  predictions: Prediction[],
  decisionLogs: DecisionLogRow[],
): { label: string; n: number }[] {
  const map = new Map<string, number>();
  for (const pred of predictions) {
    if (pred.trade_created) continue;
    const reason =
      pred.skip_reasons?.[0] ?? pred.trade_skip_reason ?? null;
    if (!reason) continue;
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
  for (const log of decisionLogs) {
    if (log.outcome === "entered" || log.outcome === "trade") continue;
    const reason = log.reasons?.[0];
    if (!reason) continue;
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);
}

export function AnalyticsDashboard({
  portfolioHistory,
  closedTrades,
  predictions,
  forwardReturns,
  decisionLogs,
  currency,
}: Props) {
  const [range, setRange] = useState<PortfolioRange>("1w");
  const [mode, setMode] = useState<AnalyticsMode>("paper");
  const [tab, setTab] = useState<TabId>("performance");
  const [calSource, setCalSource] = useState<"taken" | "rejected" | "both">("both");

  const loadHistory = useCallback(() => fetchPortfolioHistory(), []);
  const loadTrades = useCallback(() => fetchClosedTrades(), []);
  const loadPredictions = useCallback(() => fetchAnalyticsPredictions(2000), []);
  const loadForwards = useCallback(() => fetchSignalForwardReturns(2000), []);

  const liveHistory = useLiveQuery(portfolioHistory, loadHistory, ["portfolio_history"]);
  const liveTrades = useLiveQuery(closedTrades, loadTrades, ["trades"]);
  const livePredictions = useLiveQuery(predictions, loadPredictions, ["predictions"]);
  const liveForwards = useLiveQuery(forwardReturns, loadForwards, [
    "signal_forward_returns",
  ]);

  const modeTrades = useMemo(
    () => filterTradesByMode(liveTrades, mode),
    [liveTrades, mode],
  );

  const filtered = useMemo(
    () => filterPortfolioByRange(liveHistory, range),
    [liveHistory, range],
  );
  const equitySeries = useMemo(() => buildEquitySeries(filtered), [filtered]);
  const dailyPnlSeries = useMemo(() => buildDailyPnlSeries(filtered), [filtered]);
  const stats = useMemo(() => computeTradeStats(modeTrades), [modeTrades]);
  const symbolPnl = useMemo(() => pnlBySymbol(modeTrades).slice(0, 8), [modeTrades]);
  const exitReasons = useMemo(() => exitReasonBreakdown(modeTrades), [modeTrades]);
  const maxDd = useMemo(() => maxDrawdownPct(filtered), [filtered]);
  const expectancy = useMemo(() => computeExpectancy(modeTrades), [modeTrades]);
  const exposure = useMemo(() => computeExposure(modeTrades), [modeTrades]);
  const costs = useMemo(() => executionCosts(modeTrades), [modeTrades]);
  const sharpe = useMemo(
    () => sharpeFromDailyPnl(dailyPnlSeries.map((d) => d.dailyPnl)),
    [dailyPnlSeries],
  );

  const symbolBreakdown = useMemo(() => breakdownBySymbol(modeTrades), [modeTrades]);
  const hourBreakdown = useMemo(() => breakdownByHourEt(modeTrades), [modeTrades]);
  const exitBreakdown = useMemo(() => breakdownByExitReason(modeTrades), [modeTrades]);
  const bandBreakdown = useMemo(() => breakdownByBuyBand(modeTrades), [modeTrades]);
  const vetoRows = useMemo(
    () => vetoReasonCounts(livePredictions, decisionLogs),
    [livePredictions, decisionLogs],
  );

  const takenSamples = useMemo(
    () => takenTradeCalibrationSamples(modeTrades),
    [modeTrades],
  );
  const rejectedSamples = useMemo(
    () => rejectedForwardCalibrationSamples(livePredictions, liveForwards),
    [livePredictions, liveForwards],
  );
  const calibration = useMemo(() => {
    const samples =
      calSource === "taken"
        ? takenSamples
        : calSource === "rejected"
          ? rejectedSamples
          : [...takenSamples, ...rejectedSamples];
    return computeCalibration(samples);
  }, [calSource, takenSamples, rejectedSamples]);

  const slipBuckets = useMemo(() => slippageHistogram(modeTrades), [modeTrades]);
  const maeMfe = useMemo(() => maeMfeScatter(modeTrades), [modeTrades]);
  const execCosts = useMemo(() => totalExecutionCost(modeTrades), [modeTrades]);

  const equityChartData = equitySeries.map((p) => ({
    label: new Date(p.timestamp).toLocaleString("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    equity: p.equity,
    drawdown: p.drawdownPct,
  }));

  const reliabilityChart = calibration.bins
    .filter((b) => b.n > 0)
    .map((b) => ({
      mid: Number((b.mid * 100).toFixed(0)),
      hitRate: b.hitRate == null ? null : b.hitRate * 100,
      perfect: b.mid * 100,
      n: b.n,
      insufficient: b.insufficient,
    }));

  const modeHint =
    mode === "all"
      ? "Mixed paper + live + simulated — interpret carefully"
      : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                tab === id
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {MODE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition",
                mode === value
                  ? "bg-sky-900/50 text-sky-300"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {modeHint && (
        <p className="text-xs text-amber-400/90">{modeHint}</p>
      )}

      {tab === "performance" && (
        <>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setRange(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition",
                  range === value
                    ? "bg-emerald-900/50 text-emerald-300"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Win rate" value={formatPercent(stats.winRate)} />
            <StatCard
              label="Total P&L (closed)"
              value={formatCurrency(stats.totalPnl, currency)}
              valueClassName={stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <StatCard
              label="Profit factor"
              value={
                stats.profitFactor == null
                  ? stats.closedCount === 0
                    ? "—"
                    : "∞"
                  : stats.profitFactor.toFixed(2)
              }
            />
            <StatCard
              label="Max drawdown"
              value={`${maxDd.toFixed(1)}%`}
              valueClassName="text-red-400"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="R expectancy"
              value={
                expectancy.meanR == null ? "—" : `${expectancy.meanR.toFixed(2)} R`
              }
              hint={`n=${expectancy.n} · ${evidenceLabel(expectancy.evidence)}`}
              valueClassName={
                expectancy.meanR == null
                  ? undefined
                  : expectancy.meanR >= 0
                    ? "text-emerald-400"
                    : "text-red-400"
              }
            />
            <StatCard
              label="Bootstrap 95% CI"
              value={
                expectancy.ciLow == null || expectancy.ciHigh == null
                  ? expectancy.evidence === "insufficient"
                    ? "Insufficient n"
                    : "—"
                  : `${expectancy.ciLow.toFixed(2)} … ${expectancy.ciHigh.toFixed(2)}`
              }
              hint="Percentile method, 1000 resamples"
            />
            <StatCard
              label="Exposure"
              value={exposure == null ? "—" : formatPercent(exposure)}
              hint="Hold minutes / wall-clock span"
            />
            <StatCard
              label="Execution costs"
              value={formatCurrency(costs, currency)}
              hint="|slippage| + commission"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Avg win / loss (R)"
              value={
                expectancy.avgWinR == null && expectancy.avgLossR == null
                  ? "—"
                  : `${expectancy.avgWinR?.toFixed(2) ?? "—"} / ${expectancy.avgLossR?.toFixed(2) ?? "—"}`
              }
            />
            <StatCard
              label="Avg hold"
              value={
                stats.avgHoldMinutes != null
                  ? `${Math.round(stats.avgHoldMinutes)} min`
                  : "—"
              }
            />
            <StatCard
              label="Daily Sharpe"
              value={sharpe == null ? "—" : sharpe.toFixed(2)}
              hint="From daily P&L (secondary)"
            />
            <StatCard
              label="Closed trades"
              value={String(stats.closedCount)}
              hint={`${stats.winCount}W / ${stats.lossCount}L`}
            />
          </div>

          <Card className="border-dashed border-zinc-700 bg-zinc-900/40">
            <CardTitle>Shadow strategies (Phase 11)</CardTitle>
            <p className="mt-2 text-sm text-zinc-500">
              Comparison vs live logic will appear here.
            </p>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Equity curve</CardTitle>
              {equityChartData.length < 2 ? (
                <p className="mt-4 text-sm text-zinc-500">Not enough portfolio history yet</p>
              ) : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityChartData}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={70} />
                      <Tooltip
                        content={
                          <ChartTooltip
                            currency={currency}
                            valueFormatter={(v) => formatCurrency(v, currency)}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="equity"
                        name="Equity"
                        stroke="#34d399"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Drawdown</CardTitle>
              {equityChartData.length < 2 ? (
                <p className="mt-4 text-sm text-zinc-500">Not enough portfolio history yet</p>
              ) : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityChartData}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={50} />
                      <Tooltip
                        content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(2)}%`} />}
                      />
                      <Line
                        type="monotone"
                        dataKey="drawdown"
                        name="Drawdown"
                        stroke="#f87171"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Daily P&L</CardTitle>
              {dailyPnlSeries.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">No daily P&L data</p>
              ) : (
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyPnlSeries}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 10 }} />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={60} />
                      <Tooltip
                        content={
                          <ChartTooltip
                            valueFormatter={(v) => formatCurrency(v, currency)}
                          />
                        }
                      />
                      <Bar dataKey="dailyPnl" name="Daily P&L">
                        {dailyPnlSeries.map((entry, index) => (
                          <Cell
                            key={`${entry.date}-${index}`}
                            fill={entry.dailyPnl >= 0 ? "#34d399" : "#f87171"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Exit reasons</CardTitle>
              {exitReasons.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">No closed trades yet</p>
              ) : (
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={exitReasons}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, percent }) =>
                          `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        {exitReasons.map((_, index) => (
                          <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownTable title="By symbol (R)" rows={symbolBreakdown} currency={currency} />
            <BreakdownTable title="By hour (ET entry)" rows={hourBreakdown} currency={currency} />
            <BreakdownTable title="By exit reason (R)" rows={exitBreakdown} currency={currency} />
            <BreakdownTable
              title="By Jev BUY band (R)"
              rows={bandBreakdown}
              currency={currency}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>P&L by symbol</CardTitle>
              {symbolPnl.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">No closed trades yet</p>
              ) : (
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={symbolPnl} layout="vertical">
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} />
                      <YAxis
                        type="category"
                        dataKey="symbol"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        width={50}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            valueFormatter={(v) => formatCurrency(v, currency)}
                          />
                        }
                      />
                      <Bar dataKey="pnl" name="P&L">
                        {symbolPnl.map((entry, index) => (
                          <Cell
                            key={`${entry.symbol}-${index}`}
                            fill={entry.pnl >= 0 ? "#34d399" : "#f87171"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Veto / skip reasons</CardTitle>
              {vetoRows.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">No skip reasons logged yet</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-zinc-500">
                      <tr>
                        <th className="pb-2 font-medium">Reason</th>
                        <th className="pb-2 font-medium tabular-nums">n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vetoRows.map((row) => (
                        <tr key={row.label} className="border-t border-zinc-800">
                          <td className="py-2 text-zinc-200">{row.label}</td>
                          <td className="py-2 tabular-nums text-zinc-400">{row.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {tab === "calibration" && (
        <div className="space-y-6">
          <p className="text-sm text-zinc-500">
            Probabilities are not claimed edge until the reliability curve looks trustworthy.
            Taken trades use TP/SL outcomes; rejected signals use forward return sign.
          </p>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "both" as const, label: "Taken + rejected" },
                { id: "taken" as const, label: "Taken only" },
                { id: "rejected" as const, label: "Rejected only" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setCalSource(id)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition",
                  calSource === id
                    ? "bg-violet-900/50 text-violet-300"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Samples" value={String(calibration.n)} />
            <StatCard
              label="Brier score"
              value={calibration.brier == null ? "—" : calibration.brier.toFixed(4)}
              hint="Lower is better (0 = perfect)"
            />
            <StatCard
              label="Taken / rejected"
              value={`${takenSamples.length} / ${rejectedSamples.length}`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Reliability curve</CardTitle>
              {reliabilityChart.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">Not enough calibration samples</p>
              ) : (
                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reliabilityChart}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="mid"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        label={{
                          value: "Predicted %",
                          position: "insideBottom",
                          offset: -2,
                          fill: "#71717a",
                          fontSize: 10,
                        }}
                      />
                      <YAxis
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        domain={[0, 100]}
                        width={40}
                        label={{
                          value: "Hit %",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#71717a",
                          fontSize: 10,
                        }}
                      />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="hitRate"
                        name="Empirical"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="perfect"
                        name="Perfect"
                        stroke="#52525b"
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Calibration bins</CardTitle>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="pb-2 font-medium">Bin</th>
                      <th className="pb-2 font-medium tabular-nums">n</th>
                      <th className="pb-2 font-medium tabular-nums">Hit rate</th>
                      <th className="pb-2 font-medium tabular-nums">Wilson CI</th>
                      <th className="pb-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calibration.bins.map((bin) => (
                      <tr key={bin.binIndex} className="border-t border-zinc-800">
                        <td className="py-2 text-zinc-200">
                          {(bin.lo * 100).toFixed(0)}–{(bin.hi * 100).toFixed(0)}%
                        </td>
                        <td className="py-2 tabular-nums text-zinc-400">{bin.n}</td>
                        <td className="py-2 tabular-nums text-zinc-200">
                          {bin.hitRate == null ? "—" : formatPercent(bin.hitRate)}
                        </td>
                        <td className="py-2 tabular-nums text-zinc-400">
                          {bin.ciLow == null || bin.ciHigh == null
                            ? "—"
                            : `${(bin.ciLow * 100).toFixed(0)}–${(bin.ciHigh * 100).toFixed(0)}%`}
                        </td>
                        <td className="py-2 text-xs text-amber-400/90">
                          {bin.n > 0 && bin.insufficient ? "Insufficient" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "execution" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="|Slippage| total"
              value={formatCurrency(execCosts.slippageAbs, currency)}
              hint={`${execCosts.nWithSlippage} trades with slippage`}
            />
            <StatCard
              label="Commission total"
              value={formatCurrency(execCosts.commission, currency)}
            />
            <StatCard
              label="Total execution cost"
              value={formatCurrency(execCosts.total, currency)}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Slippage histogram</CardTitle>
              {slipBuckets.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">No slippage data yet</p>
              ) : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={slipBuckets}>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 9 }} />
                      <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={40} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" name="Count" fill="#60a5fa" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>MAE vs MFE</CardTitle>
              {maeMfe.length === 0 ? (
                <p className="mt-4 text-sm text-zinc-500">No MAE/MFE data yet</p>
              ) : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                      <XAxis
                        type="number"
                        dataKey="mae"
                        name="MAE"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        label={{
                          value: "MAE",
                          position: "insideBottom",
                          offset: -2,
                          fill: "#71717a",
                          fontSize: 10,
                        }}
                      />
                      <YAxis
                        type="number"
                        dataKey="mfe"
                        name="MFE"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        width={50}
                        label={{
                          value: "MFE",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#71717a",
                          fontSize: 10,
                        }}
                      />
                      <ZAxis range={[40, 40]} />
                      <Tooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0]?.payload as {
                            symbol: string;
                            mae: number;
                            mfe: number;
                            pnl: number;
                          };
                          return (
                            <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs">
                              <p className="text-zinc-200">{p.symbol}</p>
                              <p className="text-zinc-400">
                                MAE {p.mae.toFixed(3)} · MFE {p.mfe.toFixed(3)}
                              </p>
                              <p className={p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                                {formatCurrency(p.pnl, currency)}
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Scatter
                        name="Wins"
                        data={maeMfe.filter((p) => p.win)}
                        fill="#34d399"
                      />
                      <Scatter
                        name="Losses"
                        data={maeMfe.filter((p) => !p.win)}
                        fill="#f87171"
                      />
                      <Legend />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
