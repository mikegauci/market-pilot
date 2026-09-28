"use client";

import { useEffect, useState, useTransition } from "react";
import { setExecutionMode, toggleBot } from "@/lib/actions";
import type { BotStatus } from "@/lib/types/database";

type Props = {
  status: BotStatus;
};

function ToggleSwitch({
  enabled,
  pending,
  onToggle,
  ariaLabel,
}: {
  enabled: boolean;
  pending: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onToggle}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition ${
        enabled ? "bg-emerald-600" : "bg-zinc-700"
      } ${pending ? "opacity-60" : ""}`}
      aria-label={ariaLabel}
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white transition ${
          enabled ? "translate-x-7" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function TradingControls({ status }: Props) {
  const [botEnabled, setBotEnabled] = useState(status.enabled);
  const [executionMode, setExecutionModeState] = useState(
    status.execution_mode ?? "simulated",
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setBotEnabled(status.enabled);
    setExecutionModeState(status.execution_mode ?? "simulated");
  }, [status.enabled, status.execution_mode]);

  return (
    <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4">
      <h3 className="text-sm font-medium text-zinc-200">Trading controls</h3>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-300">Trading bot</p>
          <p className="text-xs text-zinc-500">Allow new entries when signals qualify</p>
        </div>
        <ToggleSwitch
          enabled={botEnabled}
          pending={pending}
          ariaLabel={botEnabled ? "Disable bot" : "Enable bot"}
          onToggle={() => {
            const next = !botEnabled;
            setBotEnabled(next);
            startTransition(async () => {
              try {
                await toggleBot(next);
              } catch {
                setBotEnabled(!next);
              }
            });
          }}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-zinc-800 pt-4">
        <div>
          <p className="text-sm text-zinc-300">IBKR paper orders</p>
          <p className="text-xs text-zinc-500">
            {executionMode === "ibkr"
              ? "Real bracket orders at IBKR paper"
              : "Simulated trades in Supabase only"}
          </p>
        </div>
        <ToggleSwitch
          enabled={executionMode === "ibkr"}
          pending={pending}
          ariaLabel={
            executionMode === "ibkr"
              ? "Switch to simulated execution"
              : "Switch to IBKR paper execution"
          }
          onToggle={() => {
            const next = executionMode === "ibkr" ? "simulated" : "ibkr";
            setExecutionModeState(next);
            startTransition(async () => {
              try {
                await setExecutionMode(next);
              } catch {
                setExecutionModeState(executionMode);
              }
            });
          }}
        />
      </div>

      {executionMode === "ibkr" && (
        <p className="mt-3 text-xs text-amber-400/90">
          Places real bracket orders on your IBKR paper account. Requires IB Gateway and{" "}
          <code className="text-amber-300/80">DATA_SOURCE=ibkr</code>.
        </p>
      )}
    </div>
  );
}
