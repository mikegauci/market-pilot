import { StrategyGuide } from "@/components/strategy-guide";

type Props = {
  compact?: boolean;
  variant?: "full" | "reference";
  embedded?: boolean;
  benchmarkSymbol?: string;
  minVolumeRatio?: number;
};

/** @deprecated Prefer StrategyGuide — kept for backward compatibility */
export function StrategyIndicatorsCard(props: Props) {
  return <StrategyGuide {...props} />;
}
