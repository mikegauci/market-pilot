import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { RiskRecommendationStatusContent } from "@/components/risk-recommendation-status-content";
import {
  areAllRecommendationsApplied,
  formatProfileTitle,
  formatRiskPct,
  getRecommendedValuesForProfile,
  isNearRecommended,
  pctOfEquity,
  resolveRiskProfile,
  RISK_PROFILES,
  type RiskProfile,
  type RiskRecommendationKey,
} from "@/lib/risk-recommendations";
import { StrategyIndicatorsCard } from "@/components/strategy-indicators-card";
import type { Settings } from "@/lib/types/database";
import { formatStrategyPercent } from "@/lib/strategy-recommendations";
import { formatCurrency, formatPercent } from "@/lib/utils";

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-2 last:border-0">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="truncate text-right text-sm font-medium text-zinc-100">{value}</span>
    </div>
  );
}

function formatRiskRow(
  key: RiskRecommendationKey,
  amount: number,
  baselineEquity: number,
  currency: string,
  profile: RiskProfile,
): string {
  const formatted = formatCurrency(amount, currency);
  if (baselineEquity <= 0) return formatted;

  const pct = pctOfEquity(amount, baselineEquity);
  const recommended = getRecommendedValuesForProfile(baselineEquity, profile)[key];
  const matches = isNearRecommended(amount, baselineEquity, RISK_PROFILES[profile][key]);

  let value = pct != null ? `${formatted} (${formatRiskPct(pct)})` : formatted;
  if (!matches && recommended > 0) {
    value += ` → ${formatCurrency(recommended, currency)}`;
  }
  return value;
}

export function SettingsSummary({
  settings,
  currentEquity,
  baselineEquity,
  currency = "USD",
}: {
  settings: Settings;
  currentEquity: number;
  baselineEquity: number;
  currency?: string;
}) {
  const profile = resolveRiskProfile(settings.risk_profile);

  const savedValues = {
    risk_per_trade: settings.risk_per_trade,
    max_position_size: settings.max_position_size,
    max_daily_loss: settings.max_daily_loss,
  };

  const allApplied = areAllRecommendationsApplied(savedValues, baselineEquity, profile);

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

      <div className="mt-3 flex-1">
        <SettingRow label="Risk profile" value={formatProfileTitle(profile)} />
        <SettingRow
          label="Min Jev confidence"
          value={formatPercent(settings.minimum_jev_confidence)}
        />
        <SettingRow
          label="Signal threshold"
          value={formatPercent(settings.signal_record_threshold)}
        />
        <SettingRow
          label="Risk per trade"
          value={formatRiskRow(
            "risk_per_trade",
            settings.risk_per_trade,
            baselineEquity,
            currency,
            profile,
          )}
        />
        <SettingRow
          label="Max position"
          value={formatRiskRow(
            "max_position_size",
            settings.max_position_size,
            baselineEquity,
            currency,
            profile,
          )}
        />
        <SettingRow
          label="Max daily loss"
          value={formatRiskRow(
            "max_daily_loss",
            settings.max_daily_loss,
            baselineEquity,
            currency,
            profile,
          )}
        />
        <SettingRow label="Max open positions" value={String(settings.max_open_positions)} />
        <SettingRow
          label="Stop loss"
          value={formatStrategyPercent(settings.stop_loss_percentage)}
        />
        <SettingRow
          label="Take profit"
          value={formatStrategyPercent(settings.take_profit_percentage)}
        />
        <SettingRow
          label="Max hold"
          value={
            settings.max_hold_minutes > 0
              ? `${settings.max_hold_minutes} min`
              : "Off"
          }
        />
      </div>

      <div className="mt-3 border-t border-zinc-800/60 pt-3 space-y-2">
        <div>
          <p className="text-xs text-zinc-500">Effective watchlist</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">
            {settings.watchlist.join(", ")}
          </p>
        </div>
        {settings.watchlist_dynamic_enabled && (
          <p className="text-xs text-zinc-500">
            Jev dynamic EM scan every {settings.watchlist_refresh_minutes ?? 30} min · top{" "}
            {settings.watchlist_dynamic_size ?? 5} · benchmark {settings.benchmark_symbol ?? "EEM"}
          </p>
        )}
        <StrategyIndicatorsCard
          compact
          benchmarkSymbol={settings.benchmark_symbol ?? "EEM"}
        />
      </div>
    </Card>
  );
}
