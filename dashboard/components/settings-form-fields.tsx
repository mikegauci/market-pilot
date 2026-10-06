"use client";

import { Input } from "@/components/ui/input";
import { SettingsField } from "@/components/settings-section";
import {
  formatRiskPct,
  getRecommendedValuesForProfile,
  isNearRecommended,
  pctOfEquity,
  RISK_PROFILES,
  type RiskProfile,
  type RiskRecommendationKey,
} from "@/lib/risk-recommendations";
import type { StrategyHint } from "@/lib/strategy-recommendations";
import { cn, formatCurrency } from "@/lib/utils";

export function StrategyHintLine({ hint }: { hint: StrategyHint }) {
  return (
    <p
      className={cn(
        "text-xs leading-relaxed",
        hint.tone === "ok" && "text-emerald-400/90",
        hint.tone === "info" && "text-zinc-500",
        hint.tone === "warn" && "text-amber-400/90",
      )}
    >
      {hint.message}
    </p>
  );
}

type RiskFieldProps = {
  id: RiskRecommendationKey;
  label: string;
  description: string;
  descriptionFull: string;
  value: number;
  onChange: (value: number) => void;
  baselineEquity: number;
  currency: string;
  profile: RiskProfile;
};

export function RiskField({
  id,
  label,
  description,
  descriptionFull,
  value,
  onChange,
  baselineEquity,
  currency,
  profile,
}: RiskFieldProps) {
  const targetPct = RISK_PROFILES[profile][id];
  const pct = pctOfEquity(value, baselineEquity);
  const recommended = getRecommendedValuesForProfile(baselineEquity, profile)[id];
  const matchesRecommended = isNearRecommended(value, baselineEquity, targetPct);

  return (
    <SettingsField
      id={id}
      label={label}
      description={description}
      descriptionTitle={descriptionFull}
    >
      <div className="space-y-1.5">
        <Input
          id={id}
          name={id}
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(next);
          }}
          required
          className={cn(
            matchesRecommended && "border-emerald-800/50 focus:border-emerald-600",
          )}
        />
        {matchesRecommended && baselineEquity > 0 && (
          <span className="block text-[10px] font-medium uppercase tracking-wide text-emerald-400">
            Recommended
          </span>
        )}
        {baselineEquity > 0 && pct != null && (
          <p
            className={cn(
              "text-xs",
              matchesRecommended ? "text-emerald-400/90" : "text-amber-400/90",
            )}
          >
            {formatRiskPct(pct)} of {formatCurrency(baselineEquity, currency)}
            {!matchesRecommended &&
              ` · Suggested ${formatCurrency(recommended, currency)}`}
          </p>
        )}
      </div>
    </SettingsField>
  );
}

type StrategyPercentFieldProps = {
  id: "stop_loss_percentage" | "take_profit_percentage";
  label: string;
  description: string;
  descriptionFull: string;
  value: number;
  onChange: (value: number) => void;
  hints: StrategyHint[];
  matchesRecommended: boolean;
};

export function StrategyPercentField({
  id,
  label,
  description,
  descriptionFull,
  value,
  onChange,
  hints,
  matchesRecommended,
}: StrategyPercentFieldProps) {
  return (
    <SettingsField
      id={id}
      label={label}
      description={description}
      descriptionTitle={descriptionFull}
    >
      <div className="space-y-1.5">
        <Input
          id={id}
          name={id}
          type="number"
          step="0.1"
          min="0.1"
          max="25"
          value={value}
          onChange={(e) => {
            const next = parseFloat(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(next);
          }}
          required
          className={cn(
            matchesRecommended && "border-emerald-800/50 focus:border-emerald-600",
          )}
        />
        {matchesRecommended && (
          <span className="block text-[10px] font-medium uppercase tracking-wide text-emerald-400">
            Recommended
          </span>
        )}
        <div className="space-y-1">
          {hints.map((hint) => (
            <StrategyHintLine key={hint.message} hint={hint} />
          ))}
        </div>
      </div>
    </SettingsField>
  );
}
