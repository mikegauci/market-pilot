"use client";

import { useEffect, useState, useTransition } from "react";
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { toggleBot } from "@/lib/actions";
import { getBrokerNotice } from "@/lib/trade-mode";
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

function BrokerNotice({
  traderOnline,
  ibkrConnected,
  compact = false,
}: {
  traderOnline: boolean;
  ibkrConnected: boolean;
  compact?: boolean;
}) {
  const notice = getBrokerNotice({ traderOnline, ibkrConnected });
  if (!notice) return null;

  const className = cn(
    compact ? "mt-2 rounded px-2 py-1.5 text-[10px] leading-snug" : "mt-4 rounded-md px-3 py-2 text-xs leading-relaxed",
    notice.tone === "emerald"
      ? "border border-emerald-900/40 bg-emerald-950/20 text-emerald-200/90"
      : "border border-amber-900/40 bg-amber-950/20 text-amber-200/90",
  );

  return <p className={className}>{notice.message}</p>;
}

export function TradingControls({ variant = "default" }: { variant?: "default" | "sidebar" }) {
  const status = useLiveBotStatus();

  const [botEnabled, setBotEnabled] = useState(status.enabled);
  const [pending, startTransition] = useTransition();
  const stableNow = getStableDisplayNow(status.last_heartbeat);
  const [mounted, setMounted] = useState(false);
  const [display, setDisplay] = useState(() => getDisplayStatus(status, stableNow));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setBotEnabled(status.enabled);
  }, [status.enabled]);

  useEffect(() => {
    if (!mounted) return;

    const update = () => setDisplay(getDisplayStatus(status));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [status, mounted]);

  const showBrokerNotice = botEnabled && mounted && !display.ibkrConnected;

  if (variant === "sidebar") {
    return (
      <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Controls
        </h3>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <p
            className="text-xs font-medium text-zinc-200"
            title={
              botEnabled
                ? "Bot can open new trades during market hours"
                : "New trades paused; open positions still managed"
            }
          >
            Auto-trading
          </p>
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

        {showBrokerNotice && (
          <BrokerNotice
            traderOnline={display.traderOnline}
            ibkrConnected={display.ibkrConnected}
            compact
          />
        )}
      </div>
    );
  }

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

      {showBrokerNotice && (
        <BrokerNotice
          traderOnline={display.traderOnline}
          ibkrConnected={display.ibkrConnected}
        />
      )}
    </div>
  );
}
