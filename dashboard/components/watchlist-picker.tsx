"use client";

import { useMemo, useState } from "react";
import sp500 from "@/data/sp500.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;
const LARGE_WATCHLIST_THRESHOLD = 25;
const MAX_SEARCH_RESULTS = 50;

type Sp500Entry = { symbol: string; name: string };

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
  defaultValue: string[];
  value?: string[];
  onChange?: (symbols: string[]) => void;
  inputName?: string;
  fieldLabel?: string;
  /** When true, omit the selected-symbol chips (parent shows them). */
  hideChipList?: boolean;
  /** Overview-style layout: search + custom ticker only. */
  compact?: boolean;
}) {
  const [selectedInternal, setSelectedInternal] = useState<string[]>(() =>
    normalizeSymbols(defaultValue),
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
  const [customSymbol, setCustomSymbol] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    return (sp500 as Sp500Entry[])
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
      setCustomError("Use 1–10 uppercase letters, digits, or dots (e.g. SPY, BRK.B).");
      return;
    }
    if (selectedSet.has(symbol)) {
      setCustomError(`${symbol} is already on the watchlist.`);
      return;
    }
    setSelected((prev) => [...prev, symbol]);
    setCustomError(null);
    setCustomSymbol("");
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
      setCustomError(`Invalid symbols: ${invalid.join(", ")}`);
    } else {
      setCustomError(null);
    }

    clearInput();
  }

  function removeSymbol(symbol: string) {
    setSelected((prev) => prev.filter((s) => s !== symbol));
  }

  function handleCustomAdd() {
    addSymbolsFromInput(customSymbol, () => setCustomSymbol(""));
  }

  function handleBulkInput(raw: string, clearInput: () => void) {
    if (!raw.includes(",")) return false;
    addSymbolsFromInput(raw, clearInput);
    return true;
  }

  const searchInputId = compact ? "overview-watchlist-search" : "watchlist-search";
  const customInputId = compact ? "overview-watchlist-custom" : "watchlist-custom";
  const labelClassName = compact ? "text-xs font-medium text-zinc-400" : undefined;
  const addFieldsClassName = compact ? "grid grid-cols-1 gap-3" : "grid gap-3 sm:grid-cols-2";

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

      <div className={addFieldsClassName}>
        <div className="min-w-0">
          <Label htmlFor={searchInputId} className={labelClassName}>
            {compact ? "S&P 500 search" : "Search S&P 500"}
          </Label>
          <Input
            id={searchInputId}
            type="search"
            className="mt-1.5 w-full min-w-0"
            placeholder={
              compact ? "Name or ticker…" : "Search or paste comma-separated tickers…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleBulkInput(search, () => setSearch(""));
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
        </div>

        <div className="min-w-0">
          <Label htmlFor={customInputId} className={labelClassName}>
            Custom ticker
          </Label>
          <div className="mt-1.5 flex w-full min-w-0 items-center gap-2">
            <Input
              id={customInputId}
              className="min-w-0 flex-1"
              placeholder={compact ? "SPY, QQQ" : "e.g. SPY, QQQ"}
              value={customSymbol}
              onChange={(e) => {
                setCustomSymbol(e.target.value.toUpperCase());
                setCustomError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCustomAdd();
                }
              }}
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={handleCustomAdd}
              className="shrink-0 bg-zinc-800 hover:bg-zinc-700"
            >
              Add
            </Button>
          </div>
        </div>
      </div>

      {search.trim() && search.includes(",") ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-400">
          Press Enter to add {parseSymbolList(search).length} symbols (existing ones are skipped).
        </p>
      ) : search.trim() ? (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/50">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">No matching symbols.</li>
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

      {customError && <p className="text-xs text-red-400">{customError}</p>}

      {selected.length > LARGE_WATCHLIST_THRESHOLD && (
        <p className="text-xs text-amber-400/90">
          Large watchlists increase IBKR market-data subscriptions and Jev evaluation time.
          Consider keeping the list focused ({LARGE_WATCHLIST_THRESHOLD} or fewer symbols).
        </p>
      )}

    </div>
  );
}
