"use client";

import { AlertTriangle } from "lucide-react";
import { useLiveBotStatus } from "@/components/bot-status-provider";
import { useLiveDisplayStatus } from "@/lib/hooks/use-display-status";
import {
  getJevSignalsNotice,
  shouldShowJevUnavailableWarning,
} from "@/lib/trader-status";
import { cn } from "@/lib/utils";

type JevUnavailableBannerProps = {
  compact?: boolean;
  className?: string;
};

export function JevUnavailableBanner({ compact = false, className }: JevUnavailableBannerProps) {
  const status = useLiveBotStatus();
  const { isClient, display, market } = useLiveDisplayStatus(status);

  if (!isClient || !market?.isOpen) {
    return null;
  }

  if (
    !shouldShowJevUnavailableWarning(status, {
      traderOnline: display.traderOnline,
      marketOpen: market.isOpen,
    })
  ) {
    return null;
  }

  const notice = getJevSignalsNotice();

  if (compact) {
    return (
      <p
        className={cn(
          "rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1.5 text-[10px] leading-snug text-amber-200/90",
          className,
        )}
      >
        <span className="font-medium text-amber-100">{notice.title}.</span> {notice.message}
      </p>
    );
  }

  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex gap-3 rounded-lg border border-amber-900/50 bg-amber-950/25 px-3 py-3 text-sm text-amber-100/95 sm:px-4",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-amber-50">{notice.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-200/90 sm:text-sm">{notice.message}</p>
      </div>
    </div>
  );
}
