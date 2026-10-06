"use client";

import { useMemo, useState } from "react";
import equityUniverse from "@/data/equity-universe.json";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveSearchCommit, shouldWarnLargeWatchlist } from "@/lib/watchlist-commit";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;
const MAX_SEARCH_RESULTS = 50;

type EquityEntry = { symbol: string; name: string };

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

function isValidSymbol(symbol: string): boolean {
  return SYMBOL_PATTERN.test(symbol);
}

function parseSymbolList(raw: string): string[] {
  return normalizeSymbols(raw.split(","));
}

export function WatchlistPicker({
  defaultValue,
  value,
  onChange,
  inputName = "watchlist",
  fieldLabel = "Watchlist",
  hideChipList = false,
  compact = false,
}: {
  /** Initial symbols when uncontrolled; omit when `value` is provided. */
  defaultValue?: string[];
  value?: string[];
  onChange?: (symbols: string[]) => void;
  inputName?: string;
  fieldLabel?: string;
  /** When true, omit the selected-symbol chips (parent shows them). */
  hideChipList?: boolean;
  /** Overview-style layout: search only, tighter spacing. */
  compact?: boolean;
}) {
  const [selectedInternal, setSelectedInternal] = useState<string[]>(() =>
    normalizeSymbols(defaultValue ?? []),
  );
  const selected = value ?? selectedInternal;

  function setSelected(next: string[] | ((prev: string[]) => string[])) {
    const resolved = typeof next === "function" ? next(selected) : next;
    if (onChange) {
      onChange(resolved);
    } else {
      setSelectedInternal(resolved);
    }
  }
  const [search, setSearch] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || q.includes(",")) return [];

    return (equityUniverse as EquityEntry[])
      .filter((entry) => {
        if (selectedSet.has(entry.symbol)) return false;
        return (
          entry.symbol.toLowerCase().startsWith(q) ||
          entry.name.toLowerCase().includes(q)
        );
      })
      .slice(0, MAX_SEARCH_RESULTS);
  }, [search, selectedSet]);

  function addSymbol(raw: string) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) return;
    if (!isValidSymbol(symbol)) {
      setInputError("Use 1–10 uppercase letters, digits, or dots (e.g. SPY, BRK.B).");
      return;
    }
    if (selectedSet.has(symbol)) {
      setInputError(`${symbol} is already on the watchlist.`);
      return;
    }
    setSelected((prev) => [...prev, symbol]);
    setInputError(null);
    setSearch("");
  }

  function addSymbolsFromInput(raw: string, clearInput: () => void) {
    const candidates = parseSymbolList(raw);
    if (candidates.length === 0) return;

    if (candidates.length === 1) {
      addSymbol(candidates[0]);
      clearInput();
      return;
    }

    const toAdd: string[] = [];
    const invalid: string[] = [];
    const seen = new Set(selected);

    for (const symbol of candidates) {
      if (!isValidSymbol(symbol)) {
        invalid.push(symbol);
        continue;
      }
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      toAdd.push(symbol);
    }

    if (toAdd.length > 0) {
      setSelected((prev) => [...prev, ...toAdd]);
    }

    if (invalid.length > 0) {
      setInputError(`Invalid symbols: ${invalid.join(", ")}`);
    } else {
      setInputError(null);
    }

    clearInput();
  }

  function removeSymbol(symbol: string) {
    setSelected((prev) => prev.filter((s) => s !== symbol));
  }

  function handleBulkInput(raw: string, clearInput: () => void) {
    if (!raw.includes(",")) return false;
    addSymbolsFromInput(raw, clearInput);
    return true;
  }

  function commitSearchInput() {
    const raw = search.trim();
    const outcome = resolveSearchCommit(
      raw,
      filtered.map((entry) => entry.symbol),
      { isValidSymbol: isValidSymbol },
    );
    if (outcome.kind === "noop") return;
    if (outcome.kind === "bulk") {
      handleBulkInput(outcome.raw, () => setSearch(""));
      return;
    }
    if (outcome.kind === "error") {
      setInputError(outcome.message);
      return;
    }
    addSymbol(outcome.symbol);
  }

  const searchInputId = `${inputName}-search`;
  const labelClassName = compact ? "text-xs font-medium text-zinc-400" : undefined;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {!onChange ? (
        <input type="hidden" name={inputName} value={selected.join(", ")} required />
      ) : null}

      {!compact && !hideChipList ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={searchInputId}>{fieldLabel}</Label>
            <span className="text-xs text-zinc-500">
              {selected.length} symbol{selected.length === 1 ? "" : "s"} selected
            </span>
          </div>

          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selected.map((symbol) => (
                <Badge
                  key={symbol}
                  className="gap-1 border border-zinc-700 bg-zinc-800/80 text-zinc-200"
                >
                  {symbol}
                  <button
                    type="button"
                    onClick={() => removeSymbol(symbol)}
                    className="ml-0.5 rounded-full px-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
                    aria-label={`Remove ${symbol}`}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Add at least one symbol to save settings.</p>
          )}
        </>
      ) : null}

      <div className="min-w-0">
        <Label htmlFor={searchInputId} className={labelClassName}>
          Search stocks
        </Label>
        <Input
          id={searchInputId}
          type="search"
          className="mt-1.5 w-full min-w-0"
          placeholder={
            compact
              ? "Ticker, company name, or paste tickers…"
              : "Ticker or company name — paste comma-separated tickers to add many"
          }
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setInputError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitSearchInput();
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text.includes(",")) {
              e.preventDefault();
              addSymbolsFromInput(text, () => setSearch(""));
            }
          }}
          autoComplete="off"
        />
        {!compact ? (
          <p className="mt-1 text-xs text-zinc-500">
            Suggestions include S&amp;P 500 names plus other liquid tickers. Type any valid US
            symbol and press Enter if it is not listed.
          </p>
        ) : null}
      </div>

      {search.trim() && search.includes(",") ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-400">
          Press Enter to add {parseSymbolList(search).length} symbols (existing ones are skipped).
        </p>
      ) : search.trim() ? (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/50">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">
              No matches in the search index — press Enter to add the ticker if it is valid.
            </li>
          ) : (
            filtered.map((entry) => (
              <li key={entry.symbol}>
                <button
                  type="button"
                  onClick={() => addSymbol(entry.symbol)}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-800/80"
                >
                  <span className="shrink-0 font-medium text-zinc-100">{entry.symbol}</span>
                  <span className="truncate text-xs text-zinc-500">{entry.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {inputError && <p className="text-xs text-red-400">{inputError}</p>}

      {shouldWarnLargeWatchlist(selected.length) && (
        <p className="text-xs text-amber-400/90">
          Large watchlists increase IBKR market-data subscriptions and Jev evaluation time.
          Consider keeping the list focused (30 or fewer symbols).
        </p>
      )}
    </div>
  );
}
