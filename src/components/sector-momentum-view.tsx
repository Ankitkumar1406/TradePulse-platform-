"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Info, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeColor, fmtPct } from "@/lib/format";
import { MOMENTUM_CLASSES, BEAR_RSI, BULL_RSI, type MomentumClass } from "@/lib/momentum-classes";

interface MomentumRow {
  name: string;
  kind: "index" | "sector";
  symbol: string | null;
  price: number | null;
  changePct: number | null;
  dailyRSI: number | null;
  weeklyRSI: number | null;
  monthlyRSI: number | null;
  classification: MomentumClass | null;
  constituents?: number;
  topNames?: string[];
}

interface SectorMomentumData {
  indices: MomentumRow[];
  sectors: MomentumRow[];
  updatedAt: string;
}

/**
 * Sector momentum — daily / weekly / monthly RSI for every NSE index and
 * broad sector, each classified into a strength bucket (High strength when
 * all three timeframes are above 60, Short-term strength when only the daily
 * is, etc. — legend below the table explains every bucket).
 */
export function SectorMomentumView() {
  const [legendOpen, setLegendOpen] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<SectorMomentumData>({
    queryKey: ["sectorMomentum"],
    queryFn: async () => {
      const res = await fetch("/api/market/sector-momentum");
      if (!res.ok) throw new Error("sector momentum failed");
      return res.json();
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  if (isLoading) return <MomentumSkeleton />;
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 py-10 text-center">
        <p className="text-xs text-zinc-500">Sector momentum failed to load.</p>
        <Button variant="outline" size="sm" className="mt-3 h-8 border-zinc-700 bg-transparent text-xs text-zinc-300" onClick={() => void refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  const all = [...data.indices, ...data.sectors];
  const counts = new Map<MomentumClass, number>();
  for (const r of all) {
    if (!r.classification) continue;
    counts.set(r.classification, (counts.get(r.classification) ?? 0) + 1);
  }
  const orderedCounts = [...counts.entries()].sort(
    (a, b) => MOMENTUM_CLASSES[a[0]].rank - MOMENTUM_CLASSES[b[0]].rank
  );

  return (
    <div className="space-y-4">
      {/* summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        {orderedCounts.map(([cls, n]) => (
          <span
            key={cls}
            className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", MOMENTUM_CLASSES[cls].badge)}
          >
            {MOMENTUM_CLASSES[cls].short} · {n}
          </span>
        ))}
        <button
          onClick={() => setLegendOpen((v) => !v)}
          className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
          aria-expanded={legendOpen}
        >
          <Info className="h-3.5 w-3.5" />
          How to read this
          <ChevronDown className={cn("h-3 w-3 transition-transform", legendOpen && "rotate-180")} />
        </button>
      </div>

      {/* legend */}
      {legendOpen && (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4 text-xs leading-6 text-zinc-400">
            <p>
              RSI-14 is computed on <span className="text-zinc-200">daily, weekly and monthly</span> closes for every
              index and sector. Above <span className="text-emerald-400">{BULL_RSI}</span> counts as bullish momentum,
              below <span className="text-red-400">{BEAR_RSI}</span> as bearish; between the two is neutral. The
              combination across timeframes defines the category:
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {(Object.keys(MOMENTUM_CLASSES) as MomentumClass[])
                .sort((a, b) => MOMENTUM_CLASSES[a].rank - MOMENTUM_CLASSES[b].rank)
                .map((cls) => (
                  <li key={cls} className="flex items-start gap-2">
                    <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", MOMENTUM_CLASSES[cls].badge)}>
                      {MOMENTUM_CLASSES[cls].label}
                    </span>
                    <span className="text-zinc-500">{MOMENTUM_CLASSES[cls].description}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-2.5 text-[11px] text-zinc-600">
              Sector rows use the median RSI of the 15 largest constituents — a breadth-aware measure of sector
              momentum. RSI moves slowly on higher timeframes: monthly is the trend, weekly is the swing, daily is the
              trigger.
            </p>
          </CardContent>
        </Card>
      )}

      <MomentumTable
        title="NSE indices"
        icon={<TrendingUp className="h-3.5 w-3.5 text-brand-text" />}
        rows={data.indices}
        note="Direct index RSI from NSE index history"
      />
      <MomentumTable
        title="Broad sectors"
        icon={<TrendingUp className="h-3.5 w-3.5 text-gold-text" />}
        rows={data.sectors}
        note="Median of the 15 largest constituents per sector"
      />

      <p className="text-[10px] text-zinc-600">
        Updated {new Date(data.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })} IST ·
        recomputed every 6 hours · indices without full history from the data provider are covered via their sectors
      </p>
    </div>
  );
}

function MomentumTable({
  title, icon, rows, note,
}: {
  title: string;
  icon: React.ReactNode;
  rows: MomentumRow[];
  note: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (rows.length === 0) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4 text-xs text-zinc-500">{title} — data filling in, check back after the next sync.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
          {icon}
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <span className="hidden text-[10px] text-zinc-600 sm:inline">· {note}</span>
        </div>

        {/* desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2 font-medium">Index / Sector</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Daily RSI</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Weekly RSI</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Monthly RSI</th>
                <th className="w-40 px-3 py-2 font-medium">Strength</th>
                <th className="w-24 px-4 py-2 text-right font-medium">Last chg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol ?? r.name} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30">
                  <td className="px-4 py-2.5">
                    <div className="text-xs font-semibold text-zinc-100">{r.name}</div>
                    {r.topNames && (
                      <div className="mt-0.5 truncate text-[10px] text-zinc-600">incl. {r.topNames.slice(0, 3).join(", ")}</div>
                    )}
                  </td>
                  <RsiCell value={r.dailyRSI} />
                  <RsiCell value={r.weeklyRSI} />
                  <RsiCell value={r.monthlyRSI} />
                  <td className="px-3 py-2.5">
                    {r.classification ? (
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", MOMENTUM_CLASSES[r.classification].badge)}>
                        {MOMENTUM_CLASSES[r.classification].label}
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-600">insufficient data</span>
                    )}
                  </td>
                  <td className={cn("px-4 py-2.5 text-right font-mono text-xs", changeColor(r.changePct))}>
                    {fmtPct(r.changePct, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* mobile cards */}
        <div className="divide-y divide-zinc-800/50 md:hidden">
          {rows.map((r) => {
            const isOpen = expanded === (r.symbol ?? r.name);
            return (
              <div key={r.symbol ?? r.name} className="px-4 py-3">
                <button
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setExpanded(isOpen ? null : r.symbol ?? r.name)}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-zinc-100">{r.name}</span>
                    {r.classification && (
                      <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", MOMENTUM_CLASSES[r.classification].badge)}>
                        {MOMENTUM_CLASSES[r.classification].short}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-zinc-400">
                    <span className="text-emerald-400">{r.dailyRSI?.toFixed(0) ?? "—"}</span>
                    <span>/</span>
                    <span className="text-zinc-300">{r.weeklyRSI?.toFixed(0) ?? "—"}</span>
                    <span>/</span>
                    <span className="text-gold-text">{r.monthlyRSI?.toFixed(0) ?? "—"}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-600 transition-transform", isOpen && "rotate-180")} />
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <MiniRsi label="Daily" value={r.dailyRSI} />
                    <MiniRsi label="Weekly" value={r.weeklyRSI} />
                    <MiniRsi label="Monthly" value={r.monthlyRSI} />
                    {r.classification && (
                      <p className="col-span-3 mt-1 text-[10px] leading-4 text-zinc-500">
                        {MOMENTUM_CLASSES[r.classification].description}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** RSI cell with a 0-100 mini-gauge (red <40, neutral 40-60, green >60). */
function RsiCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-600">—</td>
    );
  }
  const tone = value > BULL_RSI ? "text-emerald-400" : value < BEAR_RSI ? "text-red-400" : "text-zinc-300";
  const barColor = value > BULL_RSI ? "bg-emerald-500" : value < BEAR_RSI ? "bg-red-500" : "bg-zinc-500";
  return (
    <td className="px-3 py-2.5">
      <div className="flex flex-col items-end gap-1">
        <span className={cn("font-mono text-xs font-semibold", tone)}>{value.toFixed(1)}</span>
        <span className="relative h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
          <span className="absolute inset-y-0 left-0 w-[40%] bg-red-500/15" />
          <span className="absolute inset-y-0 left-[40%] w-[20%] bg-zinc-600/20" />
          <span className="absolute inset-y-0 left-[60%] w-[40%] bg-emerald-500/15" />
          <span className={cn("absolute inset-y-0 w-0.5 rounded-full", barColor)} style={{ left: `calc(${Math.min(100, Math.max(0, value))}% - 1px)` }} />
        </span>
      </div>
    </td>
  );
}

function MiniRsi({ label, value }: { label: string; value: number | null }) {
  const tone = value == null ? "text-zinc-600" : value > BULL_RSI ? "text-emerald-400" : value < BEAR_RSI ? "text-red-400" : "text-zinc-300";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className={cn("font-mono text-sm font-semibold", tone)}>{value?.toFixed(1) ?? "—"}</div>
    </div>
  );
}

function MomentumSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-24 rounded-full bg-zinc-900" />)}
      </div>
      <Skeleton className="h-72 bg-zinc-900" />
      <Skeleton className="h-72 bg-zinc-900" />
    </div>
  );
}
