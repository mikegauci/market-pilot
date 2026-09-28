"use client";

import { Button } from "@/components/ui/button";
import { RiskRecommendationStatusContent } from "@/components/risk-recommendation-status-content";
import {
  formatProfileTitle,
  type RiskProfile,
  type RiskRecommendationKey,
} from "@/lib/risk-recommendations";

type RiskRecommendationStatusProps = {
  baselineEquity: number;
  currentEquity: number;
  currency: string;
  profile: RiskProfile;
  allApplied: boolean;
  savedValues?: Record<RiskRecommendationKey, number>;
  className?: string;
  onApply?: () => void;
  compact?: boolean;
};

export function RiskRecommendationStatus({
  onApply,
  profile,
  ...props
}: RiskRecommendationStatusProps) {
  return (
    <RiskRecommendationStatusContent
      {...props}
      profile={profile}
      actions={
        onApply ? (
          <Button
            type="button"
            className="shrink-0 border border-amber-700/50 bg-amber-900/40 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-900/60"
            onClick={onApply}
          >
            Apply {formatProfileTitle(profile)}
          </Button>
        ) : undefined
      }
    />
  );
}
