"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, ExternalLink, Info, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeColor, fmtPct } from "@/lib/format";
import { MOMENTUM_CLASSES, BULL_RSI, BEAR_RSI, type MomentumClass, type MomentumRow } from "@/lib/momentum-classes";

interface SectorMomentumData {
  indices: MomentumRow[];
  sectors: MomentumRow[];
  asOf: string | null;
  generatedAt: string;
}

type SortKey = "rank" | "dailyRSI" | "weeklyRSI" | "monthlyRSI" | "change1D" | "change5D" | "breadthAbove50";

const SORT_COLUMNS: { key: SortKey; label: string; numeric: boolean; defaultDir: "asc" | "desc" }[] = [
  { key: "rank", label: "#", numeric: false, defaultDir: "asc" },
  { key: "dailyRSI", label: "Daily RSI", numeric: true, defaultDir: "desc" },
  { key: "weeklyRSI", label: "Weekly RSI", numeric: true, defaultDir: "desc" },
  { key: "monthlyRSI", label: "Monthly RSI", numeric: true, defaultDir: "desc" },
  { key: "breadthAbove50", label: "% > 50-DMA", numeric: true, defaultDir: "desc" },
  { key: "change1D", label: "1D change", numeric: true, defaultDir: "desc" },
  { key: "change5D", label: "5D change", numeric: true, defaultDir: "desc" },
];

/**
 * Sector momentum — daily / weekly / monthly RSI-14 for NSE indices and
 * broad sectors. The classification rule is published verbatim in the
 * "How to read this" panel and the API follows it exactly; rows are ranked
 * so leaders and laggards are always visible.
 */
export function SectorMomentumView({
  onOpenRotation,
  onScanSector,
}: {
  onOpenRotation?: () => void;
  onScanSector?: (sector: string) => void;
}) {
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
    placeholderData: (prev) => prev,
  });

  if (isLoading) return <MomentumSkeleton />;
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 py-10 text-center">
        <p className="text-xs text-zinc-400">Sector momentum failed to load.</p>
        <Button variant="outline" size="sm" className="mt-3 h-8 border-zinc-700 bg-transparent text-xs text-zinc-300" onClick={() => void refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RsiHeatmap rows={data.indices} onOpenRotation={onOpenRotation} />

      <MomentumTable
        title="NSE indices"
        rows={data.indices}
        onScanSector={onScanSector}
      />
      <MomentumTable
        title="Broad sectors"
        rows={data.sectors}
        onScanSector={onScanSector}
      />

      <LegendPanel open={legendOpen} onToggle={() => setLegendOpen((v) => !v)} indices={data.indices} sectors={data.sectors} />

      <p className="text-[11px] text-zinc-500">
        {data.asOf ? (
          <>
            Data as of{" "}
            <span className="font-medium text-zinc-300">
              {new Date(data.asOf + "T15:30:00+05:30").toLocaleDateString("en-IN", {
                weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
              })}
            </span>{" "}
            close
          </>
        ) : (
          "Awaiting first EOD session"
        )}
        {" · "}auto-updates after the 4:00 pm IST EOD sync on trading days
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- heatmap

/** Cell tone by published band: ≤40 weak, ≥60 strong, else neutral. */
function bandTone(v: number): string {
  if (v >= BULL_RSI) return "bg-emerald-500/15 text-emerald-300";
  if (v <= BEAR_RSI) return "bg-red-500/15 text-red-300";
  return "bg-zinc-800/70 text-zinc-300";
}

function RsiHeatmap({ rows, onOpenRotation }: { rows: MomentumRow[]; onOpenRotation?: () => void }) {
  if (rows.length === 0) return null;
  const split = Math.ceil(rows.length / 2);
  const halves = [rows.slice(0, split), rows.slice(split)];

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-zinc-100">RSI heatmap · indices</h3>
          <span className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/40" />≥ 60 strong</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-zinc-600/50" />40–60 neutral</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500/40" />≤ 40 weak</span>
          </span>
          {onOpenRotation && (
            <button
              onClick={onOpenRotation}
              className="ml-auto flex items-center gap-1 text-[11px] font-medium text-emerald-400 transition-colors hover:text-emerald-300"
            >
              <ExternalLink className="h-3 w-3" /> Open sector rotation
            </button>
          )}
        </div>
        <div className="grid gap-x-6 gap-y-0 lg:grid-cols-2">
          {halves.map((half, hi) => (
            <div key={hi} className={cn(hi === 1 && "max-lg:hidden")}>
              <div className="grid grid-cols-[1fr_2.6rem_2.6rem_2.6rem] gap-1 border-b border-zinc-800/60 pb-1 text-[9px] uppercase tracking-wider text-zinc-500">
                <span>Index</span>
                <span className="text-right">Daily</span>
                <span className="text-right">Weekly</span>
                <span className="text-right">Month</span>
              </div>
              {half.map((r) => (
                <div key={r.key} className="grid grid-cols-[1fr_2.6rem_2.6rem_2.6rem] items-center gap-1 border-b border-zinc-800/30 py-[3px] last:border-0">
                  <span className="truncate text-[11px] font-medium text-zinc-200" title={r.name}>{r.name}</span>
                  <HeatCell v={r.dailyRSI} d={r.dDelta} />
                  <HeatCell v={r.weeklyRSI} d={r.wDelta} />
                  <HeatCell v={r.monthlyRSI} d={r.mDelta} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HeatCell({ v, d }: { v: number | null; d: number | null }) {
  if (v == null) return <span className="text-right font-mono text-[10px] text-zinc-600">—</span>;
  return (
    <span className={cn("relative rounded px-1 py-0.5 text-right font-mono text-[10px] font-semibold tabular-nums", bandTone(v))} title={d != null ? `${d >= 0 ? "+" : ""}${d.toFixed(1)} vs prior period` : undefined}>
      {v.toFixed(0)}
      {d != null && Math.abs(d) >= 2 && (
        <span className={cn("absolute -right-0.5 -top-1 text-[7px] leading-none", d > 0 ? "text-emerald-400" : "text-red-400")}>▲</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- table

function sortValue(r: MomentumRow, key: SortKey): number | null {
  if (key === "rank") return r.rank ?? null;
  return (r[key] as number | null) ?? null;
}

function MomentumTable({
  title, rows, onScanSector,
}: {
  title: string;
  rows: MomentumRow[];
  onScanSector?: (sector: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "rank", dir: "asc" });

  const sorted = useMemo(() => {
    const dirFactor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av == null && bv == null) return (a.rank ?? 99) - (b.rank ?? 99);
      if (av == null) return 1; // missing values sink regardless of direction
      if (bv == null) return -1;
      if (av !== bv) return (av - bv) * dirFactor;
      return (a.rank ?? 99) - (b.rank ?? 99);
    }) as MomentumRow[];
  }, [rows, sort]);

  if (rows.length === 0) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4 text-xs text-zinc-400">{title} — data filling in, check back after the next sync.</CardContent>
      </Card>
    );
  }

  const n = rows.length;
  const leaderCutoff = n >= 6 ? 3 : 0;
  const laggardCutoff = n >= 6 ? n - 2 : 0;
  const hasBreadth = title === "Broad sectors";
  const colCount = 9 + (hasBreadth ? 1 : 0);

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <span className="hidden text-[10px] text-zinc-500 sm:inline">
            · ranked by average RSI across timeframes · click a row for constituents
          </span>
        </div>

        {/* desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/60 text-left text-[10px] uppercase tracking-wider text-zinc-400">
                {SORT_COLUMNS.filter((c) => c.key !== "breadthAbove50" || title === "Broad sectors").map((c) => (
                  <Fragment key={c.key}>
                    <th className={cn("px-3 py-2 font-medium", c.numeric && "text-right", c.key === "rank" && "pl-4")}>
                      <button
                        className={cn("inline-flex items-center gap-0.5 transition-colors hover:text-zinc-200", sort.key === c.key && "text-zinc-100")}
                        onClick={() => setSort((s) => (s.key === c.key ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.defaultDir }))}
                        aria-label={`Sort by ${c.label}`}
                      >
                        {c.label}
                        {sort.key === c.key && <span className="text-[8px]">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                    {/* name column lives between # and the RSI columns in the body — emit its header there so cells line up */}
                    {c.key === "rank" && (
                      <th className="px-3 py-2 font-medium">{hasBreadth ? "Sector" : "Index"}</th>
                    )}
                  </Fragment>
                ))}
                <th className="px-3 py-2 font-medium">Strength</th>
                <th className="w-6 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isOpen = expanded === r.key;
                return (
                  <ExpandRow key={r.key} isOpen={isOpen} onToggle={() => setExpanded(isOpen ? null : r.key)} row={r} onScanSector={onScanSector} leaderCutoff={leaderCutoff} laggardCutoff={laggardCutoff} colCount={colCount} />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* mobile cards */}
        <div className="divide-y divide-zinc-800/50 md:hidden">
          {sorted.map((r) => {
            const isOpen = expanded === r.key;
            return (
              <div key={r.key} className="px-4 py-3">
                <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setExpanded(isOpen ? null : r.key)}>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-zinc-100">
                      {r.rank && <span className="mr-1 font-mono text-[10px] text-zinc-500">#{r.rank}</span>}
                      {r.name}
                    </span>
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
                    <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-500 transition-transform", isOpen && "rotate-180")} />
                  </span>
                </button>
                {isOpen && <RowDetail row={r} onScanSector={onScanSector} />}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ExpandRow({
  row: r, isOpen, onToggle, onScanSector, leaderCutoff, laggardCutoff, colCount,
}: {
  row: MomentumRow;
  isOpen: boolean;
  onToggle: () => void;
  onScanSector?: (sector: string) => void;
  leaderCutoff: number;
  laggardCutoff: number;
  colCount: number;
}) {
  return (
    <>
      <tr className="cursor-pointer border-b border-zinc-800/40 hover:bg-zinc-800/30" onClick={onToggle}>
        <td className="pl-4 pr-2 py-2.5">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-zinc-500">#{r.rank}</span>
            {leaderCutoff > 0 && r.rank != null && r.rank <= leaderCutoff && (
              <span className="rounded bg-emerald-500/15 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-emerald-300">Leader</span>
            )}
            {laggardCutoff > 0 && r.rank != null && r.rank >= laggardCutoff && (
              <span className="rounded bg-red-500/15 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-red-300">Laggard</span>
            )}
          </span>
        </td>
        <NameCell name={r.name} source={r.source} />
        <RsiCell value={r.dailyRSI} delta={r.dDelta} />
        <RsiCell value={r.weeklyRSI} delta={r.wDelta} />
        <RsiCell value={r.monthlyRSI} delta={r.mDelta} />
        {r.kind === "sector" ? (
          <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">
            {r.breadthAbove50 != null ? `${r.breadthAbove50}%` : "—"}
          </td>
        ) : null}
        <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.change1D))}>{fmtPct(r.change1D, 1)}</td>
        <td className={cn("px-3 py-2.5 text-right font-mono text-xs", changeColor(r.change5D))}>{r.change5D != null ? fmtPct(r.change5D, 1) : "—"}</td>
        <td className="px-3 py-2.5">
          {r.classification ? (
            <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold", MOMENTUM_CLASSES[r.classification].badge)}>
              {MOMENTUM_CLASSES[r.classification].short}
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500">insufficient data</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-right">
          <ChevronRight className={cn("h-3.5 w-3.5 text-zinc-600 transition-transform", isOpen && "rotate-90")} />
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-zinc-800/40 bg-zinc-950/40">
          <td colSpan={colCount} className="px-4 py-3">
            <RowDetail row={r} onScanSector={onScanSector} />
          </td>
        </tr>
      )}
    </>
  );
}

function NameCell({ name, source }: { name: string; source: string }) {
  return (
    <td className="px-3 py-2.5">
      <div className="text-xs font-semibold text-zinc-100">{name}</div>
      {source === "composite" && (
        <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500">basket of major constituents</div>
      )}
    </td>
  );
}

function RowDetail({ row: r, onScanSector }: { row: MomentumRow; onScanSector?: (sector: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {r.sample && r.sample.length > 0 && (
          <div>
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Largest constituents · daily RSI · 1D</div>
            <div className="flex flex-wrap gap-1.5">
              {r.sample.map((s) => (
                <span key={s.symbol} className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[10px]">
                  <span className="font-semibold text-zinc-200">{s.symbol}</span>{" "}
                  <span className={cn(changeColor(s.change1D))}>{fmtPct(s.change1D, 1)}</span>{" "}
                  <span className={cn(s.dailyRSI == null ? "text-zinc-600" : s.dailyRSI >= BULL_RSI ? "text-emerald-400" : s.dailyRSI <= BEAR_RSI ? "text-red-400" : "text-zinc-400")}>
                    {s.dailyRSI?.toFixed(0) ?? "—"}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
        {r.movers && (r.movers.up.length > 0 || r.movers.down.length > 0) && (
          <div>
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Top movers today</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {r.movers.up.map((m) => (
                <span key={m.symbol} className="rounded-md border border-emerald-900/60 bg-emerald-950/30 px-2 py-1 font-mono text-[10px]">
                  <span className="font-semibold text-zinc-200">{m.symbol}</span> <span className="text-emerald-400">▲{m.change1D?.toFixed(1)}%</span>
                </span>
              ))}
              {r.movers.down.length > 0 && <span className="text-[10px] text-zinc-600">vs</span>}
              {r.movers.down.map((m) => (
                <span key={m.symbol} className="rounded-md border border-red-900/60 bg-red-950/30 px-2 py-1 font-mono text-[10px]">
                  <span className="font-semibold text-zinc-200">{m.symbol}</span> <span className="text-red-400">▼{Math.abs(m.change1D ?? 0).toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {r.sectorValue && onScanSector && (
        <Button
          size="sm"
          className="h-7 gap-1.5 bg-emerald-600/90 px-2.5 text-[11px] text-white hover:bg-emerald-600"
          onClick={() => onScanSector(r.sectorValue as string)}
        >
          Run scan on this sector <ChevronRight className="h-3 w-3" />
        </Button>
      )}
      <p className="text-[10px] leading-4 text-zinc-500">
        {r.source === "live" && "Direct index RSI from the provider's index history."}
        {r.source === "composite" && `Cap-weighted basket of ${r.constituents ?? "—"} major constituents, built from our stored 2y closes (RSI of the basket level).${r.breadthAbove50 != null ? ` ${r.breadthAbove50}% of members are above their 50-DMA.` : ""}`}
        {r.source === "median" && `Median RSI of the 15 largest constituents — a breadth-aware sector measure that differs from the index RSI you see on TV.${r.breadthAbove50 != null ? ` ${r.breadthAbove50}% of all ${r.constituents ?? ""} constituents are above their 50-DMA.` : ""}`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- cells

/**
 * RSI cell: value + change vs prior period + a 0-100 gauge with tick marks
 * at the 30/50/70 levels (band shading follows the published rule).
 */
function RsiCell({ value, delta }: { value: number | null; delta: number | null }) {
  if (value == null) {
    return <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-600">—</td>;
  }
  const tone = value >= BULL_RSI ? "text-emerald-400" : value <= BEAR_RSI ? "text-red-400" : "text-zinc-200";
  return (
    <td className="px-3 py-2">
      <div className="flex flex-col items-end gap-0.5">
        <span className={cn("font-mono text-xs font-semibold tabular-nums", tone)}>{value.toFixed(1)}</span>
        {delta != null && Math.abs(delta) >= 0.05 && (
          <span className={cn("font-mono text-[9px] leading-none", delta > 0 ? "text-emerald-400" : "text-red-400")}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
          </span>
        )}
        <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800" role="img" aria-label={`RSI ${value.toFixed(1)}`}>
          <span className="absolute inset-y-0 left-0 w-[40%] bg-red-500/15" />
          <span className="absolute inset-y-0 left-[40%] w-[20%] bg-zinc-600/20" />
          <span className="absolute inset-y-0 left-[60%] w-[40%] bg-emerald-500/15" />
          <span className="absolute inset-y-0 left-[30%] w-px bg-zinc-600/70" />
          <span className="absolute inset-y-0 left-[50%] w-px bg-zinc-600/70" />
          <span className="absolute inset-y-0 left-[70%] w-px bg-zinc-600/70" />
          <span
            className={cn("absolute inset-y-0 w-1 rounded-full", value >= BULL_RSI ? "bg-emerald-400" : value <= BEAR_RSI ? "bg-red-400" : "bg-zinc-400")}
            style={{ left: `calc(${Math.min(100, Math.max(0, value))}% - 2px)` }}
          />
        </span>
      </div>
    </td>
  );
}

function MiniRsi({ label, value }: { label: string; value: number | null }) {
  const tone = value == null ? "text-zinc-500" : value >= BULL_RSI ? "text-emerald-400" : value <= BEAR_RSI ? "text-red-400" : "text-zinc-200";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("font-mono text-sm font-semibold", tone)}>{value?.toFixed(1) ?? "—"}</div>
    </div>
  );
}

// ---------------------------------------------------------------- legend

function LegendPanel({
  open, onToggle, indices, sectors,
}: {
  open: boolean;
  onToggle: () => void;
  indices: MomentumRow[];
  sectors: MomentumRow[];
}) {
  const all = [...indices, ...sectors];
  const counts = new Map<MomentumClass, number>();
  for (const r of all) {
    if (!r.classification) continue;
    counts.set(r.classification, (counts.get(r.classification) ?? 0) + 1);
  }
  const orderedCounts = [...counts.entries()].sort(
    (a, b) => MOMENTUM_CLASSES[a[0]].rank - MOMENTUM_CLASSES[b[0]].rank
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {orderedCounts.map(([cls, n]) => (
          <span key={cls} className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", MOMENTUM_CLASSES[cls].badge)}>
            {MOMENTUM_CLASSES[cls].short} · {n}
          </span>
        ))}
        <button
          onClick={onToggle}
          className="ml-auto flex items-center gap-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          aria-expanded={open}
        >
          <Info className="h-3.5 w-3.5" />
          How to read this — the exact rule
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4 text-xs leading-6 text-zinc-300">
            <p>
              Every reading is <span className="text-zinc-100">RSI-14 on daily, weekly and monthly closes</span>. The rule,
              applied mechanically to every row — no manual overrides: a timeframe is{" "}
              <span className="font-semibold text-emerald-300">strong when RSI ≥ 60</span>,{" "}
              <span className="font-semibold text-red-300">weak when RSI ≤ 40</span>, and neutral in between. The strength
              pill is decided by the first matching line below (bull side checked first):
            </p>
            <ul className="mt-2.5 space-y-1.5">
              {(Object.keys(MOMENTUM_CLASSES) as MomentumClass[])
                .sort((a, b) => MOMENTUM_CLASSES[a].rank - MOMENTUM_CLASSES[b].rank)
                .map((cls) => (
                  <li key={cls} className="flex items-start gap-2">
                    <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", MOMENTUM_CLASSES[cls].badge)}>
                      {MOMENTUM_CLASSES[cls].short}
                    </span>
                    <span className="text-zinc-400">{MOMENTUM_CLASSES[cls].description}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-2.5">
              <span className="font-semibold text-zinc-100">Ranking:</span> rows are ranked by the average of their three
              RSI readings — the top 3 carry a green <span className="font-semibold text-emerald-300">Leader</span> tag and
              the bottom 3 a red <span className="font-semibold text-red-300">Laggard</span> tag, so the page always shows
              relative leadership even when everything sits in neutral bands. Click any column header to re-sort; click a
              row to see its constituents.
            </p>
            <p className="mt-2.5">
              <span className="font-semibold text-zinc-100">Where each number comes from:</span>{" "}
              <span className="text-zinc-400">live</span> rows use the provider&apos;s index history. Rows marked{" "}
              <span className="text-zinc-400">basket of major constituents</span> are cap-weighted composites of that
              index&apos;s major members built from our stored 2y closes (the provider no longer serves history for those
              indices — we compute them ourselves rather than show gaps).{" "}
              <span className="text-zinc-100">Sector rows are the median RSI of the 15 largest constituents</span> — a
              breadth-aware sector measure that will differ from the index RSI on TV (e.g. NIFTY IT index vs the IT sector
              median). Daily RSI deltas compare 5 sessions back; weekly/monthly deltas compare the prior completed
              week/month.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MomentumSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-44 bg-zinc-900" />
      <Skeleton className="h-72 bg-zinc-900" />
      <Skeleton className="h-72 bg-zinc-900" />
    </div>
  );
}
