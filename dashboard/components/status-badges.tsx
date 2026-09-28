import { Badge } from "@/components/ui/badge";
import { getDisplayStatus } from "@/lib/trader-status";
import type { BotStatus } from "@/lib/types/database";

export function StatusBadges({ status }: { status: BotStatus }) {
  const display = getDisplayStatus(status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge className={status.enabled ? "bg-emerald-900 text-emerald-300" : "bg-zinc-800 text-zinc-400"}>
        Bot {status.enabled ? "ON" : "OFF"}
      </Badge>
      <Badge
        className={
          display.traderOnline ? "bg-teal-900 text-teal-300" : "bg-zinc-800 text-zinc-500"
        }
      >
        Trader {display.traderOnline ? "online" : "offline"}
      </Badge>
      <Badge
        className={
          display.ibkrConnected ? "bg-blue-900 text-blue-300" : "bg-zinc-800 text-zinc-500"
        }
      >
        IBKR {display.ibkrConnected ? "connected" : "offline"}
      </Badge>
      <Badge
        className={
          display.jevConnected ? "bg-purple-900 text-purple-300" : "bg-zinc-800 text-zinc-500"
        }
      >
        Jev {display.jevConnected ? "connected" : "offline"}
      </Badge>
      <Badge className="bg-zinc-800 text-zinc-400">
        Orders {(status.execution_mode ?? "simulated") === "ibkr" ? "IBKR paper" : "simulated"}
      </Badge>
      <span className="text-xs text-zinc-500">
        Heartbeat: {display.heartbeatLabel}
      </span>
      {status.last_error && (
        <Badge className="bg-red-900 text-red-300">{status.last_error}</Badge>
      )}
    </div>
  );
}
