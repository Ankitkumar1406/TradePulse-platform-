"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeColor, fmtMcap, fmtPct, fmtPrice } from "@/lib/format";

/**
 * Header stock search — type-ahead over the whole NSE universe.
 * Enter/selecting a result hands the symbol to onSelectStock, which opens the
 * existing stock-detail dialog. Renders inline on sm+ and as an expandable
 * full-width panel below the header on mobile.
 */

interface SearchHit {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  sector: string | null;
  exchangeCode: string | null;
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function StockSearch({ onSelectStock }: { onSelectStock: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  // Highlighted row, keyed to the query text it belongs to — a new query
  // implicitly resets the highlight to the first row without an effect.
  const [activeSel, setActiveSel] = useState<{ q: string; i: number }>({ q: "", i: 0 });
  const desktopRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q, 250);
  const trimmed = debounced.trim();

  const { data, isFetching } = useQuery({
    queryKey: ["stock-search", trimmed],
    queryFn: async (): Promise<SearchHit[]> => {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error("search failed");
      const json = await res.json();
      return json.results as SearchHit[];
    },
    enabled: trimmed.length >= 1,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const results = useMemo(() => (trimmed ? data ?? [] : []), [trimmed, data]);
  const open = trimmed.length >= 1;
  const active = activeSel.q === debounced ? activeSel.i : 0;
  const setActive = useCallback((i: number) => setActiveSel({ q: debounced, i }), [debounced]);

  const pick = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      onSelectStock(hit.symbol);
      setQ("");
      setMobileOpen(false);
      desktopInputRef.current?.blur();
      mobileInputRef.current?.blur();
    },
    [onSelectStock],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || results.length === 0) {
        if (e.key === "Escape") {
          setQ("");
          setMobileOpen(false);
          e.currentTarget.blur();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(Math.min(active + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(Math.max(active - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        pick(results[active] ?? results[0]);
      } else if (e.key === "Escape") {
        setQ("");
        setMobileOpen(false);
        e.currentTarget.blur();
      }
    },
    [open, results, active, pick, setActive],
  );

  // Close on outside click (desktop dropdown + mobile panel)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (desktopRef.current && !desktopRef.current.contains(t)) setQ("");
      if (panelRef.current && !panelRef.current.contains(t) && !(t as HTMLElement).closest?.("[data-search-mobile-toggle]")) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const list = (
    <SearchResults
      q={trimmed}
      results={results}
      active={active}
      loading={isFetching && results.length === 0}
      onPick={pick}
      onHover={setActive}
    />
  );

  return (
    <>
      {/* desktop / tablet — inline in the header */}
      <div ref={desktopRef} className="relative hidden max-w-md flex-1 sm:block" role="search">
        <SearchInput
          ref={desktopInputRef}
          value={q}
          onChange={setQ}
          onKeyDown={onKeyDown}
          ariaLabel="Search stocks by symbol or company name"
        />
        {open && (
          <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/100 shadow-2xl shadow-black/60">
            {list}
          </div>
        )}
      </div>

      {/* mobile — icon toggle + full-width panel under the header */}
      <button
        type="button"
        data-search-mobile-toggle
        aria-label="Search stocks"
        onClick={() => setMobileOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-400 transition-colors hover:text-zinc-200 sm:hidden"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </button>
      {mobileOpen && (
        <div ref={panelRef} className="absolute inset-x-3 top-14 z-50 sm:hidden" role="search">
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60">
            <div className="border-b border-zinc-800/80 p-2">
              <SearchInput
                ref={mobileInputRef}
                value={q}
                onChange={setQ}
                onKeyDown={onKeyDown}
                autoFocus
                ariaLabel="Search stocks by symbol or company name"
              />
            </div>
            <div className="max-h-[60vh] overflow-y-auto">{list}</div>
          </div>
        </div>
      )}
    </>
  );
}

const SearchInput = (
  { ref, value, onChange, onKeyDown, autoFocus, ariaLabel }: {
    ref: React.RefObject<HTMLInputElement | null>;
    value: string;
    onChange: (v: string) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    autoFocus?: boolean;
    ariaLabel: string;
  },
) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
      type="text"
      inputMode="search"
      role="combobox"
      aria-expanded="true"
      aria-controls="stock-search-results"
      aria-label={ariaLabel}
      autoComplete="off"
      spellCheck={false}
      placeholder="Search stock — RELIANCE, Tata Steel…"
      className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900/70 pl-8 pr-8 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:bg-zinc-900 focus:outline-none"
    />
    {value && (
      <button
        type="button"
        aria-label="Clear search"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange("")}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-300"
      >
        <X className="h-3 w-3" />
      </button>
    )}
  </div>
);

function SearchResults({
  q, results, active, loading, onPick, onHover,
}: {
  q: string;
  results: SearchHit[];
  active: number;
  loading: boolean;
  onPick: (hit: SearchHit) => void;
  onHover: (i: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
      </div>
    );
  }
  if (results.length === 0) {
    return <div className="px-3 py-3 text-xs text-zinc-500">No stocks found for “{q}”</div>;
  }
  return (
    <ul id="stock-search-results" role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto py-1">
      {results.map((hit, i) => {
        const sym = hit.symbol.replace(/\.NS$/, "");
        return (
          <li key={hit.symbol} role="option" aria-selected={i === active}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(hit)}
              onMouseEnter={() => onHover(i)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                i === active ? "bg-brand/10" : "hover:bg-zinc-900",
              )}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className={cn("text-xs font-bold", i === active ? "text-brand-text" : "text-zinc-100")}>{sym}</span>
                  {hit.exchangeCode === "NCM" && (
                    <span className="rounded border border-zinc-700 px-1 text-[9px] font-medium text-zinc-500">SME</span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {hit.name}
                  {hit.sector && hit.sector !== "Unknown" ? ` · ${hit.sector}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-xs text-zinc-200">{fmtPrice(hit.price)}</span>
                <span className={cn("block font-mono text-[10px]", changeColor(hit.changePct))}>
                  {fmtPct(hit.changePct)}
                  {hit.marketCap ? <span className="text-zinc-600"> · {fmtMcap(hit.marketCap)}</span> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
