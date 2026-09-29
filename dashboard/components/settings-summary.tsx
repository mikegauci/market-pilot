import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { RiskRecommendationStatusContent } from "@/components/risk-recommendation-status-content";
import {
  areAllRecommendationsApplied,
  formatProfileTitle,
  resolveRiskProfile,
} from "@/lib/risk-recommendations";
import type { Settings } from "@/lib/types/database";
import { cn, formatPercent } from "@/lib/utils";

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-2 last:border-0">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="truncate text-right text-sm font-medium text-zinc-100">{value}</span>
    </div>
  );
}

export function SettingsSummary({
  settings,
  currentEquity,
  baselineEquity,
  currency = "USD",
  className,
}: {
  settings: Settings;
  currentEquity: number;
  baselineEquity: number;
  currency?: string;
  className?: string;
}) {
  const profile = resolveRiskProfile(settings.risk_profile);

  const savedValues = {
    risk_per_trade: settings.risk_per_trade,
    max_position_size: settings.max_position_size,
    max_daily_loss: settings.max_daily_loss,
  };

  const allApplied = areAllRecommendationsApplied(savedValues, baselineEquity, profile);
  const watchlistCount = settings.watchlist.length;

  return (
    <Card className={cn("h-full", className)}>
      <div className="flex items-start justify-between gap-2">
        <CardTitle>Risk & Strategy</CardTitle>
        <Link
          href="/settings"
          className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300"
        >
          Edit
        </Link>
      </div>

      <RiskRecommendationStatusContent
        className="mt-3"
        baselineEquity={baselineEquity}
        currentEquity={currentEquity}
        currency={currency}
        profile={profile}
        allApplied={allApplied}
        savedValues={savedValues}
        compact
      />

      <div className="mt-3">
        <SettingRow label="Risk profile" value={formatProfileTitle(profile)} />
        <SettingRow
          label="Min Jev confidence"
          value={formatPercent(settings.minimum_jev_confidence)}
        />
        <SettingRow label="Max open positions" value={String(settings.max_open_positions)} />
        <SettingRow
          label="Watchlist"
          value={`${watchlistCount} symbol${watchlistCount === 1 ? "" : "s"}`}
        />
      </div>

      <Link
        href="/strategy"
        className="mt-3 inline-block text-xs text-emerald-400 hover:text-emerald-300"
      >
        View strategy guide →
      </Link>
    </Card>
  );
}
