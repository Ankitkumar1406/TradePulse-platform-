"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, ChevronRight, TrendingUp } from "lucide-react";
import { changeColor, fmtPct, fmtPrice, fmtVol } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SectorRotation, SectorStrength, SectorSkeleton, type SectorPayload } from "@/components/sector-views";
import { SectorMomentumView } from "@/components/sector-momentum-view";
import {
  ADLineCard, NhNlCard, SectorBreadthGrid, SegmentCards, Sparkline,
  type BreadthAnalytics, type HistoryRow,
} from "@/components/breadth-analytics";

interface IndexQuote { symbol: string; name: string; price: number; changePct: number }
interface Row {
  symbol: string; name: string; price: number | null; changePct: number | null;
  volume: number | null; marketCap: number | null; sector: string | null; rsi14: number | null;
}
interface MarketData {
  indices: IndexQuote[];
  breadth: {
    advances: number; declines: number; unchanged: number; total: number;
    aboveSma20: number; aboveSma50: number; aboveSma200: number; newHighs: number; newLows: number;
  };
  gainers: Row[];
  losers: Row[];
  mostActive: Row[];
  sectors: { sector: string; avgChangePct: number; count: number; totalMcap: number }[];
}

type SubView = "breadth" | "momentum" | "rotation" | "strength";

const VIEW_ITEMS: { id: SubView; label: string; hint: string }[] = [
  { id: "breadth", label: "Market breadth", hint: "Advances · declines · participation" },
  { id: "momentum", label: "Sector momentum", hint: "Daily · weekly · monthly RSI per index" },
  { id: "rotation", label: "Sector rotation", hint: "Industries · subgroups · stocks on the RS map" },
  { id: "strength", label: "Sector strength", hint: "Strongest now · biggest change" },
];

/** Visible tab row — sibling views stay discoverable (no hidden dropdown). */
function MarketViewTabs({ value, onChange }: { value: SubView; onChange: (v: SubView) => void }) {
  return (
    <div role="tablist" aria-label="Market views" className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1">
      {VIEW_ITEMS.map((v) => {
        const active = v.id === value;
        return (
          <button
            key={v.id}
            role="tab"
            aria-selected={active}
            title={v.hint}
            onClick={() => onChange(v.id)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
            )}
          >
            {active && <BarChart3 className="mr-1.5 inline h-3.5 w-3.5 align-[-2px] text-emerald-400" />}
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

export function MarketTab({ onSelectStock, isPro = false, onUpgrade, onOpenWatchlist, onScanSector }: { onSelectStock: (s: string) => void; isPro?: boolean; onUpgrade?: () => void; onOpenWatchlist?: () => void; onScanSector?: (sector: string) => void }) {
  const [subView, setSubView] = useState<SubView>("breadth");
  // Liquid mode filters circuit-pennies out of Gainers/Losers (server-side).
  const [moversLiquid, setMoversLiquid] = useState(true);
  const moversParam = moversLiquid ? "liquid" : "all";

  const { data, isLoading } = useQuery<MarketData>({
    queryKey: ["market", moversParam],
    queryFn: async () => {
      const res = await fetch(`/api/market?movers=${moversParam}`);
      if (!res.ok) throw new Error("market failed");
      return res.json();
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  // Breadth history + breakdowns — heavy server-side computation, cached in
  // module memory and warmed at server boot; only refreshed alongside new
  // sessions. placeholderData keeps already-loaded charts visible while a
  // background refetch runs instead of flashing them away.
  const { data: breadth } = useQuery<BreadthAnalytics>({
    queryKey: ["breadth-history"],
    queryFn: async () => {
      const res = await fetch("/api/market/breadth-history");
      if (!res.ok) throw new Error("breadth history failed");
      return res.json();
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
    placeholderData: (prev) => prev,
  });

  // Sector analytics only fetched when the rotation/strength view is open.
  const { data: sectorData, isError: sectorError } = useQuery<SectorPayload>({
    queryKey: ["marketSectors"],
    queryFn: async () => {
      const res = await fetch("/api/market/sectors");
      if (!res.ok) throw new Error("sector analytics failed");
      return res.json();
    },
    enabled: subView === "rotation" || subView === "strength",
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const activeLabel = VIEW_ITEMS.find((v) => v.id === subView)?.label ?? "Market";

  return (
    <div className="space-y-4">
      {/* View header + visible tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Market · the lay of the land</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">{activeLabel}</h2>
        </div>
        <MarketViewTabs value={subView} onChange={setSubView} />
      </div>

      {/* Indices always visible */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          {data.indices.map((idx) => (
            <Card key={idx.symbol} className="bg-zinc-900/60 border-zinc-800">
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{idx.name}</div>
                {idx.price ? (
                  <>
                    <div className="mt-0.5 font-mono text-base font-semibold text-zinc-100">
                      {idx.price.toLocaleString("en-IN", { maximumFractionDigits: idx.price > 10000 ? 0 : 2 })}
                    </div>
                    <div
                      className={cn("font-mono text-xs", idx.symbol.includes("VIX") ? changeColor(-(idx.changePct ?? 0)) : changeColor(idx.changePct))}
                      title={idx.symbol.includes("VIX") ? "India VIX — a FALLING VIX signals a calmer market (shown green); rising VIX = fear (red)" : undefined}
                    >
                      {fmtPct(idx.changePct)}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500" title="Index feed reconnecting — syncs every trading day at 4:00 pm IST">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    syncing…
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {subView === "breadth" && (isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 bg-zinc-900" />
          <div className="grid lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 bg-zinc-900" />)}
          </div>
        </div>
      ) : (
        <BreadthView data={data} breadth={breadth} moversLiquid={moversLiquid} onMoversToggle={setMoversLiquid} onSelectStock={onSelectStock} />
      ))}

      {subView === "momentum" && (
        <SectorMomentumView
          onOpenRotation={() => setSubView("rotation")}
          onScanSector={onScanSector}
        />
      )}

      {(subView === "rotation" || subView === "strength") && (sectorError ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 py-10 text-center text-xs text-zinc-500">
          Sector analytics failed to load — try again in a minute.
        </div>
      ) : !sectorData ? (
        <SectorSkeleton cards={2} />
      ) : subView === "rotation" ? (
        <SectorRotation data={sectorData} onSelectStock={onSelectStock} isPro={isPro} onUpgrade={onUpgrade} onOpenWatchlist={onOpenWatchlist} />
      ) : (
        <SectorStrength data={sectorData} onSelectStock={onSelectStock} isPro={isPro} onUpgrade={onUpgrade} />
      ))}
    </div>
  );
}

// ---------------- breadth view (original market data) ----------------

function fmtAsOf(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

function BreadthView({
  data, breadth, moversLiquid, onMoversToggle, onSelectStock,
}: {
  data: MarketData;
  breadth?: BreadthAnalytics;
  moversLiquid: boolean;
  onMoversToggle: (v: boolean) => void;
  onSelectStock: (s: string) => void;
}) {
  const { breadth: b } = data;
  const advPct = b.total ? (b.advances / b.total) * 100 : 50;
  const decPct = b.total ? (b.declines / b.total) * 100 : 50;

  const hist = breadth?.history ?? [];
  const last: HistoryRow | undefined = hist[hist.length - 1];
  const spark = (key: keyof HistoryRow) => hist.slice(-22).map((h) => h[key] as number);
  const delta = (live: number, key: keyof HistoryRow) => (last ? live - (last[key] as number) : null);
  const asOf = fmtAsOf(breadth?.asOf ?? null);

  return (
    <div className="space-y-4">
      {/* Breadth */}
      <Card className="bg-zinc-900/60 border-zinc-800">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs mb-2">
            <span className="font-medium text-zinc-300">Market breadth · {b.total.toLocaleString("en-IN")} stocks</span>
            <span className="font-mono">
              <span className="text-emerald-400">{b.advances.toLocaleString("en-IN")} ▲</span>
              {delta(b.advances, "adv") != null && (
                <DeltaBadge v={delta(b.advances, "adv")!} cls="text-emerald-400" />
              )}
              <span className="text-zinc-500 mx-2">{b.unchanged.toLocaleString("en-IN")} =</span>
              <span className="text-red-400">{b.declines.toLocaleString("en-IN")} ▼</span>
              {delta(b.declines, "dec") != null && (
                <DeltaBadge v={delta(b.declines, "dec")!} cls="text-red-400" invert />
              )}
            </span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="bg-emerald-500/80 h-full" style={{ width: `${advPct}%` }} />
            <div className="bg-zinc-600 h-full" style={{ width: `${100 - advPct - decPct}%` }} />
            <div className="bg-red-500/80 h-full" style={{ width: `${decPct}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            <Participation label="Above 20 SMA" value={b.aboveSma20} total={b.total}
              delta={delta(b.aboveSma20, "above20")} spark={breadth ? spark("above20") : undefined} asOf={last?.date} />
            <Participation label="Above 50 SMA" value={b.aboveSma50} total={b.total}
              delta={delta(b.aboveSma50, "above50")} spark={breadth ? spark("above50") : undefined} asOf={last?.date} />
            <Participation label="Above 200 SMA" value={b.aboveSma200} total={b.total}
              delta={delta(b.aboveSma200, "above200")} spark={breadth ? spark("above200") : undefined} asOf={last?.date} />
            <Participation label="52W Highs" value={b.newHighs} total={b.total} tone="up"
              delta={delta(b.newHighs, "nh")} spark={breadth ? spark("nh") : undefined} asOf={last?.date} />
            <Participation label="52W Lows" value={b.newLows} total={b.total} tone="down"
              delta={delta(b.newLows, "nl")} spark={breadth ? spark("nl") : undefined} asOf={last?.date} />
          </div>
          {(asOf || breadth?.lastFullDate) && (
            <p className="mt-2 text-[10px] text-zinc-600">
              {asOf && <>As of <span className="text-zinc-500">{asOf} IST</span></>}
              {asOf && breadth?.lastFullDate && " · "}
              {breadth?.lastFullDate && <>breadth history through <span className="text-zinc-500">{fmtAsOf(breadth.lastFullDate + "T15:30:00+05:30")}</span> session</>}
              {" · "}▲▼ vs previous session
            </p>
          )}
        </CardContent>
      </Card>

      {/* A/D line + NH-NL trend — skeleton-reserved while history loads so
          the charts never pop in late and shift the layout */}
      {!breadth ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-64 bg-zinc-900 xl:col-span-2" />
          <Skeleton className="h-64 bg-zinc-900" />
        </div>
      ) : breadth.history.length >= 4 ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2"><ADLineCard history={breadth.history} /></div>
          <NhNlCard history={breadth.history} />
        </div>
      ) : null}

      {/* Movers */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-zinc-400">
          Today&apos;s movers
          <span className="ml-1.5 text-[10px] text-zinc-600">
            {moversLiquid ? "min price ₹10 · min ₹1 Cr traded · mcap ≥ ₹100 Cr" : "unfiltered"}
          </span>
        </div>
        <div
          role="group"
          aria-label="Movers liquidity filter"
          title={moversLiquid ? "Showing liquid names — switch to All to include every listed stock" : "Unfiltered — circuit-limit penny noise included"}
          className="flex shrink-0 items-center rounded-md border border-zinc-800 bg-zinc-950/60 p-0.5"
        >
          {(["Liquid", "All"] as const).map((lbl) => {
            const active = (lbl === "Liquid") === moversLiquid;
            return (
              <button
                key={lbl}
                onClick={() => onMoversToggle(lbl === "Liquid")}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                  active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {lbl}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <MoverCard title="Top Gainers" rows={data.gainers} onSelectStock={onSelectStock} />
        <MoverCard title="Top Losers" rows={data.losers} onSelectStock={onSelectStock} />
        <MoverCard title="Most Active by Volume" rows={data.mostActive} onSelectStock={onSelectStock} showVolume />
      </div>

      {/* Sector breadth heatmap + cap/F&O splits — reserved while loading */}
      {!breadth ? (
        <div className="space-y-4">
          <Skeleton className="h-72 bg-zinc-900" />
          <Skeleton className="h-44 bg-zinc-900" />
        </div>
      ) : (
        <>
          {breadth.sectors.length > 0 && <SectorBreadthGrid sectors={breadth.sectors} />}
          <SegmentCards segments={breadth.segments} fno={breadth.fno} />
        </>
      )}

      {/* Sector performance */}
      <Card className="bg-zinc-900/60 border-zinc-800">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-300">Sector performance (avg % change)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.sectors.length === 0 && <span className="text-xs text-zinc-500">Sector data is filling in the background…</span>}
          {data.sectors.map((s) => (
            <Badge
              key={s.sector}
              variant="outline"
              className={cn(
                "border-zinc-700 px-2.5 py-1 text-xs",
                s.avgChangePct > 0.05 ? "text-emerald-400 bg-emerald-500/5" : s.avgChangePct < -0.05 ? "text-red-400 bg-red-500/5" : "text-zinc-300"
              )}
            >
              {s.sector} <span className="ml-1.5 font-mono">{fmtPct(s.avgChangePct, 1)}</span>
              <span className="ml-1 text-zinc-600">·{s.count}</span>
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Small ▲/▼ comparison chip shown next to a stat. */
function DeltaBadge({ v, cls, invert }: { v: number; cls: string; invert?: boolean }) {
  if (Math.round(v) === 0) return <span className="ml-1 text-[9px] text-zinc-600">·</span>;
  const up = invert ? v < 0 : v > 0;
  return (
    <span className={cn("ml-1 text-[9px] font-semibold", cls)}>
      {up ? "▲" : "▼"}{Math.abs(Math.round(v)).toLocaleString("en-IN")}
    </span>
  );
}

function Participation({
  label, value, total, tone, delta, spark, asOf,
}: {
  label: string;
  value: number;
  total: number;
  tone?: "up" | "down";
  delta: number | null;
  spark?: number[];
  asOf?: string;
}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const prev = spark && spark.length > 1 ? spark[spark.length - 1] : null;
  const sparkTone: "up" | "down" | "neutral" = prev == null ? "neutral" : (spark![spark!.length - 1] >= prev ? "up" : "down");
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="flex items-baseline justify-center gap-1.5">
        <div className={cn(
          "font-mono text-sm font-semibold",
          tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : pct >= 50 ? "text-emerald-400" : "text-zinc-200"
        )}>
          {value.toLocaleString("en-IN")}
        </div>
        {delta != null && Math.round(delta) !== 0 && (
          <span
            className={cn("text-[9px] font-semibold", (tone === "down" ? delta < 0 : delta > 0) ? "text-emerald-400" : "text-red-400")}
            title={asOf ? `vs ${asOf} session` : "vs previous session"}
          >
            {delta > 0 ? "▲" : "▼"}{Math.abs(Math.round(delta)).toLocaleString("en-IN")}
          </span>
        )}
      </div>
      <div className="text-[9px] text-zinc-600">{pct}% of universe</div>
      {spark && <Sparkline values={spark} tone={sparkTone} />}
    </div>
  );
}

function MoverCard({ title, rows, onSelectStock, showVolume }: { title: string; rows: Row[]; onSelectStock: (s: string) => void; showVolume?: boolean }) {
  return (
    <Card className="bg-zinc-900/60 border-zinc-800">
      <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-300">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-zinc-800/70">
          {rows.length === 0 && <div className="px-4 py-6 text-xs text-zinc-500">No data yet — sync in progress.</div>}
          {rows.map((r) => (
            <button
              key={r.symbol}
              onClick={() => onSelectStock(r.symbol)}
              className="group flex w-full items-center justify-between gap-2 px-4 py-2 text-left transition-colors hover:bg-zinc-800/60"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-zinc-200 group-hover:text-zinc-50">{r.symbol.replace(".NS", "")}</span>
                  <span className="block truncate text-[10px] text-zinc-500">{r.name}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="text-right">
                  <span className="block font-mono text-xs text-zinc-300">{fmtPrice(r.price)}</span>
                  <span className={cn("block font-mono text-[10px]", changeColor(r.changePct))}>
                    {fmtPct(r.changePct)}{showVolume && r.volume ? ` · ${fmtVol(r.volume)}` : ""}
                  </span>
                </span>
                <ChevronRight className="h-3 w-3 text-zinc-700 transition-colors group-hover:text-emerald-400" />
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
