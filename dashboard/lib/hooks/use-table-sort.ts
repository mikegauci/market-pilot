"use client";

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

/** Null/undefined always sort after real values, in both directions. */
export function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDir = "asc",
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

/** Null/undefined always sort after real values, in both directions. */
export function compareNullableTime(
  a: string | null | undefined,
  b: string | null | undefined,
  dir: SortDir = "asc",
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const delta = new Date(a).getTime() - new Date(b).getTime();
  return dir === "asc" ? delta : -delta;
}

export function compareNumber(a: number, b: number, dir: SortDir = "asc"): number {
  return dir === "asc" ? a - b : b - a;
}

export function compareString(a: string, b: string, dir: SortDir = "asc"): number {
  const cmp = a.localeCompare(b);
  return dir === "asc" ? cmp : -cmp;
}

type Options<T, K extends string> = {
  items: T[];
  defaultKey: K;
  defaultDir?: SortDir;
  compare: (a: T, b: T, key: K, dir: SortDir) => number;
  /** Direction when switching to a new column. Defaults to desc. */
  initialDirForKey?: (key: K) => SortDir;
};

export function useTableSort<T, K extends string>({
  items,
  defaultKey,
  defaultDir = "desc",
  compare,
  initialDirForKey,
}: Options<T, K>) {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const sorted = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => compare(a, b, sortKey, sortDir));
    return list;
  }, [items, compare, sortKey, sortDir]);

  function handleSort(key: K) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(initialDirForKey?.(key) ?? "desc");
  }

  return { sorted, sortKey, sortDir, handleSort };
}
