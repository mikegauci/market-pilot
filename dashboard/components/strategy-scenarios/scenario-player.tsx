"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { ScenarioChart } from "@/components/strategy-scenarios/scenario-chart";
import { ScenarioChecklist } from "@/components/strategy-scenarios/scenario-checklist";
import { ScenarioListChips } from "@/components/strategy-scenarios/scenario-list-chips";
import {
  SCENARIO_DISCLAIMER,
  type Scenario,
  type ScenarioFrame,
} from "@/lib/strategy-scenarios";
import { cn } from "@/lib/utils";

function FrameView({ frame }: { frame: ScenarioFrame }) {
  switch (frame.kind) {
    case "chart":
      return <ScenarioChart frame={frame} />;
    case "chips":
      return <ScenarioListChips frame={frame} />;
    case "checklist":
      return <ScenarioChecklist frame={frame} />;
  }
}

export function ScenarioPlayer({ scenarios }: { scenarios: Scenario[] }) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const scenario = scenarios[scenarioIndex];
  if (!scenario) return null;
  const step = scenario.steps[stepIndex] ?? scenario.steps[0]!;
  const lastStep = scenario.steps.length - 1;

  function selectScenario(index: number) {
    setScenarioIndex(index);
    setStepIndex(0);
  }

  function go(delta: number) {
    setStepIndex((current) => Math.min(lastStep, Math.max(0, current + delta)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Scenarios" className="flex flex-wrap gap-1.5">
        {scenarios.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={index === scenarioIndex}
            onClick={() => selectScenario(index)}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
              index === scenarioIndex
                ? "border-emerald-700/70 bg-emerald-950/40 text-emerald-200"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
            )}
          >
            {item.title}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={`${scenario.title}: use the left and right arrow keys to step through`}
        className="rounded-lg border border-zinc-800/80 bg-zinc-950/30 p-3 outline-none focus-visible:ring-1 focus-visible:ring-emerald-700 sm:p-4"
      >
        <p className="text-xs text-zinc-500">{scenario.summary}</p>

        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-start">
          <div className="min-w-0 rounded-md border border-zinc-800/60 bg-zinc-950/50 p-2.5">
            <FrameView frame={step.frame} />
          </div>

          <div className="min-w-0 space-y-2" aria-live="polite">
            <p className="font-mono text-[11px] text-zinc-500">
              {step.time} · Step {stepIndex + 1} of {scenario.steps.length}
            </p>
            <p className="text-sm font-medium text-zinc-100">{step.title}</p>
            <p className="text-xs leading-relaxed text-zinc-400">{step.body}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={stepIndex === 0}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </button>
          <div className="flex items-center gap-1.5" aria-hidden>
            {scenario.steps.map((item, index) => (
              <button
                key={`${item.title}-${index}`}
                type="button"
                tabIndex={-1}
                onClick={() => setStepIndex(index)}
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  index === stepIndex ? "bg-emerald-400" : "bg-zinc-700 hover:bg-zinc-500",
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={stepIndex === lastStep}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-zinc-600">{SCENARIO_DISCLAIMER}</p>
    </div>
  );
}
