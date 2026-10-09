"use client";

import { useCallback, useState, useTransition } from "react";

type Failure = { ok: false; error: string };

/**
 * Runs a `{ ok, error }` server action in a transition and keeps the last success and error.
 * A failed run keeps the previous success (call `reset` first to clear it).
 */
export function useServerResult<Res extends { ok: true } | Failure>() {
  type Success = Extract<Res, { ok: true }>;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Success | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((action: () => Promise<Res>) => {
    setError(null);
    startTransition(async () => {
      const next = await action();
      if (!next.ok) {
        setError((next as Failure).error);
        return;
      }
      setResult(next as Success);
    });
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { pending, result, error, run, reset };
}
