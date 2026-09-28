import type { ReactNode } from "react";
import {
  detectMatchingProfile,
  formatProfileTitle,
  formatRiskPct,
  getRecommendedValuesForProfile,
  RISK_PROFILES,
  type RiskProfile,
  type RiskRecommendationKey,
} from "@/lib/risk-recommendations";
import { cn, formatCurrency } from "@/lib/utils";

export type RiskRecommendationStatusContentProps = {
  baselineEquity: number;
  currentEquity: number;
  currency: string;
  profile: RiskProfile;
  allApplied: boolean;
  savedValues?: Record<RiskRecommendationKey, number>;
  className?: string;
  compact?: boolean;
  actions?: ReactNode;
};

function TierContext({
  baselineEquity,
  currentEquity,
  currency,
}: {
  baselineEquity: number;
  currentEquity: number;
  currency: string;
}) {
  if (baselineEquity <= 0) return null;

  const showCurrent =
    currentEquity > 0 && Math.abs(currentEquity - baselineEquity) / baselineEquity >= 0.001;

  return (
    <p className="text-xs text-zinc-500">
      Based on {formatCurrency(baselineEquity, currency)} equity tier
      {showCurrent && ` (current: ${formatCurrency(currentEquity, currency)})`}
    </p>
  );
}

export function RiskRecommendationStatusContent({
  baselineEquity,
  currentEquity,
  currency,
  profile,
  allApplied,
  savedValues,
  className,
  compact = false,
  actions,
}: RiskRecommendationStatusContentProps) {
  if (baselineEquity <= 0) {
    return (
      <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900/50 p-3", className)}>
        <p className="text-xs text-zinc-500">Equity unavailable — recommendations cannot be calculated.</p>
      </div>
    );
  }

  const recommended = getRecommendedValuesForProfile(baselineEquity, profile);
  const pcts = RISK_PROFILES[profile];
  const matchingProfile =
    savedValues != null ? detectMatchingProfile(savedValues, baselineEquity) : null;
  const profileMismatch =
    matchingProfile != null && matchingProfile !== profile && !allApplied;

  if (allApplied) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-3 py-2.5",
          className,
        )}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-900/80 text-xs text-emerald-400">
          ✓
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-300">
            {formatProfileTitle(profile)} risk profile applied
          </p>
          {!compact && (
            <TierContext
              baselineEquity={baselineEquity}
              currentEquity={currentEquity}
              currency={currency}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-900/40 bg-amber-950/20 p-3",
        className,
      )}
    >
      <div className={cn("flex gap-3", actions ? "flex-col sm:flex-row sm:items-start sm:justify-between" : "")}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-100/90">
            {compact
              ? `${formatProfileTitle(profile)} profile — update suggested`
              : `${formatProfileTitle(profile)} risk profile — suggested values`}
          </p>
          <TierContext
            baselineEquity={baselineEquity}
            currentEquity={currentEquity}
            currency={currency}
          />
          {profileMismatch && (
            <p className="mt-1 text-xs text-zinc-400">
              Saved values match {formatProfileTitle(matchingProfile)} profile.
            </p>
          )}
          {!compact && (
            <ul className="mt-2 space-y-1 text-xs text-amber-200/60">
              <li>
                Risk per trade: {formatCurrency(recommended.risk_per_trade, currency)} (
                {formatRiskPct(pcts.risk_per_trade)})
              </li>
              <li>
                Max position: {formatCurrency(recommended.max_position_size, currency)} (
                {formatRiskPct(pcts.max_position_size)})
              </li>
              <li>
                Max daily loss: {formatCurrency(recommended.max_daily_loss, currency)} (
                {formatRiskPct(pcts.max_daily_loss)})
              </li>
            </ul>
          )}
        </div>
        {actions}
      </div>
    </div>
  );
}
