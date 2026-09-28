import type { BotStatus } from "@/lib/types/database";

export const HEARTBEAT_STALE_SEC = 30;

export type DisplayStatus = {
  traderOnline: boolean;
  ibkrConnected: boolean;
  jevConnected: boolean;
  heartbeatLabel: string;
};

function heartbeatAgeSec(lastHeartbeat: string | null, now = Date.now()): number | null {
  if (!lastHeartbeat) return null;
  const ts = new Date(lastHeartbeat).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((now - ts) / 1000));
}

export function isTraderOnline(
  lastHeartbeat: string | null,
  now = Date.now(),
): boolean {
  const age = heartbeatAgeSec(lastHeartbeat, now);
  return age !== null && age <= HEARTBEAT_STALE_SEC;
}

function formatHeartbeatLabel(lastHeartbeat: string | null, now = Date.now()): string {
  const age = heartbeatAgeSec(lastHeartbeat, now);
  if (age === null) return "offline";
  if (age <= HEARTBEAT_STALE_SEC) {
    if (age < 5) return "just now";
    return `${age}s ago`;
  }
  if (age < 120) return `${age}s ago (stale)`;
  const minutes = Math.floor(age / 60);
  return `${minutes}m ago (offline)`;
}

export function getDisplayStatus(status: BotStatus, now = Date.now()): DisplayStatus {
  const traderOnline = isTraderOnline(status.last_heartbeat, now);

  return {
    traderOnline,
    ibkrConnected: traderOnline && status.ibkr_connected,
    jevConnected: traderOnline && status.jev_connected,
    heartbeatLabel: formatHeartbeatLabel(status.last_heartbeat, now),
  };
}
