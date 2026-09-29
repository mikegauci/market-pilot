/** Stored as demotion_max_hold_ratio in settings; exposed as plain-language presets in the UI. */
export type DemotionHoldPolicy = "exit_now" | "tighten" | "keep";

export const DEMOTION_HOLD_OPTIONS: {
  id: DemotionHoldPolicy;
  label: string;
  description: string;
  ratio: number;
}[] = [
  {
    id: "exit_now",
    label: "Exit at next check",
    description: "Close demoted positions as soon as the trader notices.",
    ratio: 0,
  },
  {
    id: "tighten",
    label: "Half max hold",
    description: "Demoted positions time out after half your normal max-hold setting.",
    ratio: 0.5,
  },
  {
    id: "keep",
    label: "Keep full max hold",
    description: "Only Jev signals or force exit close demoted positions early.",
    ratio: 1,
  },
];

export function holdPolicyFromRatio(ratio: number | null | undefined): DemotionHoldPolicy {
  if (ratio == null || ratio <= 0) {
    return "exit_now";
  }
  if (ratio >= 1) {
    return "keep";
  }
  if (ratio <= 0.25) {
    return "exit_now";
  }
  if (ratio >= 0.75) {
    return "keep";
  }
  return "tighten";
}

export function holdPolicyToRatio(policy: DemotionHoldPolicy): number {
  return DEMOTION_HOLD_OPTIONS.find((option) => option.id === policy)?.ratio ?? 0.5;
}

export function demotionHoldPolicyLabel(ratio: number | null | undefined): string {
  const policy = holdPolicyFromRatio(ratio);
  return DEMOTION_HOLD_OPTIONS.find((option) => option.id === policy)?.label ?? "Half max hold";
}
