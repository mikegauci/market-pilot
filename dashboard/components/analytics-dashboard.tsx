"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardTitle } from "@/components/ui/card";
import {
  fetchClosedTrades,
  fetchPortfolioHistory,
  fetchPredictions,
} from "@/lib/data-client";
import { computeJevCalibration } from "@/lib/jev-calibration";
import { useLiveQuery } from "@/lib/hooks/use-live-query";
import {
  buildDailyPnlSeries,
  buildEquitySeries,
  filterPortfolioByRange,
  maxDrawdownPct,
  type PortfolioRange,
} from "@/lib/portfolio-analytics";
import {
  computeTradeStats,
  exitReasonBreakdown,
  pnlBySymbol,
} from "@/lib/trade-analytics";
import type { PortfolioSnapshot, Prediction, Trade } from "@/lib/types/database";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

type Props = {
  portfolioHistory: PortfolioSnapshot[];
  closedTrades: Trade[];
  currency: string;
};

const RANGE_OPTIONS: { value: PortfolioRange; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "All" },
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
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card className="p-4">
      <CardTitle>{label}</CardTitle>
      <p className={cn("mt-2 text-xl font-semibold tabular-nums text-zinc-100", valueClassName)}>
        {value}
      </p>
    </Card>
  );
}

export function AnalyticsDashboard({ portfolioHistory, closedTrades, currency }: Props) {
  const [range, setRange] = useState<PortfolioRange>("1w");

  const loadHistory = useCallback(() => fetchPortfolioHistory(), []);
  const loadTrades = useCallback(() => fetchClosedTrades(), []);
  const loadPredictions = useCallback(() => fetchPredictions(2000), []);

  const liveHistory = useLiveQuery(portfolioHistory, loadHistory, ["portfolio_history"]);
  const liveTrades = useLiveQuery(closedTrades, loadTrades, ["trades"]);
  const livePredictions = useLiveQuery([] as Prediction[], loadPredictions, ["predictions"]);

  const filtered = useMemo(
    () => filterPortfolioByRange(liveHistory, range),
    [liveHistory, range],
  );
  const equitySeries = useMemo(() => buildEquitySeries(filtered), [filtered]);
  const dailyPnlSeries = useMemo(() => buildDailyPnlSeries(filtered), [filtered]);
  const stats = useMemo(() => computeTradeStats(liveTrades), [liveTrades]);
  const symbolPnl = useMemo(() => pnlBySymbol(liveTrades).slice(0, 8), [liveTrades]);
  const exitReasons = useMemo(() => exitReasonBreakdown(liveTrades), [liveTrades]);
  const maxDd = useMemo(() => maxDrawdownPct(filtered), [filtered]);
  const calibration = useMemo(
    () => computeJevCalibration(livePredictions),
    [livePredictions],
  );

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

  return (
    <div className="space-y-6">
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
        <StatCard label="Max drawdown" value={`${maxDd.toFixed(1)}%`} valueClassName="text-red-400" />
      </div>

      <Card>
        <CardTitle>Jev calibration (15m forward return)</CardTitle>
        <p className="mt-1 text-xs text-zinc-500">
          Mean realized 15-minute return by BUY probability bucket. A flat curve means the signal
          is not predictive yet.
        </p>
        {calibration.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            No matured predictions with forward returns yet
          </p>
        ) : (
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calibration}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} unit="%" />
                <Tooltip
                  contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }}
                  formatter={(value) => [
                    `${(typeof value === "number" ? value : Number(value ?? 0)).toFixed(3)}%`,
                    "Avg 15m return",
                  ]}
                />
                <Bar dataKey="avgReturn15m" fill="#34d399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
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
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} interval="preserveStartEnd" />
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
                  <XAxis dataKey="label" tick={{ fill: "#71717a", fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} width={50} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(2)}%`} />} />
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
          <CardTitle>Trade stats</CardTitle>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Closed trades</dt>
              <dd className="tabular-nums text-zinc-200">{stats.closedCount}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Wins / losses</dt>
              <dd className="tabular-nums text-zinc-200">
                {stats.winCount} / {stats.lossCount}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Avg win</dt>
              <dd className="tabular-nums text-emerald-400">
                {formatCurrency(stats.avgWin, currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Avg loss</dt>
              <dd className="tabular-nums text-red-400">
                {formatCurrency(stats.avgLoss, currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Avg hold time</dt>
              <dd className="tabular-nums text-zinc-200">
                {stats.avgHoldMinutes != null
                  ? `${Math.round(stats.avgHoldMinutes)} min`
                  : "—"}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
