import { Badge } from "@/components/ui/badge";
import type { BotStatus } from "@/lib/types/database";
import { formatDateTime } from "@/lib/utils";

export function StatusBadges({ status }: { status: BotStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge className={status.enabled ? "bg-emerald-900 text-emerald-300" : "bg-zinc-800 text-zinc-400"}>
        Bot {status.enabled ? "ON" : "OFF"}
      </Badge>
      <Badge className={status.ibkr_connected ? "bg-blue-900 text-blue-300" : "bg-zinc-800 text-zinc-500"}>
        IBKR {status.ibkr_connected ? "connected" : "offline"}
      </Badge>
      <Badge className={status.jev_connected ? "bg-purple-900 text-purple-300" : "bg-zinc-800 text-zinc-500"}>
        Jev {status.jev_connected ? "connected" : "offline"}
      </Badge>
      <span className="text-xs text-zinc-500">
        Heartbeat: {formatDateTime(status.last_heartbeat)}
      </span>
      {status.last_error && (
        <Badge className="bg-red-900 text-red-300">{status.last_error}</Badge>
      )}
    </div>
  );
}
