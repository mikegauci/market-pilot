export const RISK_PROFILES = {
  low: {
    risk_per_trade: 0.0015,
    max_position_size: 0.00375,
    max_daily_loss: 0.0075,
  },
  medium: {
    risk_per_trade: 0.0025,
    max_position_size: 0.005,
    max_daily_loss: 0.01,
  },
  high: {
    risk_per_trade: 0.004,
    max_position_size: 0.0075,
    max_daily_loss: 0.015,
  },
} as const;

/** @deprecated Use RISK_PROFILES.medium */
export const RISK_RECOMMENDATIONS = RISK_PROFILES.medium;

export const RISK_SYNC_THRESHOLD = 0.05;

export type RiskProfile = keyof typeof RISK_PROFILES;
export type RiskRecommendationKey = keyof typeof RISK_PROFILES.medium;

export const RISK_PROFILE_LABELS: Record<
  RiskProfile,
  { title: string; description: string }
> = {
  low: {
    title: "Low",
    description: "Safest — smallest positions and daily loss cap.",
  },
  medium: {
    title: "Medium",
    description: "Balanced — recommended for paper trading.",
  },
  high: {
    title: "High",
    description: "Aggressive — larger trades; more drawdown risk.",
  },
};

export const RISK_PROFILE_ORDER: RiskProfile[] = ["low", "medium", "high"];

export function isRiskProfile(value: string): value is RiskProfile {
  return value === "low" || value === "medium" || value === "high";
}

export function resolveRiskProfile(
  value: string | null | undefined,
  fallback: RiskProfile = "medium",
): RiskProfile {
  const raw = value ?? "";
  return isRiskProfile(raw) ? raw : fallback;
}

export function pctOfEquity(amount: number, equity: number): number | null {
  if (!Number.isFinite(amount) || !Number.isFinite(equity) || equity <= 0) {
    return null;
  }
  return amount / equity;
}

export function recommendedAmount(equity: number, pct: number): number {
  if (!Number.isFinite(equity) || equity <= 0 || !Number.isFinite(pct)) {
    return 0;
  }
  return Math.round(equity * pct * 100) / 100;
}

export function formatRiskPct(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(2)}%`;
}

export function formatProfileTitle(profile: RiskProfile): string {
  return RISK_PROFILE_LABELS[profile].title;
}

export function resolveBaselineEquity(
  riskSyncEquity: number | null | undefined,
  currentEquity: number,
  accountCapital: number,
): number {
  if (riskSyncEquity != null && riskSyncEquity > 0) return riskSyncEquity;
  if (accountCapital > 0) return accountCapital;
  if (currentEquity > 0) return currentEquity;
  return 0;
}

/** Current and baseline equity as shown on the Settings page (and fed to the AI summary). */
export function resolveSettingsEquities(
  settings: { account_capital: number; risk_sync_equity?: number | null },
  latestEquity: number | null | undefined,
): { currentEquity: number; baselineEquity: number } {
  const currentEquity = latestEquity ?? settings.account_capital;
  return {
    currentEquity,
    baselineEquity: resolveBaselineEquity(
      settings.risk_sync_equity,
      currentEquity,
      settings.account_capital,
    ),
  };
}

export function shouldAdvanceBaseline(
  currentEquity: number,
  baselineEquity: number | null | undefined,
  threshold = RISK_SYNC_THRESHOLD,
): boolean {
  if (currentEquity <= 0) return false;
  if (baselineEquity == null || baselineEquity <= 0) return true;
  return Math.abs(currentEquity - baselineEquity) / baselineEquity >= threshold;
}

export function getRecommendedValuesForProfile(
  baselineEquity: number,
  profile: RiskProfile,
) {
  const pcts = RISK_PROFILES[profile];
  return {
    risk_per_trade: recommendedAmount(baselineEquity, pcts.risk_per_trade),
    max_position_size: recommendedAmount(baselineEquity, pcts.max_position_size),
    max_daily_loss: recommendedAmount(baselineEquity, pcts.max_daily_loss),
  };
}

export function isNearRecommended(
  amount: number,
  equity: number,
  targetPct: number,
  tolerance = 0.01,
): boolean {
  const recommended = recommendedAmount(equity, targetPct);
  if (recommended <= 0) return false;
  return Math.abs(amount - recommended) / recommended <= tolerance;
}

export function areAllRecommendationsApplied(
  values: Record<RiskRecommendationKey, number>,
  baselineEquity: number,
  profile: RiskProfile = "medium",
): boolean {
  if (baselineEquity <= 0) return false;
  const pcts = RISK_PROFILES[profile];
  return (Object.keys(pcts) as RiskRecommendationKey[]).every((key) =>
    isNearRecommended(values[key], baselineEquity, pcts[key]),
  );
}

export function detectMatchingProfile(
  values: Record<RiskRecommendationKey, number>,
  baselineEquity: number,
): RiskProfile | null {
  if (baselineEquity <= 0) return null;
  for (const profile of RISK_PROFILE_ORDER) {
    if (areAllRecommendationsApplied(values, baselineEquity, profile)) {
      return profile;
    }
  }
  return null;
}

/** Blocks save when dollar fields match one profile but another is selected. */
export function validateProfileSelection(
  values: Record<RiskRecommendationKey, number>,
  baselineEquity: number,
  selectedProfile: RiskProfile,
): string | null {
  const matchingProfile = detectMatchingProfile(values, baselineEquity);
  if (matchingProfile != null && matchingProfile !== selectedProfile) {
    return `Dollar values match ${formatProfileTitle(matchingProfile)} but ${formatProfileTitle(selectedProfile)} is selected. Apply the selected profile or switch cards.`;
  }
  return null;
}
