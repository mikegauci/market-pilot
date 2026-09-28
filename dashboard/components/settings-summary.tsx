import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import type { Settings } from "@/lib/types/database";
import { formatCurrency } from "@/lib/utils";

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-2 last:border-0">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="truncate text-right text-sm font-medium text-zinc-100">{value}</span>
    </div>
  );
}

export function SettingsSummary({ settings }: { settings: Settings }) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <CardTitle>Risk & Strategy</CardTitle>
        <Link
          href="/settings"
          className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300"
        >
          Edit
        </Link>
      </div>

      <div className="mt-3 flex-1">
        <SettingRow label="Min Jev confidence" value={String(settings.minimum_jev_confidence)} />
        <SettingRow label="Signal threshold" value={String(settings.signal_record_threshold)} />
        <SettingRow label="Risk per trade" value={formatCurrency(settings.risk_per_trade)} />
        <SettingRow label="Max position" value={formatCurrency(settings.max_position_size)} />
        <SettingRow label="Max daily loss" value={formatCurrency(settings.max_daily_loss)} />
        <SettingRow label="Max open positions" value={String(settings.max_open_positions)} />
        <SettingRow label="Stop loss" value={String(settings.stop_loss_percentage)} />
        <SettingRow label="Take profit" value={String(settings.take_profit_percentage)} />
      </div>

      <div className="mt-3 border-t border-zinc-800/60 pt-3">
        <p className="text-xs text-zinc-500">Watchlist</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-300">{settings.watchlist.join(", ")}</p>
      </div>
    </Card>
  );
}
