"use client";

import {
  formatProfileTitle,
  formatRiskPct,
  getRecommendedValuesForProfile,
  RISK_PROFILE_LABELS,
  RISK_PROFILE_ORDER,
  RISK_PROFILES,
  type RiskProfile,
} from "@/lib/risk-recommendations";
import { cn, formatCurrency } from "@/lib/utils";

type RiskProfilePickerProps = {
  selectedProfile: RiskProfile;
  onSelect: (profile: RiskProfile) => void;
  baselineEquity: number;
  currency: string;
  appliedProfile: RiskProfile | null;
  valuesMatchSelected: boolean;
};

export function RiskProfilePicker({
  selectedProfile,
  onSelect,
  baselineEquity,
  currency,
  appliedProfile,
  valuesMatchSelected,
}: RiskProfilePickerProps) {
  if (baselineEquity <= 0) {
    return (
      <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-sm text-zinc-400">Equity unavailable — risk profiles cannot be calculated.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-zinc-200">Risk profile</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Selecting a preset fills the risk fields below. Save settings to persist profile and amounts.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {RISK_PROFILE_ORDER.map((profile) => {
          const recommended = getRecommendedValuesForProfile(baselineEquity, profile);
          const pcts = RISK_PROFILES[profile];
          const isSelected = selectedProfile === profile;
          const isApplied = appliedProfile === profile && valuesMatchSelected;

          return (
            <button
              key={profile}
              type="button"
              onClick={() => onSelect(profile)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                isApplied
                  ? "border-emerald-800/60 bg-emerald-950/30"
                  : isSelected
                    ? "border-amber-700/50 bg-amber-950/20"
                    : "border-zinc-800/80 bg-zinc-950/30 hover:border-zinc-700",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100">
                  {formatProfileTitle(profile)}
                </span>
                {isApplied && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-400">
                    Applied
                  </span>
                )}
                {isSelected && !isApplied && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-400">
                    Selected
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">{RISK_PROFILE_LABELS[profile].description}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-zinc-400">
                <li>
                  Risk: {formatCurrency(recommended.risk_per_trade, currency)} (
                  {formatRiskPct(pcts.risk_per_trade)})
                </li>
                <li>
                  Max pos: {formatCurrency(recommended.max_position_size, currency)} (
                  {formatRiskPct(pcts.max_position_size)})
                </li>
                <li>
                  Daily loss: {formatCurrency(recommended.max_daily_loss, currency)} (
                  {formatRiskPct(pcts.max_daily_loss)})
                </li>
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}
