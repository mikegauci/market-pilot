"use client";

import { SettingsNumberInput } from "@/components/settings-number-input";
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
import type { SettingDescriptionKey } from "@/lib/settings-form-descriptions";
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
  fieldKey?: SettingDescriptionKey;
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
  fieldKey,
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
      fieldKey={fieldKey}
      label={label}
      description={description}
      descriptionTitle={descriptionFull}
    >
      <div className="space-y-1.5">
        <SettingsNumberInput
          id={id}
          name={id}
          step="0.01"
          value={value}
          onChange={onChange}
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
        {baselineEquity > 0 && !matchesRecommended && pct != null && (
          <p className="text-xs text-amber-400/90">
            {formatRiskPct(pct)} of Equity · Suggested {formatCurrency(recommended, currency)}
          </p>
        )}
      </div>
    </SettingsField>
  );
}

type StrategyPercentFieldProps = {
  id: "stop_loss_percentage" | "take_profit_percentage";
  fieldKey?: SettingDescriptionKey;
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
  fieldKey,
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
      fieldKey={fieldKey ?? id}
      label={label}
      description={description}
      descriptionTitle={descriptionFull}
    >
      <div className="space-y-1.5">
        <SettingsNumberInput
          id={id}
          name={id}
          step="0.1"
          min="0.1"
          max="25"
          value={value}
          onChange={onChange}
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
        {hints.length > 0 ? (
          <div className="space-y-1">
            {hints.map((hint) => (
              <StrategyHintLine key={hint.message} hint={hint} />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsField>
  );
}
