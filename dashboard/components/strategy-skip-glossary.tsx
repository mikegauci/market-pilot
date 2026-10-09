import Link from "next/link";
import { ScenarioPlayer } from "@/components/strategy-scenarios/scenario-player";
import { Card, CardTitle } from "@/components/ui/card";
import { buildSkipScenarios } from "@/lib/skip-scenarios";
import type { Settings } from "@/lib/types/database";

export function StrategySkipGlossary({ settings }: { settings: Settings | null }) {
  return (
    <Card>
      <CardTitle>Common skip reasons</CardTitle>
      <p className="mt-1 text-xs text-zinc-600">
        What you may see on{" "}
        <Link href="/predictions" className="text-emerald-500/80 hover:text-emerald-400">
          Predictions
        </Link>{" "}
        when Jev liked a name but the bot did not trade. Pick a reason and step through an example.
        If several checks would fail, only the first one is logged.
      </p>
      <div className="mt-4">
        <ScenarioPlayer scenarios={buildSkipScenarios(settings)} tabsLabel="Skip reasons" />
      </div>
    </Card>
  );
}
