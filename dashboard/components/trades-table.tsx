"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import type { Trade } from "@/lib/types/database";
import { useRealtimeRefresh } from "@/lib/hooks/use-realtime-refresh";
import { formatCurrency, formatDateTime } from "@/lib/utils";

type Props = {
  trades: Trade[];
  showFilter?: boolean;
  title?: string;
};

export function TradesTable({ trades, showFilter = false, title = "Trades" }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtimeRefresh(["trades"], refresh);

  const filtered =
    filter === "all" ? trades : trades.filter((t) => t.status === filter);

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <CardTitle>{title}</CardTitle>
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
                <th className="pb-2 pr-3">Symbol</th>
                <th className="pb-2 pr-3">Mode</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Entry</th>
                <th className="pb-2 pr-3">Exit</th>
                <th className="pb-2 pr-3">Qty</th>
                <th className="pb-2 pr-3">SL / TP</th>
                <th className="pb-2">PnL</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-zinc-800/50">
                  <td className="py-2 pr-3 font-medium">{t.symbol}</td>
                  <td className="py-2 pr-3">
                    <Badge
                      className={
                        t.execution_mode === "ibkr"
                          ? "bg-orange-900 text-orange-300"
                          : "bg-zinc-800 text-zinc-400"
                      }
                    >
                      {t.execution_mode ?? "simulated"}
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
                  <td
                    className={`py-2 ${
                      (t.net_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {t.net_pnl != null ? formatCurrency(t.net_pnl) : "—"}
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
