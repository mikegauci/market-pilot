import { SettingsCollapsible } from "@/components/settings-section";
import {
  formatHistoryWhen,
  formatSymbolList,
  latestRotationChange,
  type WatchlistRotationHistoryEntry,
} from "@/lib/watchlist-rotation-history";

function ChangeLines({ entry }: { entry: WatchlistRotationHistoryEntry }) {
  const added = formatSymbolList(entry.added);
  const removed = formatSymbolList(entry.removed);
  if (entry.detail && !added && !removed) {
    return <p className="text-xs text-zinc-400">{entry.detail}</p>;
  }
  return (
    <div className="space-y-0.5 text-xs text-zinc-400">
      {added ? (
        <p>
          <span className="text-zinc-500">Added:</span> {added}
        </p>
      ) : null}
      {removed ? (
        <p>
          <span className="text-zinc-500">Removed:</span> {removed}
        </p>
      ) : null}
      {!added && !removed && entry.detail ? <p>{entry.detail}</p> : null}
      {added && !removed ? (
        <p className="text-zinc-500">Nothing removed this scan (list was filled or expanded).</p>
      ) : null}
    </div>
  );
}

type Props = {
  history: WatchlistRotationHistoryEntry[];
  lastNote: string;
  lastAt?: string | null;
};

export function WatchlistRotationHistoryPanel({ history, lastNote, lastAt }: Props) {
  const latest = latestRotationChange(history, lastNote, lastAt);
  const accordionDetail =
    history.length > 1
      ? `${history.length} changes`
      : history.length === 1
        ? formatHistoryWhen(history[0]!.at)
        : undefined;

  return (
    <div className="space-y-2">
      {latest ? (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-zinc-400">Last change</p>
          <ChangeLines entry={latest} />
        </div>
      ) : null}

      {history.length ? (
        <SettingsCollapsible summary="Change history" detail={accordionDetail}>
          <ul className="space-y-3">
            {history.map((entry) => (
              <li key={entry.at} className="space-y-0.5 border-b border-zinc-800/50 pb-2 last:border-0 last:pb-0">
                <p className="text-[11px] font-medium text-zinc-500">{formatHistoryWhen(entry.at)}</p>
                <ChangeLines entry={entry} />
              </li>
            ))}
          </ul>
        </SettingsCollapsible>
      ) : latest && !history.length ? (
        <p className="text-[11px] text-zinc-600">
          Older changes will appear here after the next list update.
        </p>
      ) : null}
    </div>
  );
}
