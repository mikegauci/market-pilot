"use client";

import { useEffect, useState, useTransition } from "react";
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { setExecutionMode, toggleBot } from "@/lib/actions";
import { getDisplayStatus, getStableDisplayNow } from "@/lib/trader-status";
import { cn } from "@/lib/utils";

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

function BrokerConnectionNotice({
  traderOnline,
  ibkrConnected,
}: {
  traderOnline: boolean;
  ibkrConnected: boolean;
}) {
  if (ibkrConnected) {
    return (
      <p className="mt-4 rounded-md border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 text-xs leading-relaxed text-emerald-200/90">
        Broker connected — orders will go to your paper account.
      </p>
    );
  }

  if (!traderOnline) {
    return (
      <p className="mt-4 rounded-md border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
        Trading engine is not running. Start it on your computer (with IB Gateway open) so
        the dashboard can reach your broker.
      </p>
    );
  }

  return (
    <p className="mt-4 rounded-md border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
      Can&apos;t reach your broker. Open IB Gateway, log in, and wait until it shows
      &ldquo;connected&rdquo; — then restart the trading engine.
    </p>
  );
}

export function TradingControls() {
  const status = useLiveBotStatus();

  const [botEnabled, setBotEnabled] = useState(status.enabled);
  const [executionMode, setExecutionModeState] = useState(
    status.execution_mode ?? "simulated",
  );
  const [pending, startTransition] = useTransition();
  const stableNow = getStableDisplayNow(status.last_heartbeat);
  const [mounted, setMounted] = useState(false);
  const [display, setDisplay] = useState(() => getDisplayStatus(status, stableNow));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setBotEnabled(status.enabled);
    setExecutionModeState(status.execution_mode ?? "simulated");
  }, [status.enabled, status.execution_mode]);

  useEffect(() => {
    if (!mounted) return;

    const update = () => setDisplay(getDisplayStatus(status));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status, mounted]);

  const brokerOrdersOn = executionMode === "ibkr";

  return (
    <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
      <h3 className="text-sm font-medium text-zinc-200">Controls</h3>
      <p className="mt-1 text-xs text-zinc-500">Changes take effect within about 30 seconds.</p>

      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="min-w-0 pr-2">
          <p className="text-sm font-medium text-zinc-200">Auto-trading</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            {botEnabled
              ? "The bot can open new trades when it finds a good setup during market hours."
              : "New trades are paused. Open positions are still managed."}
          </p>
        </div>
        <ToggleSwitch
          enabled={botEnabled}
          pending={pending}
          ariaLabel={botEnabled ? "Turn off auto-trading" : "Turn on auto-trading"}
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

      <div
        className={cn(
          "mt-5 flex items-center justify-between gap-4 border-t border-zinc-800 pt-5",
        )}
      >
        <div className="min-w-0 pr-2">
          <p className="text-sm font-medium text-zinc-200">Send orders to broker</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            {brokerOrdersOn
              ? "Trades are placed on your paper brokerage account, like trading for real."
              : "Trades are recorded here only — nothing is sent to your broker."}
          </p>
        </div>
        <ToggleSwitch
          enabled={brokerOrdersOn}
          pending={pending}
          ariaLabel={
            brokerOrdersOn
              ? "Switch to dashboard-only practice mode"
              : "Send orders to paper broker"
          }
          onToggle={() => {
            const next = brokerOrdersOn ? "simulated" : "ibkr";
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

      {brokerOrdersOn && mounted && (
        <BrokerConnectionNotice
          traderOnline={display.traderOnline}
          ibkrConnected={display.ibkrConnected}
        />
      )}
    </div>
  );
}
