"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bookmark, BookmarkPlus, ChevronDown, ChevronLeft, ChevronRight, FunctionSquare, Layers, Radar, Search, SlidersHorizontal, Star, Trash2, X,
} from "lucide-react";
import { AddToWatchlistButton } from "@/components/add-to-watchlist";
import { ExprEditor, CHEAT_SHEET } from "@/components/expr-editor";
import { toast } from "@/hooks/use-toast";
import { parseProExpr } from "@/lib/pro-expr";
import { changeColor, fmtMcap, fmtNum, fmtPct, fmtPrice, fmtVol } from "@/lib/format";
import { cn } from "@/lib/utils";

// ================================================================ types

interface StockRow {
  symbol: string; name: string; price: number | null; changePct: number | null;
  volume: number | null; marketCap: number | null; sector: string | null;
  rsi14: number | null; mom1M: number | null; mom3M: number | null; mom6M: number | null;
  peTTM: number | null; fromHighPct: number | null;
  volAvg20: number | null; relVol: number | null; // volume vs prior-20-session average (API-computed)
}

interface StocksResponse {
  total: number; page: number; perPage: number; condCount: number;
  stocks: StockRow[];
  sectors: (string | null)[];
}

interface ScanGroup {
  category: string;
  description: string;
  scans: { id: string; name: string; description: string; basic: boolean }[];
}

interface SavedScreen {
  id: string; name: string; kind: "conditions" | "multi" | "filters"; definition: string; createdAt: string;
}

interface MultiResponse {
  min: number; requested: number; total: number; scanned: number; truncated: boolean;
  scanSummaries: { id: string; name: string; total: number }[];
  rows: {
    symbol: string; name: string; price: number | null; changePct: number | null;
    marketCap: number | null; sector: string | null; rs: number | null;
    matches: number; scans: string[];
  }[];
}

// ================================================================ field catalog

type CondOp = "gt" | "gte" | "lt" | "lte" | "between";

interface CondRow {
  id: number;
  f: string; // field key (numeric), boolean field key, or the "ma" pseudo-field
  op: CondOp | "eq"; // eq = boolean test
  v: string;
  v2: string;
  bool: boolean;
  boolVal: boolean;
  logic: "and" | "or"; // how this row joins the PREVIOUS one (first row ignores it)
  maType?: "sma" | "ema"; // only for the "ma" pseudo-field (price vs moving average)
  len?: 20 | 50 | 100 | 200; // only for the "ma" pseudo-field
  tf?: "d" | "w"; // timeframe for the price/OHLC family — Daily candle or the current Weekly candle
}

/** Price/OHLC fields that support a per-row Daily/Weekly timeframe. */
const OHLC_FIELDS = new Set(["price", "open", "dayHigh", "dayLow"]);
/** Daily candle key → the matching current-week candle column. */
const WEEKLY_KEY: Record<string, string> = { price: "wClose", open: "wOpen", dayHigh: "wHigh", dayLow: "wLow" };
const WEEKLY_TO_DAILY: Record<string, string> = { wClose: "price", wOpen: "open", wHigh: "dayHigh", wLow: "dayLow" };

const NUM_FIELDS: { f: string; label: string; step: number; scale?: number }[] = [
  { f: "price", label: "Price / Close (₹)", step: 1 },
  { f: "open", label: "Open (₹)", step: 1 },
  { f: "dayHigh", label: "Day high (₹)", step: 1 },
  { f: "dayLow", label: "Day low (₹)", step: 1 },
  { f: "changePct", label: "Day change %", step: 0.5 },
  { f: "volume", label: "Volume (shares)", step: 100000 },
  { f: "avgVol3M", label: "Avg volume (3M)", step: 100000 },
  { f: "marketCap", label: "Market cap (₹ Cr)", step: 500, scale: 1e7 },
  { f: "peTTM", label: "P/E (TTM)", step: 1 },
  { f: "pbRatio", label: "P/B ratio", step: 0.5 },
  { f: "divYield", label: "Dividend yield %", step: 0.5 },
  { f: "rsi14", label: "RSI (14) · daily", step: 5 },
  { f: "wRsi14", label: "RSI (14) · weekly", step: 5 },
  { f: "macdHist", label: "MACD histogram · daily", step: 1 },
  { f: "wMacdHist", label: "MACD histogram · weekly", step: 1 },
  { f: "mom1M", label: "1M return %", step: 5 },
  { f: "mom3M", label: "3M return %", step: 5 },
  { f: "mom6M", label: "6M return %", step: 5 },
  { f: "fromHighPct", label: "% below 52W high (0 = at high)", step: 5 },
  { f: "fromLowPct", label: "% above 52W low", step: 10 },
  { f: "atr14Pct", label: "ATR % (volatility)", step: 1 },
  { f: "bbPctB", label: "Bollinger %B (0–100, 100 = upper band)", step: 10 },
  { f: "bbWidthPct", label: "Bollinger width % (squeeze = low)", step: 2 },
  { f: "distSma20Pct", label: "Price vs SMA 20 %", step: 2 },
  { f: "distSma50Pct", label: "Price vs SMA 50 %", step: 2 },
  { f: "distSma100Pct", label: "Price vs SMA 100 %", step: 2 },
  { f: "distSma200Pct", label: "Price vs SMA 200 %", step: 2 },
  { f: "distEma20Pct", label: "Price vs EMA 20 %", step: 2 },
  { f: "distEma50Pct", label: "Price vs EMA 50 %", step: 2 },
  { f: "distEma100Pct", label: "Price vs EMA 100 %", step: 2 },
  { f: "distEma200Pct", label: "Price vs EMA 200 %", step: 2 },
];

const BOOL_FIELDS: { f: string; label: string }[] = [
  { f: "aboveSma20", label: "Above 20 SMA" },
  { f: "aboveSma50", label: "Above 50 SMA" },
  { f: "aboveSma200", label: "Above 200 SMA" },
  { f: "goldenCross", label: "Golden cross (SMA 20 > 50)" },
  { f: "emaCross", label: "EMA cross up (EMA 20 > 50)" },
  { f: "volSpike", label: "Volume spike (> 2x avg)" },
];

const MA_LENGTHS = [20, 50, 100, 200] as const;
const maFieldKey = (t: "sma" | "ema", len: number) => `dist${t === "sma" ? "Sma" : "Ema"}${len}Pct`;

const OP_LABELS: { op: CondOp; label: string }[] = [
  { op: "gt", label: ">" },
  { op: "gte", label: "≥" },
  { op: "lt", label: "<" },
  { op: "lte", label: "≤" },
  { op: "between", label: "between" },
];

const fieldLabel = (f: string) =>
  f === "ma" ? "Price vs moving average" : [...NUM_FIELDS, ...BOOL_FIELDS].find((x) => x.f === f)?.label ?? f;

// ------------------------------------------------ pro logic rows (Chartink-style)

/** Hard cap across simple + pro rows (raised from 15 in Task 37). */
const MAX_COND_ROWS = 50;

type ExprCmp = "gt" | "gte" | "lt" | "lte" | "eq" | "between";

/** A pro-logic row: left expression 〈cmp〉 right expression (numbers are expressions too). */
interface ExprRow {
  id: number;
  kind: "expr";
  logic: "and" | "or"; // how this row joins the previous one
  cmp: ExprCmp;
  l: string;
  r: string;
  r2: string; // between only
}

type BuilderRow = CondRow | ExprRow;

const EXPR_CMPS: ExprCmp[] = ["gt", "gte", "lt", "lte", "eq", "between"];
const EXPR_CMP_LABELS: { op: ExprCmp; label: string }[] = [
  { op: "gt", label: ">" },
  { op: "gte", label: "≥" },
  { op: "lt", label: "<" },
  { op: "lte", label: "≤" },
  { op: "eq", label: "=" },
  { op: "between", label: "between" },
];
const exprCmpLabel = (c: ExprCmp) => EXPR_CMP_LABELS.find((x) => x.op === c)?.label ?? c;

const isExprRow = (r: BuilderRow): r is ExprRow => (r as { kind?: unknown }).kind === "expr";

// Built-in preset screens (loaded into the builder, editable afterwards).
type PresetRow = Omit<CondRow, "id"> | Omit<ExprRow, "id">;
const PRESETS: { name: string; rows: PresetRow[] }[] = [
  {
    name: "Momentum leaders",
    rows: [
      { f: "rsi14", op: "gt", v: "60", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "mom6M", op: "gt", v: "20", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "aboveSma200", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "and" },
      { f: "fromHighPct", op: "lte", v: "15", v2: "", bool: false, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Oversold bounce watch",
    rows: [
      { f: "rsi14", op: "lt", v: "40", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "mom1M", op: "lt", v: "-5", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "price", op: "gt", v: "50", v2: "", bool: false, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Volume accumulation",
    rows: [
      { f: "volSpike", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "and" },
      { f: "changePct", op: "gt", v: "1", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "marketCap", op: "between", v: "5000", v2: "200000", bool: false, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Near 52-week high",
    rows: [
      { f: "fromHighPct", op: "lte", v: "5", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "aboveSma50", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "and" },
      { f: "aboveSma200", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Value + quality",
    rows: [
      { f: "peTTM", op: "between", v: "4", v2: "25", bool: false, boolVal: true, logic: "and" },
      { f: "pbRatio", op: "lt", v: "5", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "mom6M", op: "gt", v: "10", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "divYield", op: "gt", v: "0.5", v2: "", bool: false, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Low-volatility uptrend",
    rows: [
      { f: "atr14Pct", op: "lt", v: "3", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "aboveSma200", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "and" },
      { f: "rsi14", op: "between", v: "55", v2: "75", bool: false, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Pullback to EMA 20 (OR daily oversold)",
    rows: [
      { f: "ma", op: "between", v: "-3", v2: "3", bool: false, boolVal: true, logic: "and", maType: "ema", len: 20 },
      { f: "aboveSma200", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "and" },
      { f: "wRsi14", op: "gt", v: "45", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "rsi14", op: "lt", v: "45", v2: "", bool: false, boolVal: true, logic: "or" },
    ],
  },
  {
    name: "Strong momentum OR fresh EMA cross",
    rows: [
      { f: "mom3M", op: "gte", v: "15", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "marketCap", op: "gte", v: "1000", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "emaCross", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "or" },
      { f: "aboveSma50", op: "eq", v: "", v2: "", bool: true, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Chartink · 66-day breakout (weekly calm)",
    rows: [
      { kind: "expr", cmp: "gte", l: "close / min(66, low)", r: "1.30", r2: "", logic: "and" },
      { f: "marketCap", op: "gt", v: "0", v2: "", bool: false, boolVal: true, logic: "and" },
      { f: "price", op: "gte", v: "1", v2: "", bool: false, boolVal: true, logic: "and" },
      { kind: "expr", cmp: "gt", l: "close * sma(volume, 20)", r: "30000000", r2: "", logic: "and" },
      { kind: "expr", cmp: "gt", l: "close", r: "sma(close, 200)", r2: "", logic: "and" },
      { kind: "expr", cmp: "lte", l: "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", r2: "", logic: "and" },
      { kind: "expr", cmp: "lte", l: "abs(2 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", r2: "", logic: "and" },
      { kind: "expr", cmp: "lte", l: "abs(3 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", r2: "", logic: "and" },
      { kind: "expr", cmp: "lt", l: "1 week ago close", r: "2 weeks ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "weekly high", r: "1 week ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "weekly high", r: "2 weeks ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "weekly high", r: "3 weeks ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "weekly high", r: "4 weeks ago high", r2: "", logic: "and" },
    ],
  },
  {
    name: "Weekly higher-highs streak",
    rows: [
      { kind: "expr", cmp: "gte", l: "weekly high", r: "1 week ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "weekly high", r: "2 weeks ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "weekly high", r: "3 weeks ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "weekly high", r: "4 weeks ago high", r2: "", logic: "and" },
      { kind: "expr", cmp: "gt", l: "weekly close", r: "sma(weekly close, 10)", r2: "", logic: "and" },
      { f: "marketCap", op: "gte", v: "1000", v2: "", bool: false, boolVal: true, logic: "and" },
    ],
  },
  {
    name: "Trend + tight weekly swings",
    rows: [
      { kind: "expr", cmp: "gt", l: "close", r: "sma(close, 50)", r2: "", logic: "and" },
      { kind: "expr", cmp: "gt", l: "sma(close, 50)", r: "sma(close, 200)", r2: "", logic: "and" },
      { kind: "expr", cmp: "lte", l: "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "4", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "close * sma(volume, 20)", r: "10000000", r2: "", logic: "and" },
      { kind: "expr", cmp: "gte", l: "marketCap", r: "10000000000", r2: "", logic: "and" },
    ],
  },
];

// ================================================================ csv export

function exportCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const csvDate = () => new Date().toISOString().slice(0, 10);

// ================================================================ pro gate

function ScreenerUpgradePanel({ onUpgrade }: { onUpgrade?: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15">
        <Radar className="h-6 w-6 text-brand-text" />
      </span>
      <h2 className="mt-4 text-lg font-bold tracking-tight text-zinc-50">The Screener is part of TradePulse Pro</h2>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-500">
        Screen all 3,551 NSE stocks with the multi-condition builder, run several scans together for
        confluence, save your screens and export the results.
      </p>
      <ul className="mx-auto mt-5 max-w-sm space-y-1.5 text-left text-xs text-zinc-400">
        {[
          "Full-universe filters — search, sector, sort & paginate",
          "Condition builder — up to 50 filters with Chartink-style pro logic: sma / min / max, candles-ago & weeks-ago offsets, daily + weekly series in one screen",
          "Multi-scan confluence — run scans together, see which stocks fire in several",
          "Saved screens — store and re-run your setups in one click",
          "CSV export for every result table",
        ].map((t) => (
          <li key={t} className="flex items-start gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            {t}
          </li>
        ))}
      </ul>
      <Button onClick={onUpgrade} className="mt-6 bg-brand text-white hover:bg-brand-hover">
        Upgrade to Pro
      </Button>
    </div>
  );
}

// ================================================================ main

const SORTS = [
  { id: "marketCap", label: "Market cap" },
  { id: "changePct", label: "Day change" },
  { id: "rsi14", label: "RSI (14)" },
  { id: "mom1M", label: "1M return" },
  { id: "mom3M", label: "3M return" },
  { id: "mom6M", label: "6M return" },
  { id: "peTTM", label: "P/E" },
  { id: "fromHighPct", label: "From 52W high" },
];

/** Editor row → wire format. The "ma" pseudo-field resolves to its concrete distance column.
 *  Fields declared with a display scale (market cap ₹ Cr → INR) are scaled on the way out. */
const toPayload = (r: BuilderRow) => {
  const logic = r.logic === "or" ? { logic: "or" } : {};
  if (isExprRow(r)) {
    return { kind: "expr", cmp: r.cmp, l: r.l, r: r.r, r2: r.r2, ...logic };
  }
  if (r.bool) return { f: r.f, op: "eq", v: r.boolVal, ...logic };
  const scale = r.f === "ma" ? 1 : NUM_FIELDS.find((x) => x.f === r.f)?.scale ?? 1;
  const num = (raw: string) => (Number.isFinite(Number(raw)) ? Number(raw) * scale : raw);
  if (r.f === "ma") return { f: maFieldKey(r.maType ?? "sma", r.len ?? 50), op: r.op, v: num(r.v), v2: num(r.v2), ...logic };
  // Weekly timeframe on the price/OHLC family swaps in the current-week candle column
  const f = r.tf === "w" && OHLC_FIELDS.has(r.f) ? WEEKLY_KEY[r.f] : r.f;
  return { f, op: r.op, v: num(r.v), v2: num(r.v2), ...logic };
};

let condSeq = 1;
const newCondRow = (): CondRow => ({ id: condSeq++, f: "price", op: "gt", v: "", v2: "", bool: false, boolVal: true, logic: "and", tf: "d" });
const newExprRow = (): ExprRow => ({ id: condSeq++, kind: "expr", logic: "and", cmp: "gte", l: "", r: "", r2: "" });

export function ScreenerTab({
  onSelectStock,
  isPro,
  onUpgrade,
}: {
  onSelectStock: (s: string) => void;
  isPro: boolean;
  onUpgrade?: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"filters" | "builder" | "multi">("filters");

  // ------------------------------------------------------------ saved screens
  const [savedOpen, setSavedOpen] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!savedOpen) return;
    const onDoc = (e: MouseEvent) => { if (savedRef.current && !savedRef.current.contains(e.target as Node)) setSavedOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSavedOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [savedOpen]);

  const { data: saved } = useQuery<SavedScreen[]>({
    queryKey: ["screens"],
    queryFn: async () => {
      const res = await fetch("/api/screens");
      if (!res.ok) throw new Error("screens failed");
      const data = await res.json();
      return data.screens as SavedScreen[];
    },
    enabled: isPro,
  });

  // ------------------------------------------------------------ filters mode
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState("marketCap");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery<StocksResponse>({
    queryKey: ["screener", debouncedQ, sector, sort, dir, page],
    queryFn: async () => {
      const params = new URLSearchParams({ q: debouncedQ, sector, sort, dir, page: String(page), perPage: "25" });
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) throw new Error("screener failed");
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: isPro,
  });

  // ------------------------------------------------------------ builder mode
  const [condRows, setCondRows] = useState<BuilderRow[]>([newCondRow()]);
  const [appliedCond, setAppliedCond] = useState<BuilderRow[] | null>(null);
  const [bSort, setBSort] = useState("marketCap");
  const [bDir, setBDir] = useState<"asc" | "desc">("desc");
  const [bPage, setBPage] = useState(1);
  // ƒx cheat sheet + caret-targeted insertion into the last-focused expression input
  const [cheatOpen, setCheatOpen] = useState(false);
  const exprInputRefs = useRef(new Map<string, HTMLInputElement>());
  const lastExprFocus = useRef<string | null>(null);

  const registerExprInput = (key: string, el: HTMLInputElement | null) => {
    if (el) exprInputRefs.current.set(key, el);
    else exprInputRefs.current.delete(key);
  };

  /** Insert a cheat-sheet token at the caret of the last-focused expression input. */
  const insertToken = (code: string) => {
    const key = lastExprFocus.current;
    if (!key) {
      toast({ title: "Click into a pro-logic expression first", description: "Then use the cheat sheet to insert snippets." });
      return;
    }
    const [rowIdStr, side] = key.split(":");
    const row = condRows.find((r) => r.id === Number(rowIdStr));
    if (!row || !isExprRow(row)) return;
    const cur = side === "l" ? row.l : side === "r" ? row.r : row.r2;
    const el = exprInputRefs.current.get(key);
    const pos = el?.selectionStart ?? cur.length;
    const glue = cur.length > 0 && !cur.endsWith(" ") && pos > 0 && !/[(\s]$/.test(code) ? " " : "";
    const next = cur.slice(0, pos) + (pos > 0 && !cur.slice(0, pos).endsWith(" ") ? glue : "") + code + cur.slice(pos);
    patchRow(row.id, side === "l" ? { l: next } : side === "r" ? { r: next } : { r2: next });
    const caret = pos + code.length + (pos > 0 ? glue.length : 0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const condJson = useMemo(
    () => (appliedCond ? JSON.stringify(appliedCond.map(toPayload)) : null),
    [appliedCond]
  );

  const { data: bData, isLoading: bLoading, error: bError } = useQuery<StocksResponse>({
    queryKey: ["screenerAdv", condJson, sector, bSort, bDir, bPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        cond: condJson ?? "[]", sector, sort: bSort, dir: bDir, page: String(bPage), perPage: "25",
      });
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) throw new Error("screener failed");
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: isPro && mode === "builder" && condJson !== null,
  });

  const validateRows = (rows: BuilderRow[]): boolean => {
    for (const r of rows) {
      if (isExprRow(r)) {
        const sides: [string, string][] = [
          ["left expression", r.l],
          ["right expression", r.r],
          ...(r.cmp === "between" ? ([["second right expression", r.r2]] as [string, string][]) : []),
        ];
        for (const [what, src] of sides) {
          if (!src.trim()) {
            toast({ title: "Check your conditions", description: `A pro-logic row is missing its ${what}.`, variant: "destructive" });
            return false;
          }
          const parsed = parseProExpr(src);
          if (!parsed.ok) {
            toast({ title: "Check your conditions", description: parsed.error, variant: "destructive" });
            return false;
          }
        }
        continue;
      }
      if (r.bool) continue;
      if (!Number.isFinite(Number(r.v))) {
        toast({ title: "Check your conditions", description: `"${fieldLabel(r.f)}" needs a number.`, variant: "destructive" });
        return false;
      }
      if (r.op === "between" && !Number.isFinite(Number(r.v2))) {
        toast({ title: "Check your conditions", description: `"${fieldLabel(r.f)}" between needs two numbers.`, variant: "destructive" });
        return false;
      }
    }
    return true;
  };

  const applyConditions = () => {
    if (condRows.length === 0) {
      toast({ title: "Add at least one condition" });
      return;
    }
    if (!validateRows(condRows)) return;
    setAppliedCond([...condRows]);
    setBPage(1);
  };

  const resetConditions = () => {
    setCondRows([newCondRow()]);
    setAppliedCond(null);
    setBPage(1);
    setCheatOpen(false);
  };

  const patchRow = (id: number, patch: Partial<CondRow> | Partial<ExprRow>) =>
    setCondRows((rows) => rows.map((r) => (r.id === id ? ({ ...r, ...patch } as BuilderRow) : r)));

  const switchField = (row: CondRow, f: string) => {
    if (f === "ma") {
      patchRow(row.id, { f, bool: false, maType: row.maType ?? "sma", len: row.len ?? 50 });
      return;
    }
    const isBool = BOOL_FIELDS.some((b) => b.f === f);
    patchRow(row.id, isBool ? { f, bool: true, op: "eq" } : { f, bool: false });
  };

  // ------------------------------------------------------------ multi mode
  const [catalog, setCatalog] = useState<ScanGroup[] | null>(null);
  const [sel, setSel] = useState<string[]>(["trader-choice-6", "momentum-scanner", "w52-high"]);
  const [minMatch, setMinMatch] = useState(2);
  const [multi, setMulti] = useState<MultiResponse | null>(null);
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiError, setMultiError] = useState<string | null>(null);

  useEffect(() => {
    if (catalog) return;
    let alive = true;
    fetch("/api/scanners")
      .then((res) => res.json())
      .then((data) => { if (alive) setCatalog(data.groups as ScanGroup[]); })
      .catch(() => { /* catalog stays null */ });
    return () => { alive = false; };
  }, [catalog]);

  const runMulti = async (ids: string[] = sel, min: number = minMatch) => {
    if (ids.length < 2) {
      toast({ title: "Pick at least 2 scans to combine" });
      return;
    }
    setMultiLoading(true);
    setMultiError(null);
    try {
      const res = await fetch("/api/scanners/multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, min }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.upgrade && onUpgrade) onUpgrade();
        throw new Error(data?.error ?? "Multi-scan failed");
      }
      setMulti(data as MultiResponse);
    } catch (e) {
      setMulti(null);
      setMultiError(e instanceof Error ? e.message : "Multi-scan failed");
    } finally {
      setMultiLoading(false);
    }
  };

  const toggleScan = (id: string) => {
    const next = sel.includes(id)
      ? sel.filter((x) => x !== id)
      : sel.length >= 8 ? sel : [...sel, id];
    if (next !== sel) {
      setSel(next);
      setMinMatch((m) => Math.min(m, Math.max(2, next.length)));
    }
  };

  // ------------------------------------------------------------ save / load
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveAnchor, setSaveAnchor] = useState<"header" | "bar">("header");
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  /** Open the name-and-save editor anchored next to the controls that define the view. */
  const openSave = (anchor: "header" | "bar") => {
    setSaveAnchor(anchor);
    setSaveOpen(true);
  };

  const saveScreen = async () => {
    const name = saveName.trim();
    if (!name) {
      toast({ title: "Give the view a name first" });
      return;
    }
    // Every mode is saveable: quick filters snapshot search/sector/sort/direction,
    // the builder snapshots its condition rows, multi snapshots the scan set.
    const kind = mode === "multi" ? "multi" : mode === "builder" ? "conditions" : "filters";
    const definition =
      kind === "multi"
        ? { ids: sel, min: minMatch }
        : kind === "conditions"
          ? { rows: (appliedCond ?? condRows).map(toPayload) }
          : { q, sector, sort, dir };
    setSaving(true);
    try {
      const res = await fetch("/api/screens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, definition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      await qc.invalidateQueries({ queryKey: ["screens"] });
      toast({ title: "Screen saved", description: `“${name}” is in your Saved screens.` });
      setSaveName("");
      setSaveOpen(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteScreen = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/screens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await qc.invalidateQueries({ queryKey: ["screens"] });
      toast({ title: "Deleted", description: `“${name}” removed.` });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const loadScreen = (s: SavedScreen) => {
    try {
      const def = JSON.parse(s.definition) as {
        rows?: {
          f?: string; op?: string; v?: unknown; v2?: unknown; logic?: unknown;
          kind?: unknown; cmp?: unknown; l?: unknown; r?: unknown; r2?: unknown;
        }[];
        ids?: string[];
        min?: number;
        q?: unknown; sector?: unknown; sort?: unknown; dir?: unknown;
      };
      if (s.kind === "conditions" && Array.isArray(def.rows)) {
        // Payload rows are the wire format — {f, op, v, v2, logic?} for simple
        // rows and {kind:"expr", cmp, l, r, r2, logic?} for pro-logic rows.
        // Rebuild the editor state, restoring the boolean flag for signal-flag
        // fields, the pro expressions and the AND/OR connector.
        const toEditorRow = (raw: {
          f?: string; op?: string; v?: unknown; v2?: unknown; logic?: unknown;
          kind?: unknown; cmp?: unknown; l?: unknown; r?: unknown; r2?: unknown;
        }): BuilderRow => {
          if (raw.kind === "expr") {
            return {
              id: condSeq++,
              kind: "expr",
              logic: raw.logic === "or" ? "or" : "and",
              cmp: EXPR_CMPS.includes(raw.cmp as ExprCmp) ? (raw.cmp as ExprCmp) : "gte",
              l: typeof raw.l === "string" ? raw.l : "",
              r: typeof raw.r === "string" ? raw.r : "",
              r2: typeof raw.r2 === "string" ? raw.r2 : "",
            };
          }
          const isBool = raw.op === "eq" && BOOL_FIELDS.some((b) => b.f === raw.f);
          // weekly OHLC wire keys fold back onto their daily field with tf="w"
          const dailyF = raw.f != null && WEEKLY_TO_DAILY[raw.f] ? WEEKLY_TO_DAILY[raw.f] : raw.f;
          // undo the display scale (market cap is stored in INR, edited in ₹ Cr)
          const scale = NUM_FIELDS.find((x) => x.f === dailyF)?.scale ?? 1;
          const unscale = (val: unknown) => {
            const n = Number(val);
            return Number.isFinite(n) && scale !== 1 ? String(n / scale) : val != null ? String(val) : "";
          };
          return {
            id: condSeq++,
            f: dailyF ?? "price",
            op: isBool ? "eq" : (raw.op as CondOp) ?? "gt",
            v: isBool ? "" : unscale(raw.v),
            v2: raw.v2 != null ? unscale(raw.v2) : "",
            bool: isBool,
            boolVal: raw.v === true || raw.v === "true",
            logic: raw.logic === "or" ? "or" : "and",
            tf: raw.f != null && WEEKLY_TO_DAILY[raw.f] ? "w" : "d",
          };
        };
        const restored = def.rows.map(toEditorRow);
        setCondRows(restored);
        // Same array — re-mapping editor rows through toEditorRow would corrupt
        // the boolean rows (their v is "" by design).
        setAppliedCond(restored);
        setBPage(1);
        setMode("builder");
      } else if (s.kind === "multi" && Array.isArray(def.ids)) {
        setSel(def.ids.slice(0, 8));
        setMinMatch(Math.max(2, def.min ?? 2));
        setMode("multi");
        void runMulti(def.ids.slice(0, 8), Math.max(2, def.min ?? 2));
      } else if (s.kind === "filters") {
        // Quick-filter view: restore search text, sector, sort chip and direction.
        const knownSort = SORTS.some((x) => x.id === def.sort);
        setQ(typeof def.q === "string" ? def.q : "");
        setSector(typeof def.sector === "string" && def.sector ? def.sector : "all");
        setSort(knownSort ? (def.sort as string) : "marketCap");
        setDir(def.dir === "asc" ? "asc" : "desc");
        setPage(1);
        setMode("filters");
      }
      setSavedOpen(false);
    } catch {
      toast({ title: "Could not load that screen", variant: "destructive" });
    }
  };

  // ------------------------------------------------------------ render helpers
  const totalPages = (total: number, perPage: number) => Math.max(1, Math.ceil(total / perPage));
  const setSortAndDir = (id: string, cur: string, setS: (v: string) => void, setD: (v: "asc" | "desc") => void, curD: "asc" | "desc") => {
    if (id === cur) setD(curD === "desc" ? "asc" : "desc");
    else { setS(id); setD("desc"); }
  };

  /** Name-and-save editor — rendered at whichever anchor triggered it. */
  const saveEditor = (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={saveName}
        onChange={(e) => setSaveName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void saveScreen()}
        placeholder="View name…"
        aria-label="View name"
        className="h-8 w-40 border-zinc-700 bg-zinc-900 text-xs text-zinc-100"
      />
      <Button size="sm" disabled={saving} onClick={() => void saveScreen()} className="h-8 bg-brand px-2.5 text-xs text-white hover:bg-brand-hover">
        Save
      </Button>
      <button onClick={() => setSaveOpen(false)} aria-label="Cancel save" className="rounded p-1 text-zinc-500 hover:text-zinc-300">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (!isPro) return <ScreenerUpgradePanel onUpgrade={onUpgrade} />;

  const activeCount = data?.total ?? 0;
  const headerCount =
    mode === "filters" ? (data ? `${activeCount.toLocaleString("en-IN")} matches` : "Screener")
    : mode === "builder" ? (appliedCond ? (bData ? `${bData.total.toLocaleString("en-IN")} matches` : "Screening…") : "Condition builder")
    : (multi ? `${multi.total.toLocaleString("en-IN")} confluence matches` : "Multi-scan confluence");

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Screener · all 3,551 NSE stocks</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">{headerCount}</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* saved screens dropdown */}
          <div ref={savedRef} className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSavedOpen((v) => !v)}
              className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <Bookmark className="h-3.5 w-3.5 text-emerald-400" /> Saved
              <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform", savedOpen && "rotate-180")} />
            </Button>
            {savedOpen && (
              <div className="absolute right-0 top-9 z-30 w-72 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
                {(saved ?? []).length === 0 ? (
                  <p className="px-3 py-4 text-center text-[11px] text-zinc-500">
                    No saved views yet — set up quick filters, conditions or scans, then hit Save view.
                  </p>
                ) : (
                  (saved ?? []).map((s) => (
                    <div key={s.id} className="flex items-center gap-2 border-b border-zinc-800/60 px-3 py-2 last:border-0 hover:bg-zinc-800/50">
                      <button onClick={() => loadScreen(s)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-xs font-medium text-zinc-100">{s.name}</span>
                        <span className="block text-[10px] text-zinc-500">
                          {s.kind === "multi" ? "Multi-scan set" : s.kind === "filters" ? "Quick-filter view" : "Condition screen"}
                        </span>
                      </button>
                      <button
                        onClick={() => void deleteScreen(s.id, s.name)}
                        aria-label={`Delete ${s.name}`}
                        className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-loss"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          {/* export */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              if (mode === "multi" && multi) {
                exportCsv(
                  `tradepulse-multiscan-${csvDate()}.csv`,
                  ["Symbol", "Name", "Price", "Change %", "Matches", "Scans", "RS", "Market cap Cr"],
                  multi.rows.map((r) => [
                    r.symbol.replace(".NS", ""), r.name, r.price, r.changePct, `${r.matches}/${multi.requested}`,
                    r.scans.join(" | "), r.rs, r.marketCap != null ? Math.round(r.marketCap / 1e7) : null,
                  ])
                );
              } else {
                const src = mode === "builder" ? bData : data;
                if (!src || src.stocks.length === 0) {
                  toast({ title: "Nothing to export yet" });
                  return;
                }
                exportCsv(
                  `tradepulse-screener-${csvDate()}.csv`,
                  ["Symbol", "Name", "Price", "Change %", "Volume", "Vol vs 20D avg", "RSI", "1M %", "3M %", "6M %", "P/E", "From 52W high %", "Market cap Cr", "Sector"],
                  src.stocks.map((r) => [
                    r.symbol.replace(".NS", ""), r.name, r.price, r.changePct, r.volume,
                    r.relVol != null ? Number(r.relVol.toFixed(2)) : null, r.rsi14,
                    r.mom1M, r.mom3M, r.mom6M, r.peTTM, r.fromHighPct,
                    r.marketCap != null ? Math.round(r.marketCap / 1e7) : null, r.sector,
                  ])
                );
              }
              toast({ title: "CSV exported" });
            }}
          >
            Export CSV
          </Button>
          {/* save current view — quick filters anchor to the filter bar; builder & multi anchor here */}
          {(mode === "builder" || mode === "multi") && (
            saveOpen && saveAnchor === "header" ? (
              saveEditor
            ) : (
              <Button
                size="sm"
                onClick={() => openSave("header")}
                title="Save this screen — conditions or scan set — under a name to re-run it any day"
                className="h-8 gap-1.5 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover"
              >
                <BookmarkPlus className="h-3.5 w-3.5" /> Save view
              </Button>
            )
          )}
        </div>
      </div>

      {/* mode switcher */}
      <div className="flex w-fit items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1">
        {([
          { id: "filters", label: "Quick filters", icon: Search },
          { id: "builder", label: "Condition builder", icon: SlidersHorizontal },
          { id: "multi", label: "Multi-scan", icon: Layers },
        ] as const).map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === m.id ? "bg-brand/15 text-brand-text" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            <m.icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ filters mode */}
      {mode === "filters" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search symbol or company…"
                className="h-9 w-56 border-zinc-800 bg-zinc-900 pl-8 text-xs text-zinc-100"
              />
            </div>
            <select
              value={sector}
              onChange={(e) => { setSector(e.target.value); setPage(1); }}
              className="h-9 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
              aria-label="Sector filter"
            >
              <option value="all">All sectors</option>
              {(data?.sectors ?? []).filter(Boolean).map((s) => (
                <option key={s as string} value={s as string}>{s as string}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-1.5">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSortAndDir(s.id, sort, setSort, setDir, dir); setPage(1); }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                    sort === s.id ? "bg-brand/15 text-brand-text" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {s.label}{sort === s.id && (dir === "desc" ? " ↓" : " ↑")}
                </button>
              ))}
            </div>
            {/* "Save this view" CTA — sits right on the filter bar so saving the current
                filter combination as a named preset is obvious and one click away */}
            {saveOpen && saveAnchor === "bar" ? (
              saveEditor
            ) : (
              <Button
                size="sm"
                onClick={() => openSave("bar")}
                title="Save this filter combination (search, sector, sort) under a name to reuse tomorrow"
                className="h-8 gap-1.5 bg-brand px-2.5 text-xs font-medium text-white hover:bg-brand-hover"
              >
                <BookmarkPlus className="h-3.5 w-3.5" /> Save view
              </Button>
            )}
          </div>

          <ResultsTable rows={data?.stocks} isLoading={isLoading} onSelectStock={onSelectStock} />

          {data && data.total > data.perPage && (
            <Pager page={page} totalPages={totalPages(data.total, data.perPage)} onPage={setPage} />
          )}
        </>
      )}

      {/* ------------------------------------------------ builder mode */}
      {mode === "builder" && (
        <>
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="space-y-2.5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-zinc-500">
                  Stack up to 50 conditions — mix simple filters with pro-logic rows. Pro rows accept Chartink-style
                  expressions: <code className="font-mono text-zinc-400">close / min(66, low)</code>,{" "}
                  <code className="font-mono text-zinc-400">sma(volume, 20)</code>,{" "}
                  <code className="font-mono text-zinc-400">1 week ago high</code>,{" "}
                  <code className="font-mono text-zinc-400">weekly close</code>… OR starts an alternative branch
                  (A AND B OR C = (A∧B) ∨ C).
                </span>
                <select
                  value=""
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.name === e.target.value);
                    if (p) {
                      setCondRows(p.rows.map((r) => ({ ...r, id: condSeq++ }) as BuilderRow));
                      toast({ title: `Preset loaded — “${p.name}”`, description: "Tweak the rows, then Apply." });
                    }
                  }}
                  className="ml-auto h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-300"
                  aria-label="Load a preset screen"
                >
                  <option value="">Load preset…</option>
                  {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                <Button
                  size="sm"
                  onClick={() => setCheatOpen((v) => !v)}
                  title="Expression cheat sheet — fields, functions, offsets; click any snippet to insert it at the caret"
                  variant="outline"
                  className={cn(
                    "h-8 gap-1.5 border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-200 hover:bg-zinc-800",
                    cheatOpen && "border-brand/50 bg-brand/10 text-brand-text"
                  )}
                >
                  <FunctionSquare className="h-3.5 w-3.5" /> ƒx
                </Button>
                <Button
                  size="sm"
                  onClick={() => setCondRows((rows) => (rows.length >= MAX_COND_ROWS ? rows : [...rows, newCondRow()]))}
                  disabled={condRows.length >= MAX_COND_ROWS}
                  variant="outline"
                  className="h-8 border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  + Add condition
                </Button>
                <Button
                  size="sm"
                  onClick={() => setCondRows((rows) => (rows.length >= MAX_COND_ROWS ? rows : [...rows, newExprRow()]))}
                  disabled={condRows.length >= MAX_COND_ROWS}
                  variant="outline"
                  title="Add a pro-logic row — a full expression on each side of the comparison"
                  className="h-8 border-brand/40 bg-brand/10 px-2.5 text-xs font-medium text-brand-text hover:bg-brand/20"
                >
                  <FunctionSquare className="h-3.5 w-3.5" /> + Pro logic
                </Button>
                <Button size="sm" onClick={applyConditions} className="h-8 bg-brand px-3 text-xs text-white hover:bg-brand-hover">
                  Apply
                </Button>
                <Button
                  size="sm"
                  onClick={resetConditions}
                  variant="ghost"
                  className="h-8 px-2.5 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Reset
                </Button>
              </div>

              {cheatOpen && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Expression cheat sheet — click to insert at the caret</span>
                    <button onClick={() => setCheatOpen(false)} aria-label="Close cheat sheet" className="rounded p-0.5 text-zinc-600 hover:text-zinc-300">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {CHEAT_SHEET.map((g) => (
                      <div key={g.group}>
                        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{g.group}</div>
                        <div className="mt-1 space-y-1">
                          {g.items.map((it) => (
                            <button
                              key={it.code}
                              onClick={() => insertToken(it.code)}
                              title={it.note}
                              className="block w-full truncate rounded border border-zinc-800/80 bg-zinc-900/80 px-1.5 py-1 text-left font-mono text-[10px] text-zinc-300 transition-colors hover:border-brand/40 hover:text-brand-text"
                            >
                              {it.code}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                    Offsets: <code className="font-mono">N candles ago</code> walks daily bars back · <code className="font-mono">N weeks ago</code> walks weekly candles back —
                    inside “N weeks ago ( … )” a “candle” counts weekly bars. <code className="font-mono">daily</code>/<code className="font-mono">weekly</code> prefixes reset the offset.
                    Stocks without enough bar history for a lookback simply won’t match. Pro screens run on the EOD database — adding a market-cap or price row speeds them up.
                  </p>
                </div>
              )}

              {condRows.map((row, idx) => (
                <div key={row.id} className="flex flex-wrap items-center gap-1.5">
                  {/* connector — how this row joins the previous one (first row has none) */}
                  {idx > 0 && (
                    <select
                      value={row.logic}
                      onChange={(e) => patchRow(row.id, { logic: e.target.value as "and" | "or" })}
                      className={cn(
                        "h-8 w-[4.5rem] rounded-md border px-1.5 text-[11px] font-semibold",
                        row.logic === "or"
                          ? "border-gold/50 bg-gold/10 text-gold-text"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300"
                      )}
                      aria-label="Condition connector"
                      title={row.logic === "and" ? "Must also match (AND)" : "Alternative branch (OR) — matches if this branch matches, even when earlier ones fail"}
                    >
                      <option value="and">AND</option>
                      <option value="or">OR</option>
                    </select>
                  )}
                  {isExprRow(row) ? (
                    <>
                      <ExprEditor
                        value={row.l}
                        onChange={(v) => patchRow(row.id, { l: v })}
                        placeholder="expression — e.g. close / min(66, low)"
                        ariaLabel="Left expression"
                        inputKey={`${row.id}:l`}
                        registerInput={registerExprInput}
                        onFocusKey={(k) => { lastExprFocus.current = k; }}
                      />
                      <select
                        value={row.cmp}
                        onChange={(e) => patchRow(row.id, { cmp: e.target.value as ExprCmp })}
                        className="h-8 w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                        aria-label="Comparison operator"
                      >
                        {EXPR_CMP_LABELS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                      </select>
                      <ExprEditor
                        value={row.r}
                        onChange={(v) => patchRow(row.id, { r: v })}
                        placeholder="value or expression"
                        ariaLabel="Right expression"
                        inputKey={`${row.id}:r`}
                        registerInput={registerExprInput}
                        onFocusKey={(k) => { lastExprFocus.current = k; }}
                      />
                      {row.cmp === "between" && (
                        <>
                          <span className="text-[11px] text-zinc-500">and</span>
                          <ExprEditor
                            value={row.r2}
                            onChange={(v) => patchRow(row.id, { r2: v })}
                            placeholder="value or expression"
                            ariaLabel="Second right expression"
                            inputKey={`${row.id}:r2`}
                            registerInput={registerExprInput}
                            onFocusKey={(k) => { lastExprFocus.current = k; }}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <>
                  <select
                    value={row.f}
                    onChange={(e) => switchField(row, e.target.value)}
                    className="h-8 min-w-44 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                    aria-label="Condition field"
                  >
                    <optgroup label="Price & valuation">
                      {NUM_FIELDS.slice(0, 11).map((f) => <option key={f.f} value={f.f}>{f.label}</option>)}
                    </optgroup>
                    <optgroup label="Momentum & technicals (daily / weekly)">
                      {NUM_FIELDS.slice(11, 21).map((f) => <option key={f.f} value={f.f}>{f.label}</option>)}
                    </optgroup>
                    <optgroup label="Bollinger Bands (20, 2σ)">
                      {NUM_FIELDS.slice(21, 23).map((f) => <option key={f.f} value={f.f}>{f.label}</option>)}
                    </optgroup>
                    <optgroup label="Price vs moving average (SMA / EMA)">
                      <option value="ma">Custom MA — pick type & length</option>
                      {NUM_FIELDS.slice(23).map((f) => <option key={f.f} value={f.f}>{f.label}</option>)}
                    </optgroup>
                    <optgroup label="Signal flags">
                      {BOOL_FIELDS.map((f) => <option key={f.f} value={f.f}>{f.label}</option>)}
                    </optgroup>
                  </select>
                  {OHLC_FIELDS.has(row.f) && (
                    <select
                      value={row.tf ?? "d"}
                      onChange={(e) => patchRow(row.id, { tf: e.target.value as "d" | "w" })}
                      className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-xs text-zinc-200"
                      aria-label="Timeframe"
                      title="Timeframe of this price/OHLC condition — the daily candle or the current week's candle"
                    >
                      <option value="d">Daily</option>
                      <option value="w">Weekly</option>
                    </select>
                  )}
                  {row.f === "ma" && (
                    <span className="flex items-center gap-1.5">
                      <select
                        value={row.maType ?? "sma"}
                        onChange={(e) => patchRow(row.id, { maType: e.target.value as "sma" | "ema" })}
                        className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                        aria-label="Moving average type"
                      >
                        <option value="sma">SMA</option>
                        <option value="ema">EMA</option>
                      </select>
                      <select
                        value={row.len ?? 50}
                        onChange={(e) => patchRow(row.id, { len: Number(e.target.value) as CondRow["len"] })}
                        className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                        aria-label="Moving average length"
                      >
                        {MA_LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </span>
                  )}
                  {row.bool ? (
                    <>
                      <span className="text-[11px] text-zinc-500">is</span>
                      <select
                        value={row.boolVal ? "true" : "false"}
                        onChange={(e) => patchRow(row.id, { boolVal: e.target.value === "true" })}
                        className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                        aria-label="Flag value"
                      >
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <select
                        value={row.op}
                        onChange={(e) => patchRow(row.id, { op: e.target.value as CondOp })}
                        className="h-8 w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                        aria-label="Operator"
                      >
                        {OP_LABELS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                      </select>
                      <Input
                        type="number"
                        value={row.v}
                        onChange={(e) => patchRow(row.id, { v: e.target.value })}
                        className="h-8 w-28 border-zinc-700 bg-zinc-900 text-xs text-zinc-100"
                        aria-label="Value"
                      />
                      {row.op === "between" && (
                        <>
                          <span className="text-[11px] text-zinc-500">and</span>
                          <Input
                            type="number"
                            value={row.v2}
                            onChange={(e) => patchRow(row.id, { v2: e.target.value })}
                            className="h-8 w-28 border-zinc-700 bg-zinc-900 text-xs text-zinc-100"
                            aria-label="Second value"
                          />
                        </>
                      )}
                    </>
                  )}
                    </>
                  )}
                  <button
                    onClick={() => setCondRows((rows) => rows.filter((r) => r.id !== row.id))}
                    aria-label="Remove condition"
                    className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-loss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {appliedCond && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/70 pt-2">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600">Applied:</span>
                  {appliedCond.map((r, i) => (
                    <span
                      key={r.id}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px]",
                        i > 0 && r.logic === "or" ? "bg-gold/10 text-gold-text" : "bg-brand/10 text-brand-text"
                      )}
                    >
                      {i > 0 && <b className="mr-1 font-semibold">{r.logic === "or" ? "OR" : "AND"}</b>}
                      {isExprRow(r) ? (
                        <span className="font-mono">
                          {`${r.l} ${exprCmpLabel(r.cmp)} ${r.r}${r.cmp === "between" ? ` and ${r.r2}` : ""}`}
                        </span>
                      ) : (
                        <>
                          {r.f === "ma"
                            ? `Price vs ${(r.maType ?? "sma").toUpperCase()} ${r.len ?? 50}`
                            : fieldLabel(r.f)}
                          {r.bool
                            ? ` is ${r.boolVal ? "true" : "false"}`
                            : ` ${OP_LABELS.find((o) => o.op === r.op)?.label ?? ""} ${r.v}${r.op === "between" ? ` and ${r.v2}` : ""}`}
                        </>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sector}
              onChange={(e) => { setSector(e.target.value); setBPage(1); }}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
              aria-label="Sector filter"
            >
              <option value="all">All sectors</option>
              {(data?.sectors ?? []).filter(Boolean).map((s) => (
                <option key={s as string} value={s as string}>{s as string}</option>
              ))}
            </select>
            <select
              value={bSort}
              onChange={(e) => { setBSort(e.target.value); setBPage(1); }}
              className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
              aria-label="Sort results by"
            >
              {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
            </select>
            <button
              onClick={() => setBDir((d) => (d === "desc" ? "asc" : "desc"))}
              className="rounded-full px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
            >
              {bDir === "desc" ? "↓ Descending" : "↑ Ascending"}
            </button>
          </div>

          {appliedCond ? (
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
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ------------------------------------------------ multi-scan mode */}
      {mode === "multi" && (
        <>
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-zinc-500">
                  Run up to 8 scans together — a stock is listed when it fires in at least the minimum number of them.
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    Min matches
                    <select
                      value={minMatch}
                      onChange={(e) => setMinMatch(Number(e.target.value))}
                      className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
                      aria-label="Minimum matches"
                    >
                      {Array.from({ length: Math.max(1, sel.length) }, (_, i) => i + 2 <= Math.max(2, sel.length) ? i + 2 : null)
                        .filter((v): v is number => v != null && v <= Math.max(2, sel.length))
                        .map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <Button
                    size="sm"
                    onClick={() => void runMulti()}
                    disabled={multiLoading}
                    className="h-8 gap-1.5 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    {multiLoading ? "Running…" : `Run ${sel.length} scans`}
                  </Button>
                </div>
              </div>

              {catalog === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 bg-zinc-800/70" />)}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {catalog.map((g) => (
                    <div key={g.category}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{g.category}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {g.scans.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => toggleScan(s.id)}
                            title={s.description}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                              sel.includes(s.id)
                                ? "border-brand/50 bg-brand/15 text-brand-text"
                                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                            )}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {multiError && <p className="text-xs text-loss">{multiError}</p>}

              {multi && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800/70 pt-2 text-[11px] text-zinc-500">
                  <span className="font-medium text-zinc-400">Per-scan hits:</span>
                  {multi.scanSummaries.map((s) => (
                    <span key={s.id}>{s.name} <b className="text-zinc-300">{s.total}</b></span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {multiLoading ? (
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 bg-zinc-800/70" />)}
              </CardContent>
            </Card>
          ) : multi ? (
            multi.rows.length === 0 ? (
              <Card className="border-zinc-800 bg-zinc-900/60">
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <Layers className="h-6 w-6 text-zinc-700" />
                  <p className="text-xs text-zinc-500">
                    No stock fired in {multi.min}+ of the {multi.requested} scans — lower the minimum or swap scans.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <MultiTable rows={multi.rows} requested={multi.requested} onSelectStock={onSelectStock} />
                {multi.truncated && (
                  <p className="text-center text-[11px] text-zinc-600">Showing the top 300 of {multi.total} confluence matches.</p>
                )}
              </>
            )
          ) : (
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Radar className="h-6 w-6 text-zinc-700" />
                <p className="text-xs text-zinc-500">Pick at least two scans above and run the confluence.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ================================================================ tables

function ResultsTable({
  rows, isLoading, onSelectStock,
}: {
  rows?: StockRow[];
  isLoading: boolean;
  onSelectStock: (s: string) => void;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 bg-zinc-800/70" />)}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Radar className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-500">No stocks match — loosen the filters or wait for the next sync.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-zinc-800/70 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="w-9 px-2 py-2.5 text-center font-medium">
                    <Star className="mx-auto h-3 w-3 text-zinc-600" />
                    <span className="sr-only">Watchlist</span>
                  </th>
                  <th className="px-4 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Chg %</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Traded volume · multiple of its own 20-day average">Volume</th>
                  <th className="px-3 py-2.5 text-right font-medium">RSI</th>
                  <th className="px-3 py-2.5 text-right font-medium">1M</th>
                  <th className="px-3 py-2.5 text-right font-medium">3M</th>
                  <th className="px-3 py-2.5 text-right font-medium">6M</th>
                  <th className="px-3 py-2.5 text-right font-medium">P/E</th>
                  <th className="px-3 py-2.5 text-right font-medium">From high</th>
                  <th className="px-4 py-2.5 text-right font-medium">Mkt cap</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.symbol}
                    onClick={() => onSelectStock(r.symbol)}
                    className="cursor-pointer border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30"
                  >
                    <td className="px-2 py-2.5 text-center">
                      <AddToWatchlistButton symbol={r.symbol} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs font-semibold text-zinc-100">{r.symbol.replace(".NS", "")}</div>
                      <div className="max-w-52 truncate text-[10px] text-zinc-600">{r.name}{r.sector && r.sector !== "Unknown" ? ` · ${r.sector}` : ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-200">{fmtPrice(r.price)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.changePct))}>{fmtPct(r.changePct)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="font-mono text-xs text-zinc-400">{fmtVol(r.volume)}</div>
                      {r.relVol != null && (
                        <div
                          className={cn("font-mono text-[10px]", relVolTone(r.relVol))}
                          title="Today's traded volume vs its 20-day average — 2× or more is spike territory"
                        >
                          {r.relVol >= 10 ? "10×+" : `${r.relVol.toFixed(1)}×`} avg
                        </div>
                      )}
                    </td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", rsiTone(r.rsi14))}>{fmtNum(r.rsi14, 1)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.mom1M))}>{fmtPct(r.mom1M, 1)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.mom3M))}>{fmtPct(r.mom3M, 1)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.mom6M))}>{fmtPct(r.mom6M, 1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">{fmtNum(r.peTTM, 1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">{fmtNum(r.fromHighPct, 1)}%</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">{fmtMcap(r.marketCap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MultiTable({
  rows, requested, onSelectStock,
}: {
  rows: MultiResponse["rows"];
  requested: number;
  onSelectStock: (s: string) => void;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800/70 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="w-9 px-2 py-2.5 text-center font-medium">
                  <Star className="mx-auto h-3 w-3 text-zinc-600" />
                  <span className="sr-only">Watchlist</span>
                </th>
                <th className="px-4 py-2.5 font-medium">Stock</th>
                <th className="px-3 py-2.5 text-right font-medium">Price</th>
                <th className="px-3 py-2.5 text-right font-medium">Chg %</th>
                <th className="px-3 py-2.5 text-center font-medium">Matches</th>
                <th className="px-3 py-2.5 font-medium">Fired in</th>
                <th className="px-3 py-2.5 text-right font-medium">RS</th>
                <th className="px-4 py-2.5 text-right font-medium">Mkt cap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={() => onSelectStock(r.symbol)}
                  className="cursor-pointer border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30"
                >
                  <td className="px-2 py-2.5 text-center">
                    <AddToWatchlistButton symbol={r.symbol} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-xs font-semibold text-zinc-100">{r.symbol.replace(".NS", "")}</div>
                    <div className="max-w-52 truncate text-[10px] text-zinc-600">{r.name}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-200">{fmtPrice(r.price)}</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.changePct))}>{fmtPct(r.changePct)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold",
                        r.matches >= requested ? "bg-brand text-white" : r.matches >= requested - 1 ? "bg-brand/20 text-brand-text" : "bg-zinc-800 text-zinc-300"
                      )}
                    >
                      {r.matches}/{requested}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-72 flex-wrap gap-1">
                      {r.scans.slice(0, 3).map((s) => (
                        <span key={s} className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-300">{s}</span>
                      ))}
                      {r.scans.length > 3 && (
                        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-500">+{r.scans.length - 3} more</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">{r.rs != null ? r.rs : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">{fmtMcap(r.marketCap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-[11px] text-zinc-600">Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-7 border-zinc-700 bg-transparent px-2.5 text-xs text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="h-7 border-zinc-700 bg-transparent px-2.5 text-xs text-zinc-300">
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Relative-volume chip colour — ≥2× is spike territory (mirrors the Volume-spike scanner flag). */
function relVolTone(rv: number): string {
  if (rv >= 2) return "text-emerald-400";
  if (rv >= 1.5) return "text-zinc-200";
  return "text-zinc-500";
}

function rsiTone(rsi: number | null): string {
  if (rsi == null) return "text-zinc-500";
  if (rsi > 60) return "text-emerald-400";
  if (rsi < 40) return "text-red-400";
  return "text-zinc-300";
}
