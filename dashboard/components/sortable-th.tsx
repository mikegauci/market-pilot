"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { SortDir } from "@/lib/hooks/use-table-sort";

type Props<K extends string> = {
  label: string;
  columnKey: K;
  sortKey: K;
  sortDir: SortDir;
  onSort: (key: K) => void;
  className?: string;
};

export function SortableTh<K extends string>({
  label,
  columnKey,
  sortKey,
  sortDir,
  onSort,
  className = "pb-2 pr-3",
}: Props<K>) {
  const active = sortKey === columnKey;
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  return (
    <th className={className} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="inline-flex items-center gap-1 hover:text-zinc-300"
        aria-label={
          active
            ? `Sort by ${label}, currently ${sortDir === "asc" ? "ascending" : "descending"}`
            : `Sort by ${label}`
        }
      >
        {label}
        {active &&
          (sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          ))}
      </button>
    </th>
  );
}
