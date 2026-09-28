"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardTitle } from "@/components/ui/card";
import type { PortfolioSnapshot } from "@/lib/types/database";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";
import { formatCurrency } from "@/lib/utils";

type Props = {
  data: PortfolioSnapshot[];
  currency?: string;
};

export function PortfolioChart({ data, currency = "USD" }: Props) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtimeRefresh(["portfolio_history"], refresh);

  const chartData = data.map((row) => ({
    time: new Date(row.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    equity: Number(row.equity),
  }));

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardTitle>Equity (24h)</CardTitle>
      {chartData.length === 0 ? (
        <p className="mt-8 text-center text-sm text-zinc-500">No portfolio history yet</p>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="time" stroke="#71717a" fontSize={12} />
              <YAxis stroke="#71717a" fontSize={12} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46" }}
                formatter={(value) => formatCurrency(Number(value), currency)}
              />
              <Line type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
