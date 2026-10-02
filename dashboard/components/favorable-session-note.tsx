import { Card, CardTitle } from "@/components/ui/card";
import {
  buildFavorableSessionNote,
  FAVORABLE_SESSION_EMPTY,
  type FavorableSessionFetch,
} from "@/lib/favorable-sessions";

type Props = {
  sessions: FavorableSessionFetch;
  now?: Date;
};

export function FavorableSessionNote({ sessions, now }: Props) {
  const note = buildFavorableSessionNote(sessions.rows, now);

  return (
    <Card>
      <CardTitle>Mostly favourable sessions</CardTitle>
      <p className="mt-1 text-xs text-zinc-500">
        Share of each US session (9:30–16:00 New York) when the broad market and recent news
        looked OK for new buys. A day is listed when that share is at least half the session.
        Today counts as soon as the session starts.
      </p>
      {sessions.error ? (
        <p className="mt-3 text-sm text-amber-400/90">{sessions.error}</p>
      ) : (
        <>
          {note.mostlyFavorable.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">{FAVORABLE_SESSION_EMPTY}</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-zinc-200">
              {note.mostlyFavorable.map((line) => (
                <li key={line.sessionDate}>{line.text}</li>
              ))}
            </ul>
          )}
          {note.todayText && <p className="mt-3 text-sm text-zinc-300">{note.todayText}</p>}
        </>
      )}
    </Card>
  );
}
