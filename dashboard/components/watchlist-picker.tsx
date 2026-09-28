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

export function WatchlistPicker({ defaultValue }: { defaultValue: string[] }) {
  const [selected, setSelected] = useState<string[]>(() => normalizeSymbols(defaultValue));
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

  function removeSymbol(symbol: string) {
    setSelected((prev) => prev.filter((s) => s !== symbol));
  }

  function handleCustomAdd() {
    addSymbol(customSymbol);
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="watchlist" value={selected.join(", ")} required />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="watchlist-search">Watchlist</Label>
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

      <div>
        <Label htmlFor="watchlist-search" className="sr-only">
          Search S&amp;P 500
        </Label>
        <Input
          id="watchlist-search"
          type="search"
          placeholder="Search S&P 500 by ticker or company name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      {search.trim() && (
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
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="watchlist-custom">Custom ticker</Label>
          <Input
            id="watchlist-custom"
            placeholder="e.g. SPY, QQQ"
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
        </div>
        <Button
          type="button"
          onClick={handleCustomAdd}
          className="shrink-0 bg-zinc-800 hover:bg-zinc-700"
        >
          Add
        </Button>
      </div>

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
