"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChevronDown,
  Copy,
  GripVertical,
  Info,
  ListTree,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExprEditor } from "@/components/expr-editor";
import { isScalarOnly, parseProExpr, type SeriesField } from "@/lib/pro-expr";
import {
  Pager,
  ResultsTable,
  SORTS,
  type StocksResponse,
  csvDate,
  exportCsv,
} from "@/components/screener-tables";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * The rebuilt condition builder (Task 38) — Chartink-style visual logic:
 *
 *   · every row is 〈left operand〉〈operator〉〈right operand〉; both operands
 *     are "terms" — a static number (123), a catalog field with timeframe /
 *     bars-ago / window length (ƒx), or a free-form expression (ƒx → custom)
 *   · AND / OR chips between rows; OR-connected rows get wrapped in an amber
 *     box (A AND (B OR C) reads exactly as boxed)
 *   · searchable grouped field picker with recently-used pinned on top
 *   · live match counter, debounced ~450ms after the last edit
 *   · formula view (read-only, copy-friendly) mirroring the visual state
 *
 * Rows serialize to the v2 wire format ({v:2, rows}) compiled by pro-sql.ts,
 * which evaluates the same AND-of-OR-groups semantics the boxes show.
 */

// ================================================================ terms & rows

export type CondOp =
  | "gt" | "gte" | "lt" | "lte" | "eq" | "between"
  | "crossAbove" | "crossBelow" | "withinPct";

const OP_LIST: CondOp[] = [
  "gt", "gte", "lt", "lte", "eq", "between", "crossAbove", "crossBelow", "withinPct",
];

export type Term =
  | { mode: "num"; v: string }
  | { mode: "field"; f: string; tf: "d" | "w"; off: number; p: number }
  | { mode: "expr"; src: string };

export interface V2Row {
  id: number;
  logic: "and" | "or"; // connector to the PREVIOUS row (row 0 ignores it)
  op: CondOp;
  left: Term;
  right: Term;
  right2: Term | null; // between only
  pct: string; // withinPct — percent width, kept as input string
}

export const MAX_BUILDER_ROWS = 50;

let rowSeq = 1;
const nextRowId = () => rowSeq++;

// ================================================================ field catalog

interface SeriesSpec { id: string; kind: "series"; f: SeriesField; label: string; hint?: string }
interface WindowSpec { id: string; kind: "window"; fn: "sma" | "min" | "max"; ser: SeriesField; p: number; label: string; hint?: string }
interface ScalarSpec { id: string; kind: "scalar"; f: string; label: string; scale?: number; hint?: string }
type FieldSpec = SeriesSpec | WindowSpec | ScalarSpec;

/** Field catalog — ids are stable (saved screens store them). */
const FIELD_CATALOG: FieldSpec[] = [
  // Price & volume
  { id: "open", kind: "series", f: "open", label: "Open", hint: "e.g. 500" },
  { id: "high", kind: "series", f: "high", label: "High", hint: "e.g. 500" },
  { id: "low", kind: "series", f: "low", label: "Low", hint: "e.g. 500" },
  { id: "close", kind: "series", f: "close", label: "Close (price)", hint: "e.g. 500" },
  { id: "volume", kind: "series", f: "volume", label: "Volume (shares)", hint: "e.g. 1000000" },
  // Moving averages & ranges
  { id: "smaClose", kind: "window", fn: "sma", ser: "close", p: 50, label: "SMA (close, N)", hint: "e.g. 200" },
  { id: "smaVolume", kind: "window", fn: "sma", ser: "volume", p: 20, label: "SMA (volume, N)", hint: "e.g. 1000000" },
  { id: "maxHigh", kind: "window", fn: "max", ser: "high", p: 20, label: "Highest high (N bars)", hint: "e.g. 500" },
  { id: "minLow", kind: "window", fn: "min", ser: "low", p: 66, label: "Lowest low (N bars)", hint: "e.g. 400" },
  // Momentum & oscillators
  { id: "rsi14", kind: "scalar", f: "rsi14", label: "RSI (14) · daily", hint: "e.g. 30" },
  { id: "wRsi14", kind: "scalar", f: "wRsi14", label: "RSI (14) · weekly", hint: "e.g. 50" },
  { id: "macdHist", kind: "scalar", f: "macdHist", label: "MACD histogram · daily", hint: "e.g. 0" },
  { id: "wMacdHist", kind: "scalar", f: "wMacdHist", label: "MACD histogram · weekly", hint: "e.g. 0" },
  { id: "mom1M", kind: "scalar", f: "mom1M", label: "1M return %", hint: "e.g. 5" },
  { id: "mom3M", kind: "scalar", f: "mom3M", label: "3M return %", hint: "e.g. 10" },
  { id: "mom6M", kind: "scalar", f: "mom6M", label: "6M return %", hint: "e.g. 20" },
  { id: "atr14Pct", kind: "scalar", f: "atr14Pct", label: "ATR % (volatility)", hint: "e.g. 3" },
  { id: "bbPctB", kind: "scalar", f: "bbPctB", label: "Bollinger %B", hint: "e.g. 80" },
  { id: "bbWidthPct", kind: "scalar", f: "bbWidthPct", label: "Bollinger width %", hint: "e.g. 5" },
  // Snapshot & fundamentals
  { id: "marketCap", kind: "scalar", f: "marketCap", scale: 1e7, label: "Market cap (₹ Cr)", hint: "e.g. 5000" },
  { id: "peTTM", kind: "scalar", f: "peTTM", label: "P/E (TTM)", hint: "e.g. 25" },
  { id: "pbRatio", kind: "scalar", f: "pbRatio", label: "P/B ratio", hint: "e.g. 3" },
  { id: "divYield", kind: "scalar", f: "divYield", label: "Dividend yield %", hint: "e.g. 1" },
  { id: "avgVol3M", kind: "scalar", f: "avgVol3M", label: "Avg volume (3M shares)", hint: "e.g. 500000" },
  { id: "changePct", kind: "scalar", f: "changePct", label: "Day change %", hint: "e.g. 2" },
  { id: "fromHighPct", kind: "scalar", f: "fromHighPct", label: "% below 52W high", hint: "e.g. 10" },
  { id: "fromLowPct", kind: "scalar", f: "fromLowPct", label: "% above 52W low", hint: "e.g. 30" },
  { id: "distSma20Pct", kind: "scalar", f: "distSma20Pct", label: "Price vs SMA 20 %", hint: "e.g. 3" },
  { id: "distSma50Pct", kind: "scalar", f: "distSma50Pct", label: "Price vs SMA 50 %", hint: "e.g. 5" },
  { id: "distSma100Pct", kind: "scalar", f: "distSma100Pct", label: "Price vs SMA 100 %", hint: "e.g. 8" },
  { id: "distSma200Pct", kind: "scalar", f: "distSma200Pct", label: "Price vs SMA 200 %", hint: "e.g. 12" },
  { id: "distEma20Pct", kind: "scalar", f: "distEma20Pct", label: "Price vs EMA 20 %", hint: "e.g. 3" },
  { id: "distEma50Pct", kind: "scalar", f: "distEma50Pct", label: "Price vs EMA 50 %", hint: "e.g. 5" },
  { id: "distEma100Pct", kind: "scalar", f: "distEma100Pct", label: "Price vs EMA 100 %", hint: "e.g. 8" },
  { id: "distEma200Pct", kind: "scalar", f: "distEma200Pct", label: "Price vs EMA 200 %", hint: "e.g. 12" },
  { id: "rsRating", kind: "scalar", f: "rsRating", label: "RS Rating (1–99)", hint: "e.g. 70" },
  { id: "epsScore", kind: "scalar", f: "epsScore", label: "EPS Score (1–99)", hint: "e.g. 70" },
];

const FIELD_MAP: Record<string, FieldSpec> = Object.fromEntries(
  FIELD_CATALOG.map((s) => [s.id, s])
);

const GROUPS: { name: string; ids: string[] }[] = [
  { name: "Price & volume", ids: ["open", "high", "low", "close", "volume"] },
  { name: "Moving averages & ranges", ids: ["smaClose", "smaVolume", "maxHigh", "minLow"] },
  {
    name: "Momentum & oscillators",
    ids: ["rsi14", "wRsi14", "macdHist", "wMacdHist", "mom1M", "mom3M", "mom6M", "atr14Pct", "bbPctB", "bbWidthPct"],
  },
  {
    name: "Snapshot & fundamentals",
    ids: [
      "marketCap", "peTTM", "pbRatio", "divYield", "avgVol3M", "changePct", "fromHighPct", "fromLowPct",
      "distSma20Pct", "distSma50Pct", "distSma100Pct", "distSma200Pct",
      "distEma20Pct", "distEma50Pct", "distEma100Pct", "distEma200Pct",
      "rsRating", "epsScore",
    ],
  },
];

const specHasTimeframe = (spec: FieldSpec | undefined): boolean =>
  !!spec && (spec.kind === "series" || spec.kind === "window");

// ================================================================ serialization

/** Series reference with timeframe + bars-ago prefix, e.g. "2 weeks ago high". */
function seriesRef(f: SeriesField, tf: "d" | "w", off: number): string {
  if (tf === "w") {
    return off > 0 ? `${off} week${off > 1 ? "s" : ""} ago ${f}` : `weekly ${f}`;
  }
  return off > 0 ? `${off} candle${off > 1 ? "s" : ""} ago ${f}` : f;
}

/** Term → pro-expression source string (compiled server-side by pro-sql). */
export function termToExpr(t: Term): string {
  if (t.mode === "num") return t.v.trim();
  if (t.mode === "expr") return t.src.trim();
  const spec = FIELD_MAP[t.f];
  if (!spec) return "";
  if (spec.kind === "series") return seriesRef(spec.f, t.tf, t.off);
  if (spec.kind === "window") {
    const ser = seriesRef(spec.ser, t.tf, t.off);
    return spec.fn === "sma" ? `sma(${ser}, ${t.p})` : `${spec.fn}(${t.p}, ${ser})`;
  }
  // snapshot scalar — display-scale fields divide down (market cap ₹ → ₹ Cr)
  return spec.scale ? `${spec.f} / ${spec.scale}` : spec.f;
}

/** Short label for the picker trigger. */
function termShortLabel(t: Term): string {
  if (t.mode === "num") return t.v.trim() || "number";
  if (t.mode === "expr") return t.src.trim() ? "ƒx expression" : "ƒx custom…";
  const spec = FIELD_MAP[t.f];
  if (!spec) return "pick a field";
  if (spec.kind === "series") return spec.label;
  if (spec.kind === "window") {
    const ser = spec.ser.charAt(0).toUpperCase() + spec.ser.slice(1);
    return spec.fn === "sma" ? `SMA(${ser}, ${t.p})` : `${spec.fn === "min" ? "Lowest" : "Highest"} ${ser.toLowerCase()} (${t.p})`;
  }
  return spec.label;
}

// ================================================================ validation

export interface RowErrors {
  left?: string;
  right?: string;
  right2?: string;
  pct?: string;
  general?: string;
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function termError(t: Term): string | undefined {
  if (t.mode === "num") {
    if (!t.v.trim()) return "Enter a number";
    if (!Number.isFinite(Number(t.v))) return "Not a valid number";
    return undefined;
  }
  if (t.mode === "expr") {
    if (!t.src.trim()) return "Enter an expression";
    const parsed = parseProExpr(t.src);
    if (!parsed.ok) return parsed.error;
    return undefined;
  }
  const spec = FIELD_MAP[t.f];
  if (!spec) return "Pick a field";
  if (spec.kind === "window" && (!Number.isInteger(t.p) || t.p < 1 || t.p > 500)) {
    return "Window length must be 1–500 bars";
  }
  if (spec.kind !== "scalar" && (!Number.isInteger(t.off) || t.off < 0 || t.off > 600)) {
    return "Offset must be 0–600 bars back";
  }
  return undefined;
}

function termHasSeries(t: Term): boolean {
  if (t.mode === "field") {
    const spec = FIELD_MAP[t.f];
    return !!spec && spec.kind !== "scalar";
  }
  if (t.mode === "expr") {
    const parsed = parseProExpr(t.src);
    return parsed.ok && !isScalarOnly(parsed.node);
  }
  return false;
}

/** Per-side validation for a row — an empty object means the row is runnable. */
export function rowErrors(r: V2Row): RowErrors {
  const errs: RowErrors = {};
  const l = termError(r.left);
  if (l) errs.left = l;
  const rt = termError(r.right);
  if (rt) errs.right = rt;
  if (r.op === "between") {
    const e = termError(r.right2 ?? { mode: "num", v: "" });
    if (e) errs.right2 = e;
  }
  if (r.op === "withinPct") {
    const p = Number(r.pct);
    if (!r.pct.trim() || !Number.isFinite(p) || p <= 0 || p > 10000) {
      errs.pct = "Percent width 0–10000";
    }
  }
  if ((r.op === "crossAbove" || r.op === "crossBelow") && !termHasSeries(r.left) && !termHasSeries(r.right)) {
    errs.general = "Crosses needs candle fields (price, volume, SMA…) — snapshot values have no previous bar";
  }
  return errs;
}

const firstErrorText = (errs: RowErrors): string | null =>
  (Object.values(errs).find(Boolean) as string | undefined) ?? null;

// ================================================================ wire + formula

export function rowToWire(r: V2Row): Record<string, unknown> {
  const w: Record<string, unknown> = {
    kind: "expr",
    cmp: r.op,
    l: termToExpr(r.left),
    r: termToExpr(r.right),
    logic: r.logic,
  };
  if (r.op === "between" && r.right2) w.r2 = termToExpr(r.right2);
  if (r.op === "withinPct") {
    const p = Number(r.pct);
    if (Number.isFinite(p)) w.pct = p;
  }
  return w;
}

export const rowsToWire = (rows: V2Row[]) => rows.map(rowToWire);

/** The v2 payload string sent as the `cond` URL parameter / saved definition companion. */
export const wirePayload = (rows: V2Row[]) => JSON.stringify({ v: 2, rows: rowsToWire(rows) });

/** Human expression text for one row, e.g. "close > sma(close, 200)". */
export function rowExprText(r: V2Row): string {
  const l = termToExpr(r.left) || "…";
  const rr = termToExpr(r.right) || "…";
  switch (r.op) {
    case "between":
      return `${l} between ${rr} and ${r.right2 ? termToExpr(r.right2) || "…" : "…"}`;
    case "crossAbove":
      return `${l} crosses above ${rr}`;
    case "crossBelow":
      return `${l} crosses below ${rr}`;
    case "withinPct":
      return `${l} within ${r.pct.trim() || "?"}% of ${rr}`;
    case "gt": return `${l} > ${rr}`;
    case "gte": return `${l} ≥ ${rr}`;
    case "lt": return `${l} < ${rr}`;
    case "lte": return `${l} ≤ ${rr}`;
    case "eq": return `${l} = ${rr}`;
  }
}

/** Split rows into AND-separated segments (each an OR-group) — "1 AND (2 OR 3)". */
export function formulaText(rows: V2Row[]): string {
  const segs: number[][] = [];
  rows.forEach((r, i) => {
    if (i === 0 || r.logic === "and") segs.push([i]);
    else segs[segs.length - 1].push(i);
  });
  return segs
    .map((s) => (s.length === 1 ? `${s[0] + 1}` : `(${s.map((i) => i + 1).join(" OR ")})`))
    .join(" AND ");
}

// ================================================================ recently used fields

const RECENT_KEY = "tp.builder.recentFields";

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string" && !!FIELD_MAP[x]).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are a nicety, not a requirement */
  }
}

// ================================================================ field picker

type FieldPick = { type: "field"; id: string } | { type: "expr" };

/** Searchable, grouped field dropdown with recently-used fields pinned on top. */
function FieldPicker({
  trigger,
  onPick,
  allowExpr,
  ariaLabel,
}: {
  trigger: React.ReactNode;
  onPick: (pick: FieldPick) => void;
  allowExpr: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setOpenSafe = (next: boolean) => {
    setOpen(next);
    if (next) {
      setSearch("");
      setRecents(readRecents()); // read on open — event handler, not render/effect
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = search.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(q);

  const item = (spec: FieldSpec) => (
    <button
      key={spec.id}
      type="button"
      onClick={() => {
        pushRecent(spec.id);
        onPick({ type: "field", id: spec.id });
        setOpen(false);
      }}
      className="block w-full truncate px-3 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-zinc-800"
    >
      {spec.label}
    </button>
  );

  const section = (title: string, children: React.ReactNode) => (
    <div key={title}>
      <div className="sticky top-0 bg-zinc-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        {title}
      </div>
      {children}
    </div>
  );

  let found = 0;
  GROUPS.forEach((g) => g.ids.forEach((id) => { if (FIELD_MAP[id] && matches(FIELD_MAP[id].label)) found++; }));

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpenSafe(!open)}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(
          "flex h-8 min-w-32 max-w-64 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-left text-xs transition-colors hover:border-zinc-600",
          open ? "border-brand/60" : "text-zinc-200"
        )}
      >
        <span className="min-w-0 flex-1 truncate">{trigger}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-40 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="border-b border-zinc-800 p-2">
            <Input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields… (try “rsi”)"
              aria-label="Search fields"
              className="h-7 border-zinc-700 bg-zinc-950 text-xs text-zinc-100"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {!q && recents.length > 0 &&
              section("Recent", recents.map((id) => FIELD_MAP[id]).filter(Boolean).map(item))}
            {GROUPS.map((g) => {
              const specs = g.ids.map((id) => FIELD_MAP[id]).filter((s): s is FieldSpec => !!s && matches(s.label));
              if (specs.length === 0) return null;
              return section(g.name, specs.map(item));
            })}
            {allowExpr && matches("custom expression") &&
              section("Advanced", (
                <button
                  type="button"
                  onClick={() => {
                    onPick({ type: "expr" });
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-brand-text transition-colors hover:bg-zinc-800"
                >
                  ƒx Custom expression…
                </button>
              ))}
            {found === 0 && !matches("custom expression") && (
              <p className="px-3 py-3 text-center text-[11px] text-zinc-500">No fields match “{search}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================ term editor

/** Daily / Weekly segmented control. */
function TFSeg({ value, onChange }: { value: "d" | "w"; onChange: (v: "d" | "w") => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-zinc-700" role="group" aria-label="Timeframe">
      {([
        ["d", "D", "Daily candle"],
        ["w", "W", "Weekly candle"],
      ] as const).map(([v, lab, tip]) => (
        <button
          key={v}
          type="button"
          title={tip}
          onClick={() => onChange(v)}
          className={cn(
            "h-8 px-2 text-[11px] font-medium transition-colors",
            value === v ? "bg-brand/20 text-brand-text" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
          )}
        >
          {lab}
        </button>
      ))}
    </div>
  );
}

/**
 * One operand editor. Right side gets the 123 / ƒx pill (static number vs
 * field expression). Field mode renders picker + timeframe + bars-ago +
 * window length; expression mode reuses ExprEditor with live validation.
 */
function TermEditor({
  rowId,
  side,
  term,
  onChange,
  error,
  allowNum,
  numPlaceholder,
}: {
  rowId: number;
  side: "l" | "r" | "r2";
  term: Term;
  onChange: (t: Term) => void;
  error?: string;
  allowNum: boolean;
  numPlaceholder: string;
}) {
  const defaultField: Term = { mode: "field", f: "close", tf: "d", off: 0, p: 50 };

  const spec = term.mode === "field" ? FIELD_MAP[term.f] : undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {allowNum && (
        <div className="flex overflow-hidden rounded-md border border-zinc-700" role="group" aria-label="Operand type">
          <button
            type="button"
            title="Static number"
            aria-label="Number mode"
            onClick={() => onChange({ mode: "num", v: "" })}
            className={cn(
              "h-8 px-1.5 font-mono text-[11px] transition-colors",
              term.mode === "num" ? "bg-brand/20 text-brand-text" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
            )}
          >
            123
          </button>
          <button
            type="button"
            title="Another field or expression"
            aria-label="Formula mode"
            onClick={() => onChange(defaultField)}
            className={cn(
              "h-8 px-1.5 text-[11px] transition-colors",
              term.mode !== "num" ? "bg-brand/20 text-brand-text" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
            )}
          >
            ƒx
          </button>
        </div>
      )}

      {term.mode === "num" ? (
        <div className="min-w-0 flex-1">
          <Input
            type="number"
            value={term.v}
            onChange={(e) => onChange({ mode: "num", v: e.target.value })}
            placeholder={numPlaceholder}
            aria-label={side === "l" ? "Left number" : "Right number"}
            className={cn(
              "h-8 w-full min-w-24 border-zinc-700 bg-zinc-900 text-xs text-zinc-100",
              error && "border-loss/70"
            )}
          />
          {error && <p className="mt-0.5 text-[10px] leading-tight text-loss">{error}</p>}
        </div>
      ) : term.mode === "field" ? (
        <>
          {!allowNum && (
            <button
              type="button"
              onClick={() => onChange({ mode: "expr", src: "" })}
              title="Type a custom expression instead"
              aria-label="Switch to custom expression"
              className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-[11px] text-zinc-400 transition-colors hover:border-brand/50 hover:text-brand-text"
            >
              ƒx
            </button>
          )}
          <FieldPicker
            ariaLabel={side === "l" ? "Left operand field" : "Right operand field"}
            trigger={termShortLabel(term)}
            allowExpr
            onPick={(pick) => {
              if (pick.type === "expr") {
                onChange({ mode: "expr", src: "" });
                return;
              }
              const nextSpec = FIELD_MAP[pick.id];
              if (!nextSpec) return;
              const tfAble = specHasTimeframe(nextSpec);
              const prevTf = term.mode === "field" ? term.tf : "d";
              const prevOff = term.mode === "field" ? term.off : 0;
              onChange({
                mode: "field",
                f: nextSpec.id,
                tf: tfAble ? prevTf : "d",
                off: tfAble ? prevOff : 0,
                p: nextSpec.kind === "window" ? nextSpec.p : 1,
              });
            }}
          />
          {term.mode === "field" && specHasTimeframe(spec) && (
            <>
              <TFSeg value={term.tf} onChange={(tf) => onChange({ ...term, tf })} />
              <div className="flex items-center gap-0.5">
                <Input
                  type="number"
                  min={0}
                  value={term.off}
                  onChange={(e) => onChange({ ...term, off: clampInt(e.target.value, 0, 600) })}
                  className="h-8 w-12 border-zinc-700 bg-zinc-900 px-1.5 text-center font-mono text-xs text-zinc-100"
                  aria-label="Bars back"
                  title="0 = latest bar · N = N bars back (candles on Daily, weeks on Weekly)"
                />
                <span className="text-[10px] text-zinc-600">ago</span>
              </div>
            </>
          )}
          {term.mode === "field" && spec?.kind === "window" && (
            <Input
              type="number"
              min={1}
              max={500}
              value={term.p}
              onChange={(e) => onChange({ ...term, p: clampInt(e.target.value, 1, 500) })}
              className="h-8 w-16 border-zinc-700 bg-zinc-900 px-1.5 text-center font-mono text-xs text-zinc-100"
              aria-label="Window length"
              title="Window length in bars (the N in SMA / highest / lowest)"
            />
          )}
          {error && <p className="basis-full text-[10px] leading-tight text-loss">{error}</p>}
        </>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-1.5">
          <ExprEditor
            value={term.src}
            onChange={(v) => onChange({ mode: "expr", src: v })}
            placeholder="expression — e.g. close / min(66, low)"
            ariaLabel={side === "l" ? "Left expression" : "Right expression"}
            inputKey={`${rowId}:${side}`}
            registerInput={() => {}}
            onFocusKey={() => {}}
          />
          <button
            type="button"
            onClick={() => onChange(defaultField)}
            title="Pick a field instead"
            aria-label="Switch to field picker"
            className="mt-1 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ListTree className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ================================================================ logic chip + row card

function LogicChip({ value, onToggle }: { value: "and" | "or"; onToggle: () => void }) {
  return (
    <div className="flex justify-center py-0.5">
      <button
        type="button"
        onClick={onToggle}
        title={
          value === "and"
            ? "AND — both conditions must match. Click to switch to OR."
            : "OR — either condition matches (amber box). Click to switch back to AND."
        }
        aria-label={`Connector ${value.toUpperCase()} — click to toggle`}
        className={cn(
          "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
          value === "or"
            ? "border-gold/50 bg-gold/10 text-gold-text hover:bg-gold/20"
            : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
        )}
      >
        {value.toUpperCase()}
      </button>
    </div>
  );
}

const OP_GROUPS: { label: string; ops: { op: CondOp; label: string }[] }[] = [
  {
    label: "Compare",
    ops: [
      { op: "gt", label: ">" },
      { op: "gte", label: "≥" },
      { op: "lt", label: "<" },
      { op: "lte", label: "≤" },
      { op: "eq", label: "=" },
      { op: "between", label: "between" },
    ],
  },
  {
    label: "Pattern",
    ops: [
      { op: "crossAbove", label: "crosses above" },
      { op: "crossBelow", label: "crosses below" },
      { op: "withinPct", label: "within % of" },
    ],
  },
];

function RowCard({
  row,
  index,
  errors,
  dragOver,
  onPatch,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  row: V2Row;
  index: number;
  errors: RowErrors;
  dragOver: boolean;
  onPatch: (patch: Partial<V2Row>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const leftSpec = row.left.mode === "field" ? FIELD_MAP[row.left.f] : undefined;
  const numPlaceholder = leftSpec?.hint ?? "e.g. 100";
  const firstErr = firstErrorText(errors);
  const isCross = row.op === "crossAbove" || row.op === "crossBelow";

  const opSelect = (
    <select
      value={row.op}
      onChange={(e) => {
        const op = e.target.value as CondOp;
        if (op === "between" && !row.right2) onPatch({ op, right2: { mode: "num", v: "" } });
        else if (op === "withinPct" && !row.pct.trim()) onPatch({ op, pct: "2" });
        else onPatch({ op });
      }}
      className="h-8 max-w-36 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-xs text-zinc-200"
      aria-label="Operator"
    >
      {OP_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.ops.map((o) => (
            <option key={o.op} value={o.op}>{o.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex flex-wrap items-center gap-x-1.5 gap-y-2 rounded-lg border border-transparent px-0.5 py-1 transition-colors",
        dragOver && "border-brand/50 bg-brand/5"
      )}
    >
      <span className="w-4 shrink-0 select-none text-center font-mono text-[10px] text-zinc-600" title={`Condition ${index + 1}`}>
        {index + 1}
      </span>
      <GripVertical
        className="hidden h-4 w-4 shrink-0 cursor-grab text-zinc-700 transition-colors group-hover:text-zinc-500 active:cursor-grabbing sm:block"
        aria-hidden
      />

      <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:basis-auto sm:pr-1">
        <TermEditor
          rowId={row.id}
          side="l"
          term={row.left}
          onChange={(t) => onPatch({ left: t })}
          error={errors.left}
          allowNum={false}
          numPlaceholder={numPlaceholder}
        />
      </div>

      <div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5 sm:basis-auto">
        {opSelect}
        {row.op === "withinPct" && (
          <Input
            type="number"
            value={row.pct}
            onChange={(e) => onPatch({ pct: e.target.value })}
            placeholder="%"
            aria-label="Percent width"
            title="How close the two sides must be, in percent"
            className={cn(
              "h-8 w-16 border-zinc-700 bg-zinc-900 text-center font-mono text-xs text-zinc-100",
              errors.pct && "border-loss/70"
            )}
          />
        )}
        {isCross && (
          <span title="True only on the bar where the cross happens — automatically compares with the previous candle">
            <Info className="h-3.5 w-3.5 text-zinc-600" />
          </span>
        )}
        <TermEditor
          rowId={row.id}
          side="r"
          term={row.right}
          onChange={(t) => onPatch({ right: t })}
          error={errors.right}
          allowNum
          numPlaceholder={numPlaceholder}
        />
        {row.op === "between" && (
          <>
            <span className="text-[10px] text-zinc-600">and</span>
            <TermEditor
              rowId={row.id}
              side="r2"
              term={row.right2 ?? { mode: "num", v: "" }}
              onChange={(t) => onPatch({ right2: t })}
              error={errors.right2}
              allowNum
              numPlaceholder={numPlaceholder}
            />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove condition"
        title="Remove this condition"
        className="ml-auto rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-loss sm:ml-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {firstErr && <p className="basis-full pl-6 text-[10px] leading-tight text-loss">{firstErr}</p>}
    </div>
  );
}

// ================================================================ presets

const fT = (f: string, o?: { tf?: "d" | "w"; off?: number; p?: number }): Term => ({
  mode: "field",
  f,
  tf: o?.tf ?? "d",
  off: o?.off ?? 0,
  p: o?.p ?? (FIELD_MAP[f]?.kind === "window" ? (FIELD_MAP[f] as WindowSpec).p : 1),
});
const nT = (v: string): Term => ({ mode: "num", v });
const xT = (src: string): Term => ({ mode: "expr", src });
const mk = (
  logic: "and" | "or",
  op: CondOp,
  left: Term,
  right: Term,
  extra?: { right2?: Term; pct?: string }
): Omit<V2Row, "id"> => ({
  logic,
  op,
  left,
  right,
  right2: extra?.right2 ?? null,
  pct: extra?.pct ?? "",
});

/** Built-in presets — loaded into the builder, fully editable afterwards. */
export const PRESETS: { name: string; rows: Omit<V2Row, "id">[] }[] = [
  {
    name: "Momentum leaders",
    rows: [
      mk("and", "gt", fT("rsi14"), nT("60")),
      mk("and", "gt", fT("mom6M"), nT("20")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 200 })),
      mk("and", "lte", fT("fromHighPct"), nT("15")),
    ],
  },
  {
    name: "Oversold bounce watch",
    rows: [
      mk("and", "lt", fT("rsi14"), nT("40")),
      mk("and", "lt", fT("mom1M"), nT("-5")),
      mk("and", "gt", fT("close"), nT("50")),
    ],
  },
  {
    name: "Volume accumulation",
    rows: [
      mk("and", "gt", fT("volume"), xT("2 * sma(volume, 20)")),
      mk("and", "gt", fT("changePct"), nT("1")),
      mk("and", "between", fT("marketCap"), nT("5000"), { right2: nT("200000") }),
    ],
  },
  {
    name: "Near 52-week high",
    rows: [
      mk("and", "lte", fT("fromHighPct"), nT("5")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 50 })),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 200 })),
    ],
  },
  {
    name: "Chartink · 66-day breakout (weekly calm)",
    rows: [
      mk("and", "gte", xT("close / min(66, low)"), nT("1.30")),
      mk("and", "gt", fT("marketCap"), nT("0")),
      mk("and", "gte", fT("close"), nT("1")),
      mk("and", "gt", xT("close * sma(volume, 20)"), nT("30000000")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 200 })),
      mk("and", "lte", xT("abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("6")),
      mk("and", "lte", xT("abs(2 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("6")),
      mk("and", "lte", xT("abs(3 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("6")),
      mk("and", "lt", fT("close", { tf: "w", off: 1 }), fT("high", { tf: "w", off: 2 })),
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 1 })),
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 2 })),
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 3 })),
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 4 })),
    ],
  },
  {
    name: "Weekly higher-highs streak",
    rows: [
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 1 })),
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 2 })),
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 3 })),
      mk("and", "gte", fT("high", { tf: "w" }), fT("high", { tf: "w", off: 4 })),
      mk("and", "gt", fT("close", { tf: "w" }), fT("smaClose", { tf: "w", p: 10 })),
      mk("and", "gte", fT("marketCap"), nT("1000")),
    ],
  },
  {
    name: "Trend + tight weekly swings",
    rows: [
      mk("and", "gt", fT("close"), fT("smaClose", { p: 50 })),
      mk("and", "gt", fT("smaClose", { p: 50 }), fT("smaClose", { p: 200 })),
      mk("and", "lte", xT("abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))"), nT("4")),
      mk("and", "gte", xT("close * sma(volume, 20)"), nT("10000000")),
      mk("and", "gte", fT("marketCap"), nT("1000")),
    ],
  },
  {
    name: "Cross back above SMA 50",
    rows: [
      mk("and", "crossAbove", fT("close"), fT("smaClose", { p: 50 })),
      mk("and", "gte", fT("marketCap"), nT("1000")),
    ],
  },
  {
    name: "Riding the 52W high (within 2%)",
    rows: [
      mk("and", "withinPct", fT("close"), fT("maxHigh", { p: 252 }), { pct: "2" }),
      mk("and", "gte", fT("avgVol3M"), nT("200000")),
    ],
  },
];

/** Empty-state quick starts (Component 7). */
const SHORTCUTS: { key: string; label: string; rows: Omit<V2Row, "id">[] }[] = [
  {
    key: "vol",
    label: "Volume Breakout",
    rows: [mk("and", "gt", fT("volume"), xT("2 * sma(volume, 20)"))],
  },
  {
    key: "oversold",
    label: "Oversold Bounce",
    rows: [
      mk("and", "lt", fT("rsi14"), nT("40")),
      mk("and", "gt", fT("close"), nT("50")),
    ],
  },
  {
    key: "w52",
    label: "52W High Breakout",
    rows: [
      mk("and", "lte", fT("fromHighPct"), nT("5")),
      mk("and", "gt", fT("close"), fT("smaClose", { p: 50 })),
    ],
  },
];

// ================================================================ saved-screen converters

const termOf = (x: unknown, fallback: Term): Term => {
  if (x && typeof x === "object") {
    const t = x as Record<string, unknown>;
    if (t.mode === "num") return { mode: "num", v: typeof t.v === "string" ? t.v : String(t.v ?? "") };
    if (t.mode === "field" && typeof t.f === "string" && FIELD_MAP[t.f]) {
      return {
        mode: "field",
        f: t.f,
        tf: t.tf === "w" ? "w" : "d",
        off: clampInt(String(t.off ?? 0), 0, 600),
        p: clampInt(String(t.p ?? 1), 1, 500),
      };
    }
    if (t.mode === "expr" && typeof t.src === "string") return { mode: "expr", src: t.src };
  }
  return fallback;
};

/** Revive a v2 saved definition (UI-shaped rows) into editor rows. */
export function v2DefToRows(rawRows: unknown[]): V2Row[] {
  return rawRows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const op = OP_LIST.includes(r.op as CondOp) ? (r.op as CondOp) : "gt";
    return {
      id: nextRowId(),
      logic: r.logic === "or" ? "or" : "and",
      op,
      left: termOf(r.left, { mode: "field", f: "close", tf: "d", off: 0, p: 50 }),
      right: termOf(r.right, { mode: "num", v: "" }),
      right2: op === "between" ? termOf(r.right2, { mode: "num", v: "" }) : null,
      pct: typeof r.pct === "string" ? r.pct : r.pct != null ? String(r.pct) : "",
    };
  });
}

/**
 * Convert a legacy (pre-rebuild) saved definition — flat wire rows — into
 * editor rows. Boolean signal flags become equivalent pro comparisons
 * (aboveSma200 → close > sma(close, 200) …). Legacy OR chips map onto OR
 * chips one-to-one; the caller surfaces a note because legacy OR semantics
 * ("or" started a new AND-branch) differ from the v2 box model.
 */
export function legacyDefToRows(rawRows: unknown[]): { rows: V2Row[]; orUsed: boolean } {
  let orUsed = false;
  const WEEKLY_KEY: Record<string, [string, "w"]> = {
    wClose: ["close", "w"], wOpen: ["open", "w"], wHigh: ["high", "w"], wLow: ["low", "w"],
  };
  const ALIAS: Record<string, string> = { price: "close", dayHigh: "high", dayLow: "low" };
  const numStr = (x: unknown, scale = 1) => {
    const n = Number(x);
    return Number.isFinite(n) ? String(n / scale) : "";
  };

  const rows = rawRows.map((raw): V2Row => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const logic: "and" | "or" = r.logic === "or" ? "or" : "and";
    if (logic === "or") orUsed = true;

    if (r.kind === "expr") {
      const cmpRaw = typeof r.cmp === "string" ? r.cmp : "gte";
      const op: CondOp = (["gt", "gte", "lt", "lte", "eq"] as const).includes(cmpRaw as "gt")
        ? (cmpRaw as CondOp)
        : cmpRaw === "between"
          ? "between"
          : "gte";
      return {
        id: nextRowId(),
        logic,
        op,
        left: { mode: "expr", src: typeof r.l === "string" ? r.l : "" },
        right: { mode: "expr", src: typeof r.r === "string" ? r.r : "" },
        right2: op === "between" ? { mode: "expr", src: typeof r.r2 === "string" ? r.r2 : "" } : null,
        pct: "",
      };
    }

    const f = typeof r.f === "string" ? r.f : "price";
    const opRaw = typeof r.op === "string" ? r.op : "gt";
    const boolVal = r.v === true || r.v === "true";
    const cmpOp: CondOp = (["gt", "gte", "lt", "lte"] as const).includes(opRaw as "gt")
      ? (opRaw as CondOp)
      : "gt";

    // Signal flags → equivalent pro comparisons.
    if (f === "aboveSma20" || f === "aboveSma50" || f === "aboveSma200") {
      const p = f === "aboveSma20" ? 20 : f === "aboveSma50" ? 50 : 200;
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lt", left: fT("close"), right: fT("smaClose", { p }), right2: null, pct: "" };
    }
    if (f === "volSpike") {
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lte", left: fT("volume"), right: xT("2 * sma(volume, 20)"), right2: null, pct: "" };
    }
    if (f === "goldenCross") {
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lt", left: fT("smaClose", { p: 20 }), right: fT("smaClose", { p: 50 }), right2: null, pct: "" };
    }
    if (f === "emaCross") {
      return { id: nextRowId(), logic, op: boolVal ? "gt" : "lt", left: fT("distEma20Pct"), right: fT("distEma50Pct"), right2: null, pct: "" };
    }

    const weekly = WEEKLY_KEY[f];
    const fid = weekly ? weekly[0] : (ALIAS[f] ?? (FIELD_MAP[f] ? f : "close"));
    const tf: "d" | "w" = weekly ? weekly[1] : "d";
    const scale = f === "marketCap" ? 1e7 : 1;
    const op: CondOp = opRaw === "between" ? "between" : cmpOp;
    return {
      id: nextRowId(),
      logic,
      op,
      left: fT(fid, { tf }),
      right: { mode: "num", v: numStr(r.v, scale) },
      right2: op === "between" ? { mode: "num", v: numStr(r.v2, scale) } : null,
      pct: "",
    };
  });

  return { rows, orUsed };
}

// ================================================================ main component

export interface BuilderStateInfo {
  name: string | null;
  dirty: boolean;
  wireJson: string;
}

export interface BuilderInitial {
  rows: V2Row[];
  name: string | null;
  screenId: string | null;
  baselineWire: string;
  legacyOrNote?: boolean;
}

const blankRow = (): V2Row => ({
  id: nextRowId(),
  logic: "and",
  op: "gt",
  left: { mode: "field", f: "close", tf: "d", off: 0, p: 50 },
  right: { mode: "num", v: "" },
  right2: null,
  pct: "",
});

export function ConditionBuilder({
  sectors,
  onSelectStock,
  initial,
  onStateChange,
  onSaveNew,
  onUpdate,
}: {
  sectors: (string | null)[];
  onSelectStock: (s: string) => void;
  initial?: BuilderInitial | null;
  onStateChange?: (s: BuilderStateInfo) => void;
  onSaveNew?: (name: string, definition: unknown) => Promise<string | null>;
  onUpdate?: (id: string, name: string, definition: unknown) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<V2Row[]>(() => initial?.rows ?? []);
  const [applied, setApplied] = useState<V2Row[] | null>(() => initial?.rows ?? null);
  const [editingName, setEditingName] = useState<string | null>(initial?.name ?? null);
  const [editingId, setEditingId] = useState<string | null>(initial?.screenId ?? null);
  const baselineRef = useRef<string>(initial?.baselineWire ?? "");
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [sector, setSector] = useState("all");
  const [bSort, setBSort] = useState("marketCap");
  const [bDir, setBDir] = useState<"asc" | "desc">("desc");
  const [bPage, setBPage] = useState(1);
  const [previewWire, setPreviewWire] = useState<string | null>(null);
  const dragId = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  /** Push the current editing state up (called from mutation handlers only). */
  const report = (next: V2Row[], over?: { name?: string | null; baseline?: string }) => {
    if (!onStateChange) return;
    const name = over?.name !== undefined ? over.name : editingName;
    const base = over?.baseline !== undefined ? over.baseline : baselineRef.current;
    const wireJson = wirePayload(next);
    onStateChange({ name, dirty: base !== wireJson, wireJson });
  };

  const commit = (next: V2Row[]) => {
    setRows(next);
    report(next);
  };

  const addRow = () => {
    if (rows.length >= MAX_BUILDER_ROWS) return;
    commit([...rows, blankRow()]);
  };

  const patchRow = (id: number, patch: Partial<V2Row>) =>
    commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: number) => {
    const next = rows.filter((r) => r.id !== id);
    commit(next);
    if (next.length === 0) setApplied(null);
  };

  const setLogic = (id: number, logic: "and" | "or") => patchRow(id, { logic });

  const moveRow = (fromId: number, toId: number) => {
    const from = rows.findIndex((r) => r.id === fromId);
    const to = rows.findIndex((r) => r.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  const loadRowSet = (preset: Omit<V2Row, "id">[], note?: string) => {
    commit(preset.map((r) => ({ ...r, id: nextRowId() })));
    setApplied(null);
    setBPage(1);
    if (note) toast({ title: note });
  };

  // ------------------------------------------------------------ validation
  const errMap = useMemo(() => new Map(rows.map((r) => [r.id, rowErrors(r)])), [rows]);
  const firstBadRow = rows.findIndex((r) => Object.keys(errMap.get(r.id) ?? {}).length > 0);
  const complete = rows.length > 0 && firstBadRow === -1;
  const applyTooltip = !complete
    ? rows.length === 0
      ? "Add at least one condition first"
      : `Row ${firstBadRow + 1}: ${firstErrorText(errMap.get(rows[firstBadRow].id) ?? {}) ?? "is incomplete"}`
    : "Run the screen";

  // ------------------------------------------------------------ live counter (debounced)
  const liveWireJson = useMemo(() => wirePayload(rows), [rows]);
  const appliedWireJson = useMemo(() => (applied ? wirePayload(applied) : null), [applied]);
  const applyDirty = applied != null && liveWireJson !== appliedWireJson;

  useEffect(() => {
    const t = setTimeout(() => setPreviewWire(complete ? liveWireJson : null), 450);
    return () => clearTimeout(t);
  }, [liveWireJson, complete]);

  const { data: cData, isFetching: cFetching, error: cError } = useQuery<StocksResponse>({
    queryKey: ["condPreview", previewWire, sector, bSort, bDir],
    queryFn: async () => {
      const params = new URLSearchParams({ cond: previewWire ?? "[]", sector, sort: bSort, dir: bDir, page: "1", perPage: "10" });
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d?.error ?? "Preview failed");
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: previewWire !== null,
  });

  // ------------------------------------------------------------ applied results
  const { data: bData, isLoading: bLoading, error: bError } = useQuery<StocksResponse>({
    queryKey: ["screenerBuilder", appliedWireJson, sector, bSort, bDir, bPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        cond: appliedWireJson ?? "[]", sector, sort: bSort, dir: bDir, page: String(bPage), perPage: "25",
      });
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d?.error ?? "Screen failed — check the conditions");
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: appliedWireJson !== null,
  });

  const applyConditions = () => {
    if (!complete) return;
    setApplied(rows);
    setBPage(1);
  };

  const resetConditions = () => {
    if (rows.length >= 3 && !resetConfirm) {
      setResetConfirm(true);
      window.setTimeout(() => setResetConfirm(false), 3500);
      return;
    }
    setResetConfirm(false);
    commit([]);
    setApplied(null);
    setBPage(1);
  };

  // ------------------------------------------------------------ save / update
  const definition = useMemo(
    () => ({
      v: 2,
      rows: rows.map((r) => {
        const copy = { ...r } as Record<string, unknown>;
        delete copy.id;
        return copy;
      }),
    }),
    [rows]
  );

  const saveAsNew = async () => {
    const name = nameDraft.trim();
    if (!name || !onSaveNew || saving) return;
    setSaving(true);
    try {
      const id = await onSaveNew(name, definition);
      if (id) {
        setEditingId(id);
        setEditingName(name);
        baselineRef.current = liveWireJson;
        report(rows, { name, baseline: liveWireJson });
        setNameOpen(false);
        setNameDraft("");
      }
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!editingId || !onUpdate || saving) return;
    setSaving(true);
    try {
      const ok = await onUpdate(editingId, editingName ?? "", definition);
      if (ok) {
        baselineRef.current = liveWireJson;
        report(rows, { baseline: liveWireJson });
      }
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------ segments (OR boxes)
  const segs = useMemo(() => {
    const out: number[][] = [];
    rows.forEach((r, i) => {
      if (i === 0 || r.logic === "and") out.push([i]);
      else out[out.length - 1].push(i);
    });
    return out;
  }, [rows]);

  const copyFormula = () => {
    const text =
      rows.map((r, i) => `${i + 1}. ${rowExprText(r)}`).join("\n") + `\n\n${formulaText(rows)}`;
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast({ title: "Formula copied" }))
      .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
  };

  const nameEditor = (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void saveAsNew()}
        placeholder="Screen name…"
        aria-label="Screen name"
        className="h-8 w-40 border-zinc-700 bg-zinc-900 text-xs text-zinc-100"
      />
      <Button
        size="sm"
        disabled={saving || !nameDraft.trim()}
        onClick={() => void saveAsNew()}
        className="h-8 bg-brand px-2.5 text-xs text-white hover:bg-brand-hover"
      >
        Save
      </Button>
      <button
        type="button"
        onClick={() => setNameOpen(false)}
        aria-label="Cancel save"
        className="rounded p-1 text-zinc-500 hover:text-zinc-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const totalPages = (total: number, perPage: number) => Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="space-y-3 p-3">
          {/* toolbar — add / preset / formula / reset · counter · save · apply */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={addRow}
              disabled={rows.length >= MAX_BUILDER_ROWS}
              className="h-8 border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add condition
            </Button>
            <select
              value=""
              onChange={(e) => {
                const p = PRESETS.find((x) => x.name === e.target.value);
                if (p) loadRowSet(p.rows, `Preset loaded — “${p.name}”`);
              }}
              className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-300"
              aria-label="Load a preset screen"
            >
              <option value="">Load preset…</option>
              {PRESETS.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => setFormulaOpen((v) => !v)}
                title="Show the formula the builder represents (read-only, copy-friendly)"
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                  formulaOpen
                    ? "border-brand/50 bg-brand/10 text-brand-text"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                )}
              >
                <span className="font-mono">{"{ }"}</span> Formula
              </button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={resetConditions}
              className={cn(
                "h-8 px-2.5 text-xs",
                resetConfirm ? "bg-loss/10 text-loss hover:text-loss" : "text-zinc-500 hover:text-zinc-300"
              )}
              title={resetConfirm ? "Click again to clear all conditions" : "Clear all conditions"}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {resetConfirm ? "Clear everything?" : "Reset"}
            </Button>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {/* live match counter (Component 4) */}
              <span className="text-[11px]" aria-live="polite">
                {!complete ? (
                  <span className="italic text-zinc-600">
                    {rows.length === 0 ? "Add a condition to preview" : "Complete all fields to preview"}
                  </span>
                ) : cFetching ? (
                  <span className="animate-pulse text-zinc-400">checking…</span>
                ) : cError ? (
                  <span className="text-gold-text">
                    Preview failed — {cError instanceof Error ? cError.message : "check conditions"}
                  </span>
                ) : cData ? (
                  cData.total === 0 ? (
                    <span className="text-gold-text">0 stocks match — check your condition values</span>
                  ) : (
                    <span className="text-zinc-300">
                      <b className="font-semibold text-brand-text">~{cData.total.toLocaleString("en-IN")}</b> stocks match
                    </span>
                  )
                ) : (
                  <span className="text-zinc-600">…</span>
                )}
              </span>

              {editingId ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => void updateExisting()}
                    disabled={saving || !complete}
                    title="Save these conditions over the loaded screen"
                    className="h-8 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
                  >
                    {saving ? "Saving…" : "Update"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-zinc-700 bg-zinc-900 px-1.5 text-zinc-300 hover:bg-zinc-800"
                        aria-label="More save options"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-zinc-700 bg-zinc-900 text-zinc-200">
                      <DropdownMenuItem
                        onClick={() => {
                          setNameDraft(editingName ? `${editingName} copy` : "");
                          setNameOpen(true);
                        }}
                      >
                        Save as new…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : nameOpen ? (
                nameEditor
              ) : (
                <Button
                  size="sm"
                  onClick={() => setNameOpen(true)}
                  disabled={!complete}
                  title={complete ? "Save these conditions under a name" : applyTooltip}
                  className="h-8 gap-1.5 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover"
                >
                  Save screen
                </Button>
              )}

              <span title={applyTooltip}>
                <Button
                  size="sm"
                  onClick={applyConditions}
                  disabled={!complete}
                  className="relative h-8 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
                >
                  Apply
                  {applyDirty && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-gold" title="Edits not applied yet" />
                  )}
                </Button>
              </span>
            </div>
          </div>

          {initial?.legacyOrNote && (
            <p className="rounded-md border border-gold/30 bg-gold/[0.06] px-3 py-1.5 text-[11px] leading-relaxed text-gold-text">
              Loaded an older-format screen — OR chips now read as boxed OR-groups (A AND (B OR C)).
              Double-check the amber boxes before re-running.
            </p>
          )}

          {/* conditions + OR boxes (Component 1 & 2) */}
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-800 py-10 text-center">
              <SlidersHorizontal className="h-6 w-6 text-zinc-700" />
              <div>
                <p className="text-xs font-medium text-zinc-300">Build your screen condition by condition</p>
                <p className="mt-1 max-w-md text-[11px] leading-relaxed text-zinc-500">
                  Pick fields, set operators, chain with AND / OR — the live counter previews matches as you type.
                  ƒx fields take a timeframe and a bars-ago offset; the Pattern operators add crosses and percent windows.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => loadRowSet([mk("and", "lt", fT("rsi14"), nT("30"))])}
                  className="h-7 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-200 hover:bg-zinc-800"
                >
                  Try an example — RSI(14) &lt; 30
                </Button>
                <span className="text-[10px] text-zinc-600">or start from a popular scan:</span>
                {SHORTCUTS.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant="ghost"
                    onClick={() => loadRowSet(s.rows, `Starter loaded — ${s.label}`)}
                    className="h-7 border border-zinc-800 px-2 text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {segs.map((seg, si) => {
                const multi = seg.length > 1;
                const body = seg.map((rowIdx, j) => (
                  <div key={rows[rowIdx].id}>
                    {multi && j > 0 && <LogicChip value="or" onToggle={() => setLogic(rows[rowIdx].id, "and")} />}
                    <RowCard
                      row={rows[rowIdx]}
                      index={rowIdx}
                      errors={errMap.get(rows[rowIdx].id) ?? {}}
                      dragOver={dragOverId === rows[rowIdx].id}
                      onPatch={(patch) => patchRow(rows[rowIdx].id, patch)}
                      onRemove={() => removeRow(rows[rowIdx].id)}
                      onDragStart={(e) => {
                        dragId.current = rows[rowIdx].id;
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverId !== rows[rowIdx].id) setDragOverId(rows[rowIdx].id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId.current != null) moveRow(dragId.current, rows[rowIdx].id);
                        dragId.current = null;
                        setDragOverId(null);
                      }}
                      onDragEnd={() => setDragOverId(null)}
                    />
                  </div>
                ));
                return (
                  <div key={rows[seg[0]].id}>
                    {si > 0 && <LogicChip value="and" onToggle={() => setLogic(rows[seg[0]].id, "or")} />}
                    {multi ? (
                      <div
                        className="rounded-r-lg border-l-2 border-gold/50 bg-gold/[0.04] py-1.5 pl-2 pr-1"
                        title="OR group — matches when any row inside matches"
                      >
                        {body}
                      </div>
                    ) : (
                      body
                    )}
                  </div>
                );
              })}
              {rows.length >= MAX_BUILDER_ROWS && (
                <p className="pt-1 text-[10px] text-gold-text">Row limit reached ({MAX_BUILDER_ROWS} conditions).</p>
              )}
            </div>
          )}

          {/* formula view (Component 3 — read-only, copy-friendly) */}
          {rows.length > 0 && formulaOpen && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Formula</span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{formulaText(rows)}</code>
                <button
                  type="button"
                  onClick={copyFormula}
                  className="flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-brand/40 hover:text-brand-text"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {rows.map((r, i) => (
                  <div key={r.id} className="flex gap-2 text-[11px] leading-relaxed">
                    <span className="w-5 shrink-0 text-right font-mono text-zinc-600">{i + 1}</span>
                    <code className="min-w-0 break-all font-mono text-zinc-400">{rowExprText(r)}</code>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-zinc-600">
                Numbers reference the condition rows. Edits happen in the builder above — this view always mirrors it.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* sector / sort / export row */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sector}
          onChange={(e) => {
            setSector(e.target.value);
            setBPage(1);
          }}
          className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
          aria-label="Sector filter"
        >
          <option value="all">All sectors</option>
          {sectors.filter(Boolean).map((s) => (
            <option key={s as string} value={s as string}>{s as string}</option>
          ))}
        </select>
        <select
          value={bSort}
          onChange={(e) => {
            setBSort(e.target.value);
            setBPage(1);
          }}
          className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
          aria-label="Sort results by"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>Sort: {s.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setBDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="rounded-full px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
        >
          {bDir === "desc" ? "↓ Descending" : "↑ Ascending"}
        </button>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-8 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
          onClick={() => {
            if (!bData || bData.stocks.length === 0) {
              toast({ title: "Nothing to export yet" });
              return;
            }
            exportCsv(
              `tradepulse-screen-${csvDate()}.csv`,
              ["Symbol", "Name", "Price", "Change %", "Volume", "Vol vs 20D avg", "RSI", "1M %", "3M %", "6M %", "P/E", "From 52W high %", "Market cap Cr", "Sector"],
              bData.stocks.map((r) => [
                r.symbol.replace(".NS", ""), r.name, r.price, r.changePct, r.volume,
                r.relVol != null ? Number(r.relVol.toFixed(2)) : null, r.rsi14,
                r.mom1M, r.mom3M, r.mom6M, r.peTTM, r.fromHighPct,
                r.marketCap != null ? Math.round(r.marketCap / 1e7) : null, r.sector,
              ])
            );
            toast({ title: "CSV exported" });
          }}
        >
          Export CSV
        </Button>
      </div>

      {/* results */}
      {applied ? (
        <>
          {bError && (
            <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
              {bError instanceof Error ? bError.message : "Screen failed — check the conditions."}
            </p>
          )}
          <ResultsTable rows={bData?.stocks} isLoading={bLoading} onSelectStock={onSelectStock} />
          {bData && bData.total > bData.perPage && (
            <Pager page={bPage} totalPages={totalPages(bData.total, bData.perPage)} onPage={setBPage} />
          )}
        </>
      ) : (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <SlidersHorizontal className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-500">Set your conditions and hit Apply to screen the universe.</p>
            {rows.length > 0 && complete && (
              <p className="text-[11px] text-zinc-600">
                The live counter above already previews the match count — Apply pins it to the results table.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
