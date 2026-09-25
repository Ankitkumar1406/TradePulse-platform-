"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Check, ChevronDown, TrendingUp } from "lucide-react";
import { changeColor, fmtPct, fmtPrice, fmtVol } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SectorRotation, SectorStrength, SectorSkeleton, type SectorPayload } from "@/components/sector-views";
import { SectorMomentumView } from "@/components/sector-momentum-view";

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

function MarketViewDropdown({ value, onChange }: { value: SubView; onChange: (v: SubView) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = VIEW_ITEMS.find((v) => v.id === value) ?? VIEW_ITEMS[0];

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-2 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
        onClick={() => setOpen((v) => !v)}
      >
        <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
        {active.label}
        <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-64 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          {VIEW_ITEMS.map((v) => (
            <button
              key={v.id}
              onClick={() => { onChange(v.id); setOpen(false); }}
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/70",
                v.id === value && "bg-zinc-800/50"
              )}
            >
              <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", v.id === value ? "text-emerald-400" : "text-transparent")} />
              <span>
                <span className="block text-xs font-medium text-zinc-100">{v.label}</span>
                <span className="block text-[10px] text-zinc-500">{v.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MarketTab({ onSelectStock, isPro = false, onUpgrade, onOpenWatchlist }: { onSelectStock: (s: string) => void; isPro?: boolean; onUpgrade?: () => void; onOpenWatchlist?: () => void }) {
  const [subView, setSubView] = useState<SubView>("breadth");

  const { data, isLoading } = useQuery<MarketData>({
    queryKey: ["market"],
    queryFn: async () => {
      const res = await fetch("/api/market");
      if (!res.ok) throw new Error("market failed");
      return res.json();
    },
    refetchInterval: 60_000,
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
      {/* View header + dropdown */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Market · the lay of the land</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">{activeLabel}</h2>
        </div>
        <MarketViewDropdown value={subView} onChange={setSubView} />
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
                    <div className={cn("font-mono text-xs", changeColor(idx.changePct))}>{fmtPct(idx.changePct)}</div>
                  </>
                ) : (
                  <div className="mt-0.5 text-xs text-zinc-600">unavailable</div>
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
        <BreadthView data={data} onSelectStock={onSelectStock} />
      ))}

      {subView === "momentum" && <SectorMomentumView />}

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

function BreadthView({ data, onSelectStock }: { data: MarketData; onSelectStock: (s: string) => void }) {
  const { breadth } = data;
  const advPct = breadth.total ? (breadth.advances / breadth.total) * 100 : 50;
  const decPct = breadth.total ? (breadth.declines / breadth.total) * 100 : 50;

  return (
    <div className="space-y-4">
      {/* Breadth */}
      <Card className="bg-zinc-900/60 border-zinc-800">
        <CardContent className="p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-medium text-zinc-300">Market breadth · {breadth.total.toLocaleString("en-IN")} stocks</span>
            <span className="font-mono">
              <span className="text-emerald-400">{breadth.advances} ▲</span>
              <span className="text-zinc-500 mx-2">{breadth.unchanged} =</span>
              <span className="text-red-400">{breadth.declines} ▼</span>
            </span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="bg-emerald-500/80 h-full" style={{ width: `${advPct}%` }} />
            <div className="bg-zinc-600 h-full" style={{ width: `${100 - advPct - decPct}%` }} />
            <div className="bg-red-500/80 h-full" style={{ width: `${decPct}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            <Participation label="Above 20 SMA" value={breadth.aboveSma20} total={breadth.total} />
            <Participation label="Above 50 SMA" value={breadth.aboveSma50} total={breadth.total} />
            <Participation label="Above 200 SMA" value={breadth.aboveSma200} total={breadth.total} />
            <Participation label="52W Highs" value={breadth.newHighs} total={breadth.total} tone="up" />
            <Participation label="52W Lows" value={breadth.newLows} total={breadth.total} tone="down" />
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <MoverCard title="Top Gainers" rows={data.gainers} onSelectStock={onSelectStock} />
        <MoverCard title="Top Losers" rows={data.losers} onSelectStock={onSelectStock} />
        <MoverCard title="Most Active by Volume" rows={data.mostActive} onSelectStock={onSelectStock} showVolume />
      </div>

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

function Participation({ label, value, total, tone }: { label: string; value: number; total: number; tone?: "up" | "down" }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn(
        "font-mono text-sm font-semibold",
        tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : pct >= 50 ? "text-emerald-400" : "text-zinc-200"
      )}>
        {value.toLocaleString("en-IN")}
      </div>
      <div className="text-[9px] text-zinc-600">{pct}% of universe</div>
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
              className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors"
            >
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-zinc-200">{r.symbol.replace(".NS", "")}</span>
                <span className="block truncate text-[10px] text-zinc-500">{r.name}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-xs text-zinc-300">{fmtPrice(r.price)}</span>
                <span className={cn("block font-mono text-[10px]", changeColor(r.changePct))}>
                  {fmtPct(r.changePct)}{showVolume && r.volume ? ` · ${fmtVol(r.volume)}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
