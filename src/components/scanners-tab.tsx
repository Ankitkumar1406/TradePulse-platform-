"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, LayoutList, Loader2, ScanSearch, Sparkles, Lock, ChartCandlestick, Settings2, Star } from "lucide-react";
import { AddToWatchlistButton } from "@/components/add-to-watchlist";
import { changeColor, fmtMcap, fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CandleChart, type Candle, type ChartTimeframe } from "@/components/candle-chart";
import { detectBase, type BaseRange } from "@/lib/base";
import type { MaMode } from "@/components/kline-chart";

interface ScanMeta { id: string; name: string; description: string; basic: boolean; needsBars: boolean }
interface ScanGroup { category: string; description: string; scans: ScanMeta[] }
interface ScanColumn { key: string; label: string; type: string }
interface ScanRow {
  symbol: string; name: string; price: number | null; changePct: number | null;
  marketCap: number | null; sector: string | null; rs?: number | null;
  mom1M?: number | null; mom3M?: number | null; mom6M?: number | null;
  metrics: Record<string, number | string | null>;
}
interface ScanResult { columns: ScanColumn[]; rows: ScanRow[]; scanned: number }

const TOTAL_SCANS = 38;
const TOTAL_CATEGORIES = 8;

/** How many chart tiles the Charts view shows before the "View more charts" button. */
const CHART_PAGE = 12;

function metricText(v: number | string | null, type: string): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  switch (type) {
    case "pct": return fmtPct(v, 1);
    case "rsi": return v.toFixed(1);
    case "price": return fmtPrice(v);
    case "vol": return v >= 1e7 ? `${(v / 1e7).toFixed(1)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)} L` : String(Math.round(v));
    case "mcap": return fmtMcap(v);
    case "x": return `${v}x`;
    case "num": return Number.isInteger(v) ? String(v) : v.toFixed(2);
    default: return String(v);
  }
}

/** Chart-grid filter settings — timeframe, MA/EMA, base overlay, indicators, RS strength. */
interface ChartFilters {
  tf: ChartTimeframe;
  ema: MaMode; // "default" = single MA 20 · "set" = MA 5/10/20/60 · number = EMA · "none"
  base: boolean;
  rsMin: number; // 0 = all
  indicators: { vol: boolean; macd: boolean; boll: boolean; rsi: boolean };
}

const RS_OPTIONS = [
  { v: 0, label: "All RS" },
  { v: 90, label: "RS ≥ 90" },
  { v: 80, label: "RS ≥ 80" },
  { v: 70, label: "RS ≥ 70" },
  { v: 50, label: "RS ≥ 50" },
];

const EMA_OPTIONS = [
  { v: "default", label: "MA 20 (default)" },
  { v: "set", label: "MA 5/10/20/60" },
  { v: "50", label: "EMA 50" },
  { v: "100", label: "EMA 100" },
  { v: "200", label: "EMA 200" },
  { v: "none", label: "No moving average" },
];

const INDICATOR_OPTIONS = [
  { key: "vol", label: "Volume" },
  { key: "macd", label: "MACD" },
  { key: "boll", label: "Bollinger Bands" },
  { key: "rsi", label: "RSI" },
] as const;
type IndicatorKey = (typeof INDICATOR_OPTIONS)[number]["key"];

/** Result sort options — client-side over the scan's rows (nulls always last). */
const SORT_KEYS = [
  { v: "scan", label: "Sort: scan order" },
  { v: "rs", label: "RS ↓" },
  { v: "chg", label: "Change % ↓" },
  { v: "chgAsc", label: "Change % ↑" },
  { v: "mcap", label: "Market cap ↓" },
  { v: "m1", label: "1M return ↓" },
  { v: "m3", label: "3M return ↓" },
  { v: "m6", label: "6M return ↓" },
] as const;
type SortKey = (typeof SORT_KEYS)[number]["v"];

function sortScanRows(rows: ScanRow[], key: SortKey): ScanRow[] {
  if (key === "scan") return rows;
  const metric = (r: ScanRow): number | null => {
    switch (key) {
      case "rs": return r.rs ?? null;
      case "chg": case "chgAsc": return r.changePct ?? null;
      case "mcap": return r.marketCap ?? null;
      case "m1": return r.mom1M ?? null;
      case "m3": return r.mom3M ?? null;
      case "m6": return r.mom6M ?? null;
      default: return null;
    }
  };
  const desc = key !== "chgAsc";
  return [...rows].sort((a, b) => {
    const av = metric(a), bv = metric(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return desc ? bv - av : av - bv;
  });
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex w-full items-center justify-between gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 max-w-44 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-[11px] text-zinc-200 outline-none focus:border-brand"
      >
        {children}
      </select>
    </label>
  );
}

export function ScannersTab({ isPro, onSelectStock, onUpgrade }: { isPro: boolean; onSelectStock: (s: string) => void; onUpgrade: () => void }) {
  const [catalog, setCatalog] = useState<ScanGroup[] | null>(null);
  const [activeScan, setActiveScan] = useState<ScanMeta | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [view, setView] = useState<"list" | "charts">("list");
  // Default chart = candles + 20 MA + Volume + base overlay; MACD / Bollinger / RSI opt-in.
  const [filters, setFilters] = useState<ChartFilters>({
    tf: "day", ema: "default", base: true, rsMin: 0, indicators: { vol: true, macd: false, boll: false, rsi: false },
  });

  // load catalog once
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/scanners");
        const j = (await res.json()) as { groups: ScanGroup[] };
        setCatalog(j.groups);
      } catch {
        setCatalog([]);
      }
    })();
  }, []);

  const run = useMutation({
    mutationFn: async (scan: ScanMeta) => {
      const res = await fetch(`/api/scanners/${scan.id}`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error((j as { error?: string }).error ?? "Scan failed");
        (err as Error & { upgrade?: boolean }).upgrade = Boolean((j as { upgrade?: boolean }).upgrade);
        throw err;
      }
      return j as ScanResult;
    },
    onSuccess: (data, scan) => {
      setResult(data);
      setActiveScan(scan);
    },
    onError: (e: Error & { upgrade?: boolean }) => {
      if (e.upgrade) {
        toast({ title: e.message, description: `Upgrade to unlock all ${TOTAL_SCANS} scanners.` });
        onUpgrade();
      } else {
        toast({ title: e.message, variant: "destructive" });
      }
    },
  });

  const rows = result?.rows ?? [];
  const rsFiltered = useMemo(
    () => (filters.rsMin > 0 ? rows.filter((r) => (r.rs ?? 0) >= filters.rsMin) : rows),
    [rows, filters.rsMin]
  );
  const [sortKey, setSortKey] = useState<SortKey>("scan");
  // applies to BOTH views: the list table and the chart-grid tiles
  const sortedRows = useMemo(() => sortScanRows(rsFiltered, sortKey), [rsFiltered, sortKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Scanners · {TOTAL_SCANS} one-click scans</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">{activeScan ? activeScan.name : "Pick a scan"}</h2>
        </div>
        {activeScan && result && (
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-zinc-500">
              {view === "charts" ? `${rsFiltered.length} of ${rows.length}` : `${rows.length}`} matches
            </span>
            {/* result sorting — RS, change %, market cap, 1M/3M/6M performance */}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-8 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none focus:border-brand"
              aria-label="Sort results"
              title="Sort the scan output (list + charts)"
            >
              {SORT_KEYS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            {/* Chart settings — the scan's chart filter selects, kept off the charts themselves */}
            {view === "charts" && (
              <ChartSettingsPopover filters={filters} setFilters={setFilters} hiddenByRs={rows.length - rsFiltered.length} />
            )}
            {/* List / Charts view tabs */}
            <Tabs value={view} onValueChange={(v) => setView(v as "list" | "charts")}>
              <TabsList className="h-8 bg-zinc-900 p-0.5">
                <TabsTrigger value="list" className="h-7 gap-1.5 px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100">
                  <LayoutList className="h-3.5 w-3.5" /> List
                </TabsTrigger>
                <TabsTrigger value="charts" className="h-7 gap-1.5 px-3 text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100">
                  <ChartCandlestick className="h-3.5 w-3.5" /> Charts
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* catalog sidebar — kept narrow so the chart/results area gets the width */}
        <Card className="h-fit border-zinc-800 bg-zinc-900/60 lg:sticky lg:top-32">
          <CardContent className="max-h-[65vh] overflow-y-auto p-0 tp-scroll">
            {catalog === null ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 bg-zinc-800/70" />)}
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {catalog.map((g) => (
                  <div key={g.category} className="px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{g.category}</span>
                      {g.category === "Trader Choice" && <Sparkles className="h-3 w-3 shrink-0 text-gold-text" />}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {g.scans.map((s) => {
                        const locked = !isPro && !s.basic;
                        return (
                          <button
                            key={s.id}
                            onClick={() => { run.mutate(s); }}
                            className={cn(
                              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                              activeScan?.id === s.id ? "bg-brand/10 text-brand-text" : "text-zinc-300 hover:bg-zinc-800/60"
                            )}
                          >
                            <span className="min-w-0 truncate">
                              {locked && <Lock className="mr-1.5 inline h-3 w-3 text-zinc-600" />}
                              {s.name}
                            </span>
                            {run.isPending && run.variables?.id === s.id && <Loader2 className="h-3 w-3 animate-spin text-brand-text" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* results */}
        <div className="min-w-0 space-y-3">
          {activeScan && (
            <p data-scan-desc className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs leading-5 text-zinc-400">
              {activeScan.description}
            </p>
          )}
          {!activeScan && !run.isPending && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-800 py-16 text-center">
              <ScanSearch className="h-7 w-7 text-zinc-700" />
              <p className="max-w-sm text-xs leading-5 text-zinc-500">
                Choose a scan from the left. Basic scans run on the free plan; the full {TOTAL_SCANS}-scan catalog — including the
                Trader Choice templates — comes with Pro, or the 15-day free trial.
              </p>
            </div>
          )}
          {run.isPending ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 bg-zinc-900" />)}
            </div>
          ) : result && activeScan ? (
            view === "charts" ? (
              <ChartsView rows={sortedRows} filters={filters} onSelectStock={onSelectStock} />
            ) : (
              <ScanTable result={{ ...result, rows: sortedRows }} onSelectStock={onSelectStock} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Chart settings popover — timeframe · MA/EMA · indicators · base overlay · RS strength, tucked away from the chart cards. */
function ChartSettingsPopover({
  filters, setFilters, hiddenByRs,
}: {
  filters: ChartFilters;
  setFilters: React.Dispatch<React.SetStateAction<ChartFilters>>;
  hiddenByRs: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
          open ? "border-brand/50 bg-brand/10 text-brand-text" : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        )}
      >
        <Settings2 className="h-3.5 w-3.5" /> Chart settings
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-30 w-72 space-y-2.5 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Chart settings</div>
            <FilterSelect label="Timeframe" value={filters.tf} onChange={(v) => setFilters((f) => ({ ...f, tf: v as ChartTimeframe }))}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </FilterSelect>
            <FilterSelect label="MA / EMA" value={String(filters.ema)} onChange={(v) => setFilters((f) => ({ ...f, ema: v === "default" || v === "set" || v === "none" ? v : Number(v) }))}>
              {EMA_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </FilterSelect>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Indicators</div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
                {INDICATOR_OPTIONS.map((o) => (
                  <label key={o.key} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300">
                    <input
                      type="checkbox"
                      checked={filters.indicators[o.key as IndicatorKey]}
                      onChange={(e) => setFilters((f) => ({ ...f, indicators: { ...f.indicators, [o.key]: e.target.checked } }))}
                      className="h-3 w-3 cursor-pointer accent-[var(--brand)]"
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              <div className="mt-1 text-[9px] leading-3 text-zinc-600">Default: Volume (in-pane) · 20 MA · Base overlay</div>
            </div>
            <FilterSelect label="Base overlay" value={filters.base ? "on" : "off"} onChange={(v) => setFilters((f) => ({ ...f, base: v === "on" }))}>
              <option value="on">On</option>
              <option value="off">Off</option>
            </FilterSelect>
            <FilterSelect label="RS strength" value={String(filters.rsMin)} onChange={(v) => setFilters((f) => ({ ...f, rsMin: Number(v) }))}>
              {RS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </FilterSelect>
            {filters.rsMin > 0 && hiddenByRs > 0 && (
              <div className="text-[10px] text-zinc-500">{hiddenByRs} hidden by RS filter</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Charts view — clean reference-style chart cards (settings live in the header popover).
 *  All matches are reachable: the first CHART_PAGE tiles render, and a "View more
 *  charts" button reveals the rest page by page (pagination resets when the scan
 *  or the RS filter changes the row set). */
function ChartsView({
  rows, onSelectStock, filters,
}: {
  rows: ScanRow[];
  onSelectStock: (s: string) => void;
  filters: ChartFilters;
}) {
  const [visible, setVisible] = useState(CHART_PAGE);
  // reset pagination whenever the row set changes (new scan / RS filter tweak) —
  // render-phase adjustment, the React-blessed alternative to setState-in-effect
  const [lastRows, setLastRows] = useState(rows);
  if (lastRows !== rows) {
    setLastRows(rows);
    setVisible(CHART_PAGE);
  }
  const shown = rows.slice(0, visible);
  const remaining = rows.length - shown.length;

  return rows.length === 0 ? (
    <div className="py-12 text-center text-xs text-zinc-500">
      No matches right now — market conditions don&apos;t fit this scan today.
    </div>
  ) : (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {shown.map((r) => (
          <ChartCard
            key={r.symbol}
            row={r}
            filters={filters}
            onSelectStock={onSelectStock}
          />
        ))}
      </div>
      {remaining > 0 && (
        <div className="flex flex-col items-center gap-1.5 pb-2 pt-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Showing {shown.length} of {rows.length} charts
          </span>
          <button
            onClick={() => setVisible((v) => v + CHART_PAGE)}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-brand/50 hover:bg-brand/10 hover:text-brand-text"
          >
            View more charts
            <span className="font-normal text-zinc-500">(+{Math.min(CHART_PAGE, remaining)})</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}

function ScanTable({ result, onSelectStock }: { result: ScanResult; onSelectStock: (s: string) => void }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-0">
        {result.rows.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-500">No matches right now — market conditions don&apos;t fit this scan today.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-zinc-800/70 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="w-9 px-2 py-2.5 text-center font-medium">
                    <Star className="mx-auto h-3 w-3 text-zinc-600" />
                    <span className="sr-only">Watchlist</span>
                  </th>
                  <th className="px-4 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Chg %</th>
                  <th className="px-3 py-2.5 text-right font-medium">RS</th>
                  {result.columns.map((c) => (
                    <th key={c.key} className="px-3 py-2.5 text-right font-medium">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
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
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">{r.rs != null ? r.rs : "—"}</td>
                    {result.columns.map((c) => (
                      <td key={c.key} className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">
                        {metricText(r.metrics[c.key] ?? null, c.type)}
                      </td>
                    ))}
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

function ChartCard({
  row, filters, onSelectStock,
}: {
  row: ScanRow;
  filters: ChartFilters;
  onSelectStock: (s: string) => void;
}) {
  const { data } = useBars(row.symbol);
  const bars = data?.bars;
  // base detection for the footer chip — the chart draws the rectangle itself
  const base: BaseRange | null = useMemo(
    () => (filters.base && bars && bars.length > 20 ? detectBase(bars) : null),
    [bars, filters.base],
  );
  return (
    <Card className="overflow-hidden border-zinc-800 bg-zinc-900/60 transition-colors hover:border-brand/40">
      <CardContent className="p-2.5 pb-1.5">
        {/* header: symbol opens the detail dialog · badge + watchlist star sit beside it
            (kept as siblings so the star is never nested inside the symbol button) */}
        <div className="mb-1.5 flex w-full items-center justify-between gap-2">
          <button onClick={() => onSelectStock(row.symbol)} className="min-w-0 flex-1 text-left">
            <span className="text-xs font-semibold text-zinc-100">{row.symbol.replace(".NS", "")}</span>
            <span className="block truncate text-[10px] text-zinc-600">{row.name}</span>
          </button>
          <span className="flex shrink-0 items-center gap-0.5">
            <Badge variant="outline" className={cn("border-transparent text-[10px]", changeColor(row.changePct))}>
              {fmtPct(row.changePct, 1)}
            </Badge>
            <AddToWatchlistButton symbol={row.symbol} />
          </span>
        </div>
        <CandleChart
          candles={data?.bars ?? []}
          height={260}
          variant="card"
          timeframe={filters.tf}
          maMode={filters.ema}
          indicators={{
            VOL: filters.indicators.vol,
            MACD: filters.indicators.macd,
            BOLL: filters.indicators.boll,
            RSI: filters.indicators.rsi,
          }}
          showBase={filters.base}
          baseChip={false}
        />
        {/* base formation + RS score — one compact strip directly below the chart */}
        <div className="mt-1.5 flex min-h-5 items-center justify-between gap-2 border-t border-zinc-800/60 pt-1.5">
          {base ? (
            <span
              className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full border border-dashed px-2 py-0.5 text-[10px] font-medium"
              style={{ borderColor: "var(--gold, #d4a72c)", color: "var(--gold-text, #8a6512)" }}
            >
              <span className="inline-block h-2 w-3 shrink-0 rounded-sm" style={{ border: "1px dashed var(--gold, #d4a72c)", background: "rgba(212,167,44,0.15)" }} />
              <span className="truncate">
                {base.status === "in-base" ? "Base forming" : "Breakout"} · {base.days} sessions · {base.depthPct}% deep
              </span>
            </span>
          ) : (
            <span />
          )}
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">RS score</span>
            {row.rs != null ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-bold",
                  row.rs >= 80 ? "bg-brand/15 text-brand-text" : row.rs >= 50 ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/60 text-zinc-500"
                )}
              >
                RS {row.rs}
              </span>
            ) : (
              <span className="text-[11px] text-zinc-500">—</span>
            )}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// small hook to fetch bars per chart card
function useBars(symbol: string) {
  return useQuery<{ bars: Candle[] }>({
    queryKey: ["stock-bars", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });
}
