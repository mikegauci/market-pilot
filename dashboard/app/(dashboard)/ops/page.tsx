import { ShieldAlert } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import {
  getBotStatus,
  getOpenTrades,
  getRecentDecisionLogs,
  getRecentReconciliationEvents,
  getRecentSettingsAudit,
  getSettings,
} from "@/lib/queries";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type {
  DecisionLogRow,
  ReconciliationEvent,
  SettingsAuditLog,
  Trade,
} from "@/lib/types/database";

function heartbeatAgeLabel(lastHeartbeat: string | null | undefined): string {
  if (!lastHeartbeat) return "—";
  const ageSec = Math.max(
    0,
    Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 1000),
  );
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  return `${Math.round(ageSec / 3600)}h ago`;
}

function protectionLabel(trade: Trade): { label: string; ok: boolean } {
  const hasSl = trade.stop_loss != null && Number(trade.stop_loss) > 0;
  const hasTp = trade.take_profit != null && Number(trade.take_profit) > 0;
  if (hasSl && hasTp) return { label: "Protected (SL+TP)", ok: true };
  if (hasSl) return { label: "Partial (SL only)", ok: false };
  if (hasTp) return { label: "Partial (TP only)", ok: false };
  return { label: "Unprotected", ok: false };
}

function plannedRisk(
  trade: Trade,
  stopLossPct: number | null | undefined,
): number | null {
  if (!stopLossPct || stopLossPct <= 0) return null;
  return trade.quantity * trade.entry_price * stopLossPct;
}

export default async function OpsPage() {
  const [status, settings, openTrades, reconcileEvents, audits, decisions] =
    await Promise.all([
      getBotStatus(),
      getSettings(),
      getOpenTrades(),
      getRecentReconciliationEvents(20),
      getRecentSettingsAudit(20),
      getRecentDecisionLogs(30),
    ]);

  const stopPct = settings?.stop_loss_percentage ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h2 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <ShieldAlert className="h-5 w-5 text-emerald-400" />
          Ops
        </h2>
        <p className="text-sm text-zinc-400">
          Engine health, reconciliation, position protection, and recent settings
          changes.{" "}
          <span className="text-zinc-300">Pause new entries</span> (bot off, entry
          kill, or risk halt) leaves open positions managed.{" "}
          <span className="text-zinc-300">Close position</span> is a separate
          trade command.
        </p>
      </header>

      <Card className="space-y-3 p-4">
        <CardTitle className="text-base">System status</CardTitle>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <StatusRow
            label="Trading mode"
            value={status?.trading_mode ?? "—"}
          />
          <StatusRow
            label="Execution mode"
            value={status?.execution_mode ?? "—"}
          />
          <StatusRow
            label="Bot enabled"
            value={status?.enabled ? "On (entries allowed)" : "Off (pause new entries)"}
          />
          <StatusRow
            label="Heartbeat"
            value={heartbeatAgeLabel(status?.last_heartbeat)}
          />
          <StatusRow
            label="IBKR"
            value={status?.ibkr_connected ? "Connected" : "Disconnected"}
          />
          <StatusRow
            label="Jev"
            value={status?.jev_connected ? "Connected" : "Waiting"}
          />
          <StatusRow
            label="Quote age p50 / p95"
            value={
              status?.quote_age_p50_sec != null || status?.quote_age_p95_sec != null
                ? `${status?.quote_age_p50_sec ?? "—"}s / ${status?.quote_age_p95_sec ?? "—"}s`
                : "—"
            }
          />
          <StatusRow
            label="Last reconcile"
            value={
              status?.last_reconcile_at
                ? `${formatDateTime(status.last_reconcile_at)}${
                    status.reconcile_ok === false
                      ? ` · Issue: ${status.reconcile_detail || "needs attention"}`
                      : status.reconcile_ok === true
                        ? " · OK"
                        : ""
                  }`
                : "—"
            }
          />
          <StatusRow
            label="Telegram notifier"
            value={
              status?.notifier_configured == null
                ? "—"
                : status.notifier_configured
                  ? "Configured"
                  : "Not configured"
            }
          />
          <StatusRow
            label="Entry kill"
            value={
              status?.entry_kill_active
                ? `ON · ${status.entry_kill_reason || "active"}`
                : "Off"
            }
          />
          <StatusRow
            label="Risk halt"
            value={
              status?.risk_halt_active
                ? `ON · ${status.risk_halt_reason || "active"}${
                    status.daily_pnl != null
                      ? ` · daily ${Number(status.daily_pnl).toFixed(0)}`
                      : ""
                  }`
                : "Off"
            }
          />
        </dl>
      </Card>

      <Card className="space-y-3 p-4">
        <CardTitle className="text-base">Open positions & protection</CardTitle>
        {openTrades.length === 0 ? (
          <p className="text-sm text-zinc-500">No open positions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Entry</th>
                  <th className="py-2 pr-3">Protection</th>
                  <th className="py-2">Planned risk</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((trade) => {
                  const prot = protectionLabel(trade);
                  const risk = plannedRisk(trade, stopPct);
                  return (
                    <tr key={trade.id} className="border-t border-zinc-800">
                      <td className="py-2 pr-3 font-medium text-zinc-100">
                        {trade.symbol}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{trade.quantity}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatCurrency(trade.entry_price)}
                      </td>
                      <td
                        className={`py-2 pr-3 ${
                          prot.ok ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {prot.label}
                      </td>
                      <td className="py-2 tabular-nums text-zinc-300">
                        {risk != null ? formatCurrency(risk) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <CardTitle className="text-base">Recent reconciliation</CardTitle>
        <EventList events={reconcileEvents} />
      </Card>

      <Card className="space-y-3 p-4">
        <CardTitle className="text-base">Recent decisions</CardTitle>
        <DecisionList rows={decisions} />
      </Card>

      <Card className="space-y-3 p-4">
        <CardTitle className="text-base">Settings audit</CardTitle>
        <AuditList rows={audits} />
      </Card>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-zinc-200">{value}</dd>
    </div>
  );
}

function EventList({ events }: { events: ReconciliationEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-zinc-500">No reconciliation events yet.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {events.map((ev) => {
        const unresolved = !ev.resolved_at;
        return (
          <li
            key={ev.id}
            className={`rounded border px-3 py-2 ${
              unresolved
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-zinc-800 bg-zinc-950/40"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-zinc-200">
                {ev.symbol} · {ev.event_type}
              </span>
              <span className="text-xs text-zinc-500">
                {formatDateTime(ev.created_at)}
                {unresolved ? " · unresolved" : ""}
              </span>
            </div>
            {ev.detail ? (
              <p className="mt-1 text-xs text-zinc-500">
                {typeof ev.detail === "string"
                  ? ev.detail
                  : JSON.stringify(ev.detail)}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function DecisionList({ rows }: { rows: DecisionLogRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No decision logs yet.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-zinc-200">
              {row.symbol} · {row.outcome}
            </span>
            <span className="text-xs text-zinc-500">
              {formatDateTime(row.eval_at || row.created_at)}
            </span>
          </div>
          {(row.reasons ?? []).length > 0 ? (
            <p className="mt-1 text-xs text-zinc-400">
              {(row.reasons ?? []).join(" · ")}
            </p>
          ) : (
            <p className="mt-1 text-xs text-emerald-400/80">Accepted / no skip reasons</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function AuditList({ rows }: { rows: SettingsAuditLog[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No settings changes logged yet.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-zinc-200">
              {row.action}
              {row.actor_email ? ` · ${row.actor_email}` : ""}
            </span>
            <span className="text-xs text-zinc-500">
              {formatDateTime(row.created_at)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
