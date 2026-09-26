"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Info, Lock, Search, Star, TrendingUp, X } from "lucide-react";
import { changeColor, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sector rotation quadrant & strength views.
 *
 * Rotation — "Which way each sector is heading": the reference's exact filter
 * set — an industry dropdown (58) + a subgroup dropdown (181, grouped by
 * industry) + "Find a stock on the map" search + Industries/Subgroups/Stocks
 * level tabs + the "Ask a question" preset picker — over a ranked list and an
 * RS × momentum quadrant map with last-month trails. Clicking a dot opens the
 * reference's detail drawer (quadrant chips, Strongest / Biggest-change sort,
 * List / Charts toggle, per-stock cards with universe RS rank).
 *
 * Strength — the same filter set over a ranked "strongest now / biggest
 * change" list with quadrant tags, RS bars and leader drill-downs.
 */

// ---------------------------------------------------------------- types

export interface GroupLeader { symbol: string; name: string; rs: number; rsMom: number | null; changePct: number }

export interface GroupRow {
  level: "sector" | "industry" | "subgroup";
  name: string;
  count: number;
  ranked: number;
  avgRs: number | null;
  mom: number | null;
  prev: { rs: number; mom: number } | null;
  quads: { lead: number; impr: number; weak: number; lag: number };
  leaders: GroupLeader[];
  rank: number | null;
}

export interface StockRow {
  symbol: string; name: string; sector: string; indGrp: string; subGrp: string;
  rs: number | null; mom: number | null; changePct: number;
  price: number | null; marketCap: number | null;
  status: "ranked" | "illiquid" | "young" | "nodata";
}

export interface SectorPayload {
  levels: { sector: GroupRow[]; industry: GroupRow[]; subgroup: GroupRow[] };
  stocks: StockRow[];
  taxonomy: { industries: string[]; subGroupsByIndustry: { industry: string; subgroups: string[] }[] };
  updatedAt: string | null;
}

export type Level = "industry" | "subgroup" | "stock";

export function SectorSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: cards }).map((_, i) => <Skeleton key={i} className="h-80 bg-zinc-900" />)}
    </div>
  );
}

// ---------------------------------------------------------------- quadrant meta

type Quad = "lead" | "impr" | "weak" | "lag";

const QUAD: Record<Quad, { name: string; why: string; color: string }> = {
  lead: { name: "Powering up", why: "Strong now and still gaining strength", color: "#1a8a4a" },
  impr: { name: "Turning up", why: "Still weak but improving", color: "#3b82c4" },
  weak: { name: "Cooling off", why: "Strong but losing steam", color: "#d99200" },
  lag: { name: "Falling back", why: "Weak and still fading", color: "#d2392f" },
};

const QUAD_LIST: Quad[] = ["lead", "impr", "weak", "lag"];

function quadOf(rs: number, mom: number): Quad {
  return rs >= 50 ? (mom >= 0 ? "lead" : "weak") : mom >= 0 ? "impr" : "lag";
}

function QuadTag({ q, className }: { q: Quad; className?: string }) {
  const meta = QUAD[q];
  return (
    <span
      title={`${meta.name} — ${meta.why}`}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none", className)}
      style={{ color: meta.color, background: `${meta.color}1a` }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.name}
    </span>
  );
}

function useIsMobile(): boolean {
  const [mob, setMob] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const on = () => setMob(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mob;
}

function truncateName(n: string, max = 20): string {
  return n.length > max ? `${n.slice(0, max - 1)}…` : n;
}

// ---------------------------------------------------------------- preset questions

interface QuestionDef {
  id: string;
  level: Level;
  label: string;
  summary: string;
  pred: (rs: number, mom: number) => boolean;
}

const Q_LEVEL_NOUN: { level: Level; noun: string }[] = [
  { level: "industry", noun: "industries" },
  { level: "subgroup", noun: "subgroups" },
  { level: "stock", noun: "stocks" },
];

const Q_BASE: { key: string; label: (n: string) => string; summary: string; pred: (rs: number, mom: number) => boolean }[] = [
  { key: "weak-up", label: (n) => `Which weak ${n} are turning up?`, summary: "weak and turning up", pred: (rs, m) => rs < 50 && m > 0 },
  { key: "strong-up", label: (n) => `Which strong ${n} are picking up steam?`, summary: "strong and picking up steam", pred: (rs, m) => rs >= 50 && m > 0 },
  { key: "strong-down", label: (n) => `Which strong ${n} are losing steam?`, summary: "strong but losing steam", pred: (rs, m) => rs >= 50 && m < 0 },
  { key: "weak-down", label: (n) => `Which weak ${n} are still falling?`, summary: "weak and still falling", pred: (rs, m) => rs < 50 && m < 0 },
  { key: "strong-flat", label: (n) => `Which ${n} have stayed strong all month?`, summary: "that stayed strong all month", pred: (rs, m) => rs >= 50 && Math.abs(m) <= 1 },
  { key: "weak-flat", label: (n) => `Which ${n} have stayed weak all month?`, summary: "that stayed weak all month", pred: (rs, m) => rs < 50 && Math.abs(m) <= 1 },
];

const QUESTIONS: QuestionDef[] = Q_LEVEL_NOUN.flatMap(({ level, noun }) =>
  Q_BASE.map((q) => ({ id: `${q.key}-${level}`, level, label: q.label(noun), summary: q.summary, pred: q.pred })),
);

// ---------------------------------------------------------------- quadrant map

interface Dot {
  id: string;
  name: string;
  rs: number;
  mom: number;
  prev: { rs: number; mom: number } | null;
  count: number;
  quad: Quad;
  dim?: boolean;
}

function QuadrantMap({
  dots, selectedId, hoverId, onHover, onSelect, showTrails, mob,
}: {
  dots: Dot[];
  selectedId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  showTrails: boolean;
  mob: boolean;
}) {
  const W = mob ? 380 : 780, H = mob ? 430 : 540;
  const x0 = mob ? 14 : 26, x1 = W - 14, yT = 26, yB = H - 34;
  const rsVals = dots.map((d) => d.rs);
  const xlo = Math.max(0, Math.min(40, Math.min(...rsVals) - 6));
  const xhi = Math.min(100, Math.max(60, Math.max(...rsVals) + 5));
  const dMax = Math.max(8, ...dots.map((d) => Math.abs(d.mom))) + 2;
  const sx = (rs: number) => x0 + (x1 - x0) * ((rs - xlo) / (xhi - xlo));
  const sy = (d: number) => yT + (yB - yT) * (1 - (d + dMax) / (2 * dMax));
  const cX = sx(50), cY = sy(0);

  const counts: Record<Quad, number> = { lead: 0, impr: 0, weak: 0, lag: 0 };
  for (const d of dots) counts[d.quad]++;

  // label placement — extremes first, collision-avoided
  const labeled = [...dots]
    .filter((d) => !d.dim)
    .sort((a, b) => Math.abs(b.mom) + b.rs / 2 - (Math.abs(a.mom) + a.rs / 2))
    .slice(0, mob ? 8 : 22);
  const labelSet = new Set(labeled.map((d) => d.id));
  const used: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const place = (d: Dot) => {
    const px = sx(d.rs), py = sy(d.mom);
    const right = px < (x0 + x1) / 2 || d.rs >= 50;
    const w = truncateName(d.name).length * (mob ? 4.8 : 5.9);
    const fs = mob ? 8 : 10;
    const offsets = [0, -fs - 2, fs + 4, -2 * fs - 6, 2 * fs + 8, -3 * fs - 10, 3 * fs + 12];
    const lx = right ? px + 8 : px - 8;
    let ly = py + 3.5;
    for (const off of offsets) {
      const y = py + 3.5 + off;
      const box = { x0: right ? lx : lx - w, x1: right ? lx + w : lx, y0: y - fs, y1: y + 3 };
      const collides = used.some((u) => box.x0 < u.x1 + 2 && box.x1 > u.x0 - 2 && box.y0 < u.y1 + 2 && box.y1 > u.y0 - 2);
      if (!collides) { ly = y; used.push(box); break; }
      if (off === offsets[offsets.length - 1]) used.push(box);
    }
    return { lx, ly, anchor: (right ? "start" : "end") as "start" | "end" };
  };

  const trailActive = (d: Dot) => showTrails || hoverId === d.id || selectedId === d.id;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Sector rotation quadrant map — relative strength vs RS momentum">
        {/* quadrant tints */}
        <rect x={cX} y={yT} width={x1 - cX} height={cY - yT} fill={QUAD.lead.color} opacity="0.05" />
        <rect x={x0} y={yT} width={cX - x0} height={cY - yT} fill={QUAD.impr.color} opacity="0.05" />
        <rect x={x0} y={cY} width={cX - x0} height={yB - cY} fill={QUAD.lag.color} opacity="0.05" />
        <rect x={cX} y={cY} width={x1 - cX} height={yB - cY} fill={QUAD.weak.color} opacity="0.05" />
        {/* center lines */}
        <line x1={cX} y1={yT} x2={cX} y2={yB} stroke="var(--tp-z700, #c6cbd1)" strokeWidth="1" strokeDasharray="5 5" />
        <line x1={x0} y1={cY} x2={x1} y2={cY} stroke="var(--tp-z700, #c6cbd1)" strokeWidth="1" strokeDasharray="5 5" />
        {/* corner captions with counts */}
        <g>
          <text x={x0 + 6} y={yT + 13} fontSize={mob ? 8.5 : 10} fontWeight="700" fill={QUAD.impr.color} letterSpacing="0.06em">TURNING UP {counts.impr}</text>
          <title>Turning up — {QUAD.impr.why}</title>
        </g>
        <g>
          <text x={x1 - 6} y={yT + 13} textAnchor="end" fontSize={mob ? 8.5 : 10} fontWeight="700" fill={QUAD.lead.color} letterSpacing="0.06em">POWERING UP {counts.lead}</text>
          <title>Powering up — {QUAD.lead.why}</title>
        </g>
        <g>
          <text x={x0 + 6} y={yB - 8} fontSize={mob ? 8.5 : 10} fontWeight="700" fill={QUAD.lag.color} letterSpacing="0.06em">FALLING BACK {counts.lag}</text>
          <title>Falling back — {QUAD.lag.why}</title>
        </g>
        <g>
          <text x={x1 - 6} y={yB - 8} textAnchor="end" fontSize={mob ? 8.5 : 10} fontWeight="700" fill={QUAD.weak.color} letterSpacing="0.06em">COOLING OFF {counts.weak}</text>
          <title>Cooling off — {QUAD.weak.why}</title>
        </g>
        {/* axis ticks + labels */}
        {[0, 25, 50, 75, 100].filter((v) => v >= xlo && v <= xhi).map((v) => (
          <text key={v} x={sx(v)} y={yB + 14} textAnchor="middle" fontSize={mob ? 8 : 9} fill="var(--tp-z500, #71717a)">{v}</text>
        ))}
        <text x={(x0 + x1) / 2} y={H - 3} textAnchor="middle" fontSize={mob ? 8.5 : 10} fill="var(--tp-z500, #71717a)">strength now (RS) →</text>
        <text
          x={10} y={(yT + yB) / 2} fontSize={mob ? 8.5 : 10} fill="var(--tp-z500, #71717a)"
          transform={`rotate(-90 10 ${(yT + yB) / 2})`} textAnchor="middle"
        >
          momentum (Δ vs last month) ↑
        </text>
        {/* trails — last month's position → now */}
        {dots.map((d) => {
          if (!d.prev || d.dim || !trailActive(d)) return null;
          const ax = sx(d.prev.rs), ay = sy(d.prev.mom), bx = sx(d.rs), by = sy(d.mom);
          return (
            <g key={`t-${d.id}`} pointerEvents="none">
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke={QUAD[d.quad].color} strokeWidth="1.3" opacity="0.45" />
              <circle cx={ax} cy={ay} r="2.6" fill="none" stroke={QUAD[d.quad].color} strokeWidth="1" opacity="0.6" />
            </g>
          );
        })}
        {/* dots + labels */}
        {dots.map((d) => {
          const px = sx(d.rs), py = sy(d.mom);
          const isSel = selectedId === d.id;
          const showLabel = (labelSet.has(d.id) && !d.dim) || isSel;
          const lbl = showLabel ? place(d) : null;
          return (
            <g
              key={d.id}
              opacity={d.dim ? 0.15 : 1}
              onClick={() => onSelect(d.id)}
              onMouseEnter={() => onHover(d.id)}
              onMouseLeave={() => onHover(null)}
              className="cursor-pointer"
            >
              <title>{`${d.name} — RS ${d.rs} · ${d.mom >= 0 ? "+" : ""}${d.mom} RS this month${d.count > 1 ? ` · ${d.count} stocks` : ""} — click to open`}</title>
              <circle cx={px} cy={py} r={isSel ? (mob ? 7 : 8) : mob ? 4.5 : 5.5} fill={QUAD[d.quad].color} fillOpacity="0.85" stroke={isSel ? "var(--tp-z100, #ffffff)" : "none"} strokeWidth="1.5" />
              <circle cx={px} cy={py} r={12} fill="transparent" />
              {lbl && (
                <text
                  x={lbl.lx} y={lbl.ly} textAnchor={lbl.anchor}
                  fontSize={mob ? 8 : 10} fontWeight={isSel ? 700 : 500}
                  fill="var(--tp-z300, #52525b)"
                  stroke="var(--tp-z950, #ffffff)" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round"
                >
                  {truncateName(d.name)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- ranked list

interface ListItem {
  key: string;
  id: string;
  name: string;
  rs: number;
  mom: number | null;
  group?: GroupRow;
  stock?: StockRow;
}

function RotationList({
  items, sort, onSort, label, onOpen, selectedId, total,
}: {
  items: ListItem[];
  sort: "chg" | "rs";
  onSort: (s: "chg" | "rs") => void;
  label: string;
  onOpen: (item: ListItem) => void;
  selectedId: string | null;
  total: number;
}) {
  return (
    <div className="flex max-h-[320px] flex-col overflow-hidden lg:max-h-[640px]">
      {/* header row — same grid as the body rows so columns always align */}
      <div className="grid shrink-0 grid-cols-[30px_minmax(0,1fr)_42px_58px] items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2.5 py-2 text-[9px] uppercase tracking-wider text-zinc-500">
        <span>#</span>
        <span>{label}</span>
        <button
          onClick={() => onSort("rs")}
          className={cn("cursor-pointer text-right uppercase tracking-wider hover:text-brand-text", sort === "rs" && "font-bold text-zinc-100")}
        >
          RS
        </button>
        <button
          onClick={() => onSort("chg")}
          className={cn("cursor-pointer text-right uppercase tracking-wider hover:text-brand-text", sort === "chg" && "font-bold text-zinc-100")}
        >
          Change{sort === "chg" ? " ↓" : ""}
        </button>
      </div>
      <div className="tp-scroll flex-1 overflow-y-auto">
        {items.map((it, i) => (
          <button
            key={it.key}
            onClick={() => onOpen(it)}
            className={cn(
              "grid w-full grid-cols-[30px_minmax(0,1fr)_42px_58px] items-center gap-1 border-b border-zinc-800/60 px-2.5 py-2 text-left last:border-0 transition-colors hover:bg-zinc-800/40",
              selectedId === it.id && "bg-brand/5",
            )}
          >
            <span className="font-mono text-[10px] text-zinc-500">{i + 1}</span>
            <span className="truncate text-xs font-medium text-zinc-200" title={it.name}>{it.name}</span>
            <span className="text-right font-mono text-xs text-zinc-300">{it.rs}</span>
            <span className={cn("text-right font-mono text-xs font-semibold", (it.mom ?? 0) >= 0 ? "text-profit" : "text-loss")}>
              {it.mom == null ? "—" : `${it.mom >= 0 ? "+" : ""}${it.mom % 1 === 0 ? it.mom.toFixed(0) : it.mom.toFixed(1)}`}
            </span>
          </button>
        ))}
        {items.length === 0 && (
          <div className="px-4 py-10 text-center text-[11px] text-zinc-500">
            {total === 0 ? "RS ranks are still filling in — check back after the next sync." : "Nothing matches these filters."}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- detail drawer (reference-style)

interface DrawerTarget {
  level: "industry" | "subgroup";
  name: string;
}

function Spark({ values }: { values?: number[] }) {
  if (!values || values.length < 2) return <div className="mt-2 h-9 rounded bg-zinc-800/50" />;
  const min = Math.min(...values), max = Math.max(...values);
  const rng = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${34 - ((v - min) / rng) * 30}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="mt-2 h-9 w-full">
      <polyline
        points={pts} fill="none"
        stroke={up ? "var(--profit, #0F9D58)" : "var(--loss, #D64545)"}
        strokeWidth="1.5" vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function RotationDrawer({
  data, target, onClose, onSelectStock,
}: {
  data: SectorPayload;
  target: DrawerTarget;
  onClose: () => void;
  onSelectStock: (s: string) => void;
}) {
  const [quadFilter, setQuadFilter] = useState<"all" | Quad>("all");
  const [sort, setSort] = useState<"rs" | "chg">("rs");
  const [view, setView] = useState<"list" | "charts">("list");
  const [drillSub, setDrillSub] = useState<string | null>(null);
  const mob = useIsMobile();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const effLevel = drillSub ? "subgroup" : target.level;
  const groupName = drillSub ?? target.name;
  const group = data.levels[effLevel === "industry" ? "industry" : "subgroup"].find((g) => g.name === groupName);
  const subInd = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data.taxonomy.subGroupsByIndustry) for (const s of g.subgroups) m.set(s, g.industry);
    return m;
  }, [data]);

  const members = useMemo(() => {
    if (effLevel === "subgroup") return data.stocks.filter((s) => s.subGrp === groupName);
    return data.stocks.filter((s) => s.indGrp === groupName);
  }, [data, effLevel, groupName]);

  const chipCounts = useMemo(() => {
    const c: Record<Quad, number> = { lead: 0, impr: 0, weak: 0, lag: 0 };
    for (const s of members) {
      if (s.rs == null || s.mom == null) continue;
      c[quadOf(s.rs, s.mom)]++;
    }
    return c;
  }, [members]);

  const shown = useMemo(() => {
    let rows = members;
    if (quadFilter !== "all") rows = rows.filter((s) => s.rs != null && s.mom != null && quadOf(s.rs, s.mom) === quadFilter);
    const arr = [...rows];
    if (sort === "rs") arr.sort((a, b) => (b.rs ?? -1) - (a.rs ?? -1));
    else arr.sort((a, b) => Math.abs(b.mom ?? -99) - Math.abs(a.mom ?? -99));
    return arr;
  }, [members, quadFilter, sort]);

  const rankMap = useMemo(() => {
    const m = new Map<string, number>();
    [...data.stocks]
      .filter((s) => s.rs != null)
      .sort((a, b) => (b.rs as number) - (a.rs as number))
      .forEach((s, i) => m.set(s.symbol, i + 1));
    return m;
  }, [data]);

  const totalAtLevel = data.levels[effLevel === "industry" ? "industry" : "subgroup"].filter((g) => g.avgRs != null).length;
  const subOptions = effLevel === "industry"
    ? (data.taxonomy.subGroupsByIndustry.find((x) => x.industry === groupName)?.subgroups ?? [])
    : [];

  const sparkSymbols = view === "charts" ? shown.slice(0, 60).map((s) => s.symbol).join(",") : "";
  const { data: sparkData } = useQuery<{ sparks: Record<string, number[]> }>({
    queryKey: ["sector-sparks", sparkSymbols],
    queryFn: async () => {
      const res = await fetch(`/api/market/sectors/spark?symbols=${encodeURIComponent(sparkSymbols)}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: view === "charts" && sparkSymbols.length > 0,
    staleTime: 10 * 60_000,
  });

  if (!group) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={`${groupName} detail`}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="tp-scroll absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 shadow-2xl duration-200 animate-in slide-in-from-right">
        {/* header */}
        <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-sm font-bold text-zinc-100">
              {effLevel === "subgroup" && (
                <>
                  <span className="text-zinc-500">{subInd.get(groupName)}</span>
                  <ChevronRight className="mx-0.5 inline h-3 w-3 text-zinc-400" />
                </>
              )}
              {groupName}
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {group.count} names in our universe
            {group.rank != null && (
              <> · ranked <span className="font-semibold text-zinc-200">{group.rank} of {totalAtLevel}</span> {effLevel === "industry" ? "industries" : "subgroups"} by RS rating</>
            )}
          </div>
          {target.level === "industry" && subOptions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <select
                  value={drillSub ?? ""}
                  onChange={(e) => setDrillSub(e.target.value || null)}
                  className="h-7 max-w-60 cursor-pointer appearance-none rounded-md border border-zinc-700 bg-zinc-900 pl-2 pr-6 text-[11px] font-medium text-zinc-200 outline-none focus:border-brand"
                >
                  <option value="">Pick a subgroup…</option>
                  {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
              </div>
              {drillSub && (
                <button className="text-[10px] text-zinc-400 hover:text-zinc-300" onClick={() => setDrillSub(null)}>× back to industry</button>
              )}
            </div>
          )}
        </div>

        {/* quadrant chips */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
          <button
            onClick={() => setQuadFilter("all")}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
              quadFilter === "all" ? "bg-brand text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800/50"
            )}
          >
            All {members.length}
          </button>
          {QUAD_LIST.map((q) => (
            <button
              key={q}
              onClick={() => setQuadFilter(quadFilter === q ? "all" : q)}
              title={QUAD[q].why}
              className={cn(
                "cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                quadFilter === q ? "text-white" : "border text-zinc-300 hover:bg-zinc-800/50"
              )}
              style={quadFilter === q ? { background: QUAD[q].color } : { borderColor: `${QUAD[q].color}55`, color: quadFilter === q ? "#fff" : undefined }}
            >
              {quadFilter === q && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-white/80" />}
              {!quadFilter || quadFilter !== q ? <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: QUAD[q].color }} /> : null}
              {QUAD[q].name} {chipCounts[q]}
            </button>
          ))}
        </div>

        {/* sort + view controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">RS rating</span>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-zinc-700">
              {([
                { id: "rs", label: "Strongest" },
                { id: "chg", label: "Biggest change (1 mo)" },
              ] as const).map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSort(o.id)}
                  className={cn(
                    "cursor-pointer px-2 py-1 text-[10px] font-semibold transition-colors",
                    sort === o.id ? "bg-brand text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-md border border-zinc-700">
              {(["list", "charts"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "cursor-pointer px-2 py-1 text-[10px] font-semibold capitalize transition-colors",
                    view === v ? "bg-brand text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* member cards */}
        <div className={cn("grid gap-2 p-3", mob ? "grid-cols-1" : "grid-cols-2")}>
          {shown.map((s) => {
            const ranked = s.rs != null && s.mom != null;
            const q = ranked ? quadOf(s.rs as number, s.mom as number) : null;
            const rk = rankMap.get(s.symbol);
            return (
              <button
                key={s.symbol}
                onClick={() => onSelectStock(s.symbol)}
                className="rounded-xl border border-zinc-800 p-2.5 text-left transition-colors hover:border-brand/50"
              >
                <div className="flex items-center gap-1.5">
                  {rk != null && (
                    <span className="shrink-0 rounded bg-gold/15 px-1 font-mono text-[9px] font-bold text-gold-text">#{rk}</span>
                  )}
                  <span className="truncate text-xs font-semibold text-zinc-100">{s.symbol.replace(".NS", "")}</span>
                </div>
                <div className="truncate text-[10px] text-zinc-500">{s.name}</div>
                {ranked && q ? (
                  <>
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <span className="font-mono text-[11px] text-zinc-300">
                        RS {s.rs}{" "}
                        <span className={(s.mom as number) >= 0 ? "text-profit" : "text-loss"}>
                          ({(s.mom as number) >= 0 ? "+" : ""}{s.mom})
                        </span>
                      </span>
                      <QuadTag q={q} />
                    </div>
                    {view === "charts" && <Spark values={sparkData?.sparks[s.symbol]} />}
                  </>
                ) : (
                  <div className="mt-1.5 text-[10px] italic text-zinc-500" title={s.status === "young" ? "Too little price history for a reliable RS rating" : "Market cap below the ranking floor"}>
                    {s.status === "young" ? "not ranked yet — needs ~1 yr of trading" : s.status === "illiquid" ? "too illiquid to rank" : "not ranked"}
                  </div>
                )}
              </button>
            );
          })}
          {shown.length === 0 && (
            <div className="col-span-full py-8 text-center text-[11px] text-zinc-500">No names in this quadrant.</div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- sector rotation (the reference page)

function FilterSelect({ value, onChange, children, ariaLabel }: { value: string; onChange: (v: string) => void; children: React.ReactNode; ariaLabel: string }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="h-8 max-w-56 cursor-pointer appearance-none rounded-lg border border-zinc-700 bg-zinc-900 pl-2.5 pr-7 text-xs font-medium text-zinc-200 outline-none transition-colors focus:border-brand"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  );
}

function LevelTabs({
  level, onChange, isPro, onUpgrade,
}: {
  level: Level;
  onChange: (l: Level) => void;
  isPro: boolean;
  onUpgrade?: () => void;
}) {
  const items: { id: Level; label: string }[] = [
    { id: "industry", label: "Industries" },
    { id: "subgroup", label: "Subgroups" },
    { id: "stock", label: "Stocks" },
  ];
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-zinc-700">
      {items.map((it) => {
        const locked = it.id === "stock" && !isPro;
        const active = level === it.id;
        return (
          <button
            key={it.id}
            onClick={() => {
              if (locked) { onUpgrade?.(); return; }
              onChange(it.id);
            }}
            title={locked ? "The Stocks level is a Pro feature" : undefined}
            className={cn(
              "cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-brand text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200",
              locked && "opacity-60",
            )}
          >
            {it.label}
            {locked && <Lock className="ml-1 inline h-3 w-3" />}
          </button>
        );
      })}
    </div>
  );
}

export function SectorRotation({
  data, onSelectStock, isPro = false, onUpgrade, onOpenWatchlist,
}: {
  data: SectorPayload;
  onSelectStock: (s: string) => void;
  isPro?: boolean;
  onUpgrade?: () => void;
  onOpenWatchlist?: () => void;
}) {
  const mob = useIsMobile();
  const [level, setLevel] = useState<Level>("industry");
  const [industry, setIndustry] = useState("");
  const [sub, setSub] = useState("");
  const [query, setQuery] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [sort, setSort] = useState<"chg" | "rs">("chg");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const question = QUESTIONS.find((q) => q.id === questionId) ?? null;
  const effLevel: Level = question ? question.level : level;

  const subInd = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data.taxonomy.subGroupsByIndustry) for (const s of g.subgroups) m.set(s, g.industry);
    return m;
  }, [data]);

  const matchSets = useMemo(() => {
    const ql = query.trim().toLowerCase();
    if (!ql) return null;
    const subs = new Set<string>(), inds = new Set<string>(), syms = new Set<string>();
    for (const s of data.stocks) {
      if (s.symbol.replace(".NS", "").toLowerCase().includes(ql) || s.name.toLowerCase().includes(ql)) {
        syms.add(s.symbol);
        subs.add(s.subGrp);
        inds.add(s.indGrp);
      }
    }
    return { subs, inds, syms, ql };
  }, [query, data]);

  const groups: GroupRow[] = effLevel === "stock" ? [] : data.levels[effLevel];

  const dots: Dot[] = useMemo(() => {
    if (effLevel === "stock") {
      return data.stocks
        .filter((s) => s.rs != null && s.mom != null)
        .filter((s) => !industry || s.indGrp === industry)
        .filter((s) => !sub || s.subGrp === sub)
        .map((s) => ({
          id: s.symbol,
          name: s.symbol.replace(".NS", ""),
          rs: s.rs as number,
          mom: s.mom as number,
          prev: null,
          count: 1,
          quad: quadOf(s.rs as number, s.mom as number),
          dim: matchSets ? !(matchSets.syms.has(s.symbol)) : false,
        }));
    }
    return groups
      .filter((g) => g.avgRs != null && g.mom != null)
      .filter((g) => (effLevel === "industry" ? !industry || g.name === industry : (!sub || g.name === sub) && (!industry || subInd.get(g.name) === industry)))
      .map((g) => ({
        id: g.name,
        name: g.name,
        rs: g.avgRs as number,
        mom: g.mom as number,
        prev: g.prev,
        count: g.count,
        quad: quadOf(g.avgRs as number, g.mom as number),
        dim: matchSets
          ? !(effLevel === "industry"
            ? matchSets.inds.has(g.name) || g.name.toLowerCase().includes(matchSets.ql)
            : matchSets.subs.has(g.name) || g.name.toLowerCase().includes(matchSets.ql))
          : false,
      }));
  }, [effLevel, groups, data, industry, sub, subInd, matchSets]);

  const listItems: ListItem[] = useMemo(() => {
    const bySort = (arr: ListItem[]) =>
      sort === "rs" ? [...arr].sort((a, b) => b.rs - a.rs) : [...arr].sort((a, b) => (b.mom ?? -99) - (a.mom ?? -99));
    if (effLevel === "stock") {
      let rows = data.stocks.filter((s) => s.rs != null && s.mom != null);
      if (industry) rows = rows.filter((s) => s.indGrp === industry);
      if (sub) rows = rows.filter((s) => s.subGrp === sub);
      if (matchSets) rows = rows.filter((s) => matchSets.syms.has(s.symbol));
      if (question) rows = rows.filter((s) => question.pred(s.rs as number, s.mom as number));
      return bySort(rows.map((s) => ({ key: s.symbol, id: s.symbol, name: s.symbol.replace(".NS", ""), rs: s.rs as number, mom: s.mom, stock: s })));
    }
    let gs = groups.filter((g) => g.avgRs != null && g.mom != null);
    if (effLevel === "industry" && industry) gs = gs.filter((g) => g.name === industry);
    if (effLevel === "subgroup") {
      if (sub) gs = gs.filter((g) => g.name === sub);
      if (industry) gs = gs.filter((g) => subInd.get(g.name) === industry);
    }
    if (matchSets) {
      gs = gs.filter((g) =>
        effLevel === "industry"
          ? matchSets.inds.has(g.name) || g.name.toLowerCase().includes(matchSets.ql)
          : matchSets.subs.has(g.name) || g.name.toLowerCase().includes(matchSets.ql));
    }
    if (question) gs = gs.filter((g) => question.pred(g.avgRs as number, g.mom as number));
    return bySort(gs.map((g) => ({ key: g.name, id: g.name, name: g.name, rs: g.avgRs as number, mom: g.mom, group: g })));
  }, [effLevel, groups, data, industry, sub, subInd, matchSets, question, sort]);

  const openItem = (it: ListItem) => {
    setSelectedId(it.id);
    if (effLevel === "stock") onSelectStock(it.id);
    else setDrawer({ level: it.id === it.name && it.group ? it.group.level as "industry" | "subgroup" : (effLevel as "industry" | "subgroup"), name: it.id });
  };

  const openDot = (id: string) => {
    setSelectedId(id);
    if (effLevel === "stock") onSelectStock(id);
    else setDrawer({ level: effLevel as "industry" | "subgroup", name: id });
  };

  const entityNoun = effLevel === "stock" ? "stock" : effLevel === "subgroup" ? "subgroup" : "industry";

  return (
    <div className="space-y-3">
      {/* headline — reference copy */}
      <div>
        <h2 className="text-lg font-bold tracking-tight text-zinc-100">Which way each {entityNoun} is heading</h2>
        <p className="text-xs text-zinc-500">RS strength now vs momentum over the last month</p>
      </div>

      {/* filter row — industry · subgroup · search · level tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect ariaLabel="Filter by industry" value={industry} onChange={(v) => { setIndustry(v); if (effLevel === "industry" && sub) setSub(""); }}>
          <option value="">All industries ({data.taxonomy.industries.length})</option>
          {data.taxonomy.industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </FilterSelect>
        <FilterSelect ariaLabel="Filter by subgroup" value={sub} onChange={(v) => setSub(v)}>
          <option value="">All subgroups ({data.taxonomy.subGroupsByIndustry.reduce((a, b) => a + b.subgroups.length, 0)})</option>
          {data.taxonomy.subGroupsByIndustry
            .filter((g) => !industry || g.industry === industry)
            .map((g) => (
              <optgroup key={g.industry} label={g.industry}>
                {g.subgroups.map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
        </FilterSelect>
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a stock on the map"
            className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 pl-8 pr-2 text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-500 focus:border-brand"
          />
        </div>
        <LevelTabs
          level={level}
          onChange={(l) => { setLevel(l); setQuestionId(""); setSelectedId(null); }}
          isPro={isPro}
          onUpgrade={onUpgrade}
        />
      </div>

      {/* hint line + question picker */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span>Each dot is an {entityNoun} — tap to open it.</span>
          <span className="inline-flex items-center gap-1">
            Trails show last month&apos;s position
            <button
              onClick={() => setHelpOpen((v) => !v)}
              aria-label="How to read the map"
              className="cursor-pointer rounded-full text-zinc-400 hover:text-zinc-500 hover:text-zinc-300"
            >
              <Info className="h-3 w-3" />
            </button>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {question && (
            <button
              onClick={() => setQuestionId("")}
              className="cursor-pointer text-[11px] text-zinc-400 hover:text-zinc-500 hover:text-zinc-300"
            >
              × Clear
            </button>
          )}
          <div className="relative">
            <select
              value={questionId}
              onChange={(e) => {
                setQuestionId(e.target.value);
                const q = QUESTIONS.find((x) => x.id === e.target.value);
                if (q) { setLevel(q.level); setSelectedId(null); }
              }}
              aria-label="Ask a question"
              className="h-8 max-w-64 cursor-pointer appearance-none rounded-lg border border-zinc-700 bg-zinc-900 pl-2.5 pr-7 text-xs font-medium text-zinc-200 outline-none focus:border-brand"
            >
              <option value="">Ask a question…</option>
              {QUESTIONS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      {question && (
        <p className="text-[11px] text-zinc-500">
          <span className="font-semibold text-zinc-200">{listItems.length}</span> {question.summary} — tap a row to open it
        </p>
      )}

      {helpOpen && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-[11px] leading-5 text-zinc-300">
          <div className="mb-1.5 font-semibold text-zinc-100">How to read the map</div>
          <div className="grid gap-1 sm:grid-cols-2">
            {QUAD_LIST.map((q) => (
              <div key={q} className="flex items-start gap-1.5">
                <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: QUAD[q].color }} />
                <span><b style={{ color: QUAD[q].color }}>{QUAD[q].name}</b> — {QUAD[q].why}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-zinc-500">
            Right = stronger RS now, up = gaining RS vs last month. Hover a dot to trace its path from where it sat a month ago.
          </div>
        </div>
      )}

      {/* main card — ranked list + quadrant map */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="grid gap-0 p-0 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="order-2 border-t border-zinc-800 lg:order-1 lg:border-r lg:border-t-0">
            <RotationList
              items={listItems}
              sort={sort}
              onSort={setSort}
              label={entityNoun.toUpperCase()}
              onOpen={openItem}
              selectedId={selectedId}
              total={dots.length}
            />
          </div>
          <div className="order-1 p-3 lg:order-2 lg:p-4">
            {dots.length === 0 ? (
              <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-xs text-zinc-500">
                RS ranks are still filling in — check back after the next sync.
              </div>
            ) : (
              <>
                <QuadrantMap
                  dots={dots}
                  selectedId={selectedId}
                  hoverId={hoverId}
                  onHover={setHoverId}
                  onSelect={openDot}
                  showTrails={!!question}
                  mob={mob}
                />
                <div className="px-1 pt-1.5 text-[10px] text-zinc-500">Tap a dot to read the rest</div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* watchlist CTA — reference banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Star className="h-4 w-4 shrink-0 text-gold-text" />
          <span><b className="text-zinc-100">Where do your stocks sit on this map?</b> Add your holdings to see their strength, leaders, and rotation — private to you.</span>
        </div>
        {onOpenWatchlist && (
          <button onClick={onOpenWatchlist} className="cursor-pointer text-xs font-semibold text-brand-text hover:underline">
            Build your watchlist →
          </button>
        )}
      </div>

      {data.updatedAt && (
        <div className="text-[10px] text-zinc-400">Updated · {data.updatedAt.slice(0, 10)}</div>
      )}

      {drawer && (
        <RotationDrawer
          data={data}
          target={drawer}
          onClose={() => setDrawer(null)}
          onSelectStock={onSelectStock}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sector strength

export function SectorStrength({
  data, onSelectStock, isPro = false, onUpgrade,
}: {
  data: SectorPayload;
  onSelectStock: (s: string) => void;
  isPro?: boolean;
  onUpgrade?: () => void;
}) {
  const [level, setLevel] = useState<Level>("industry");
  const [industry, setIndustry] = useState("");
  const [sub, setSub] = useState("");
  const [quadFilter, setQuadFilter] = useState<"all" | Quad>("all");
  const [sort, setSort] = useState<"rs" | "chg">("rs");
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

  const subInd = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data.taxonomy.subGroupsByIndustry) for (const s of g.subgroups) m.set(s, g.industry);
    return m;
  }, [data]);

  const base = useMemo(() => {
    if (level === "stock") {
      let rows = data.stocks.filter((s) => s.rs != null && s.mom != null);
      if (industry) rows = rows.filter((s) => s.indGrp === industry);
      if (sub) rows = rows.filter((s) => s.subGrp === sub);
      return rows.map((s) => ({
        id: s.symbol,
        name: s.symbol.replace(".NS", ""),
        fullName: s.name,
        rs: s.rs as number,
        mom: s.mom as number,
        quad: quadOf(s.rs as number, s.mom as number),
        stock: s,
        group: null as GroupRow | null,
      }));
    }
    let gs = data.levels[level].filter((g) => g.avgRs != null && g.mom != null);
    if (level === "industry" && industry) gs = gs.filter((g) => g.name === industry);
    if (level === "subgroup") {
      if (sub) gs = gs.filter((g) => g.name === sub);
      if (industry) gs = gs.filter((g) => subInd.get(g.name) === industry);
    }
    return gs.map((g) => ({
      id: g.name,
      name: g.name,
      fullName: g.name,
      rs: g.avgRs as number,
      mom: g.mom as number,
      quad: quadOf(g.avgRs as number, g.mom as number),
      stock: null as StockRow | null,
      group: g,
    }));
  }, [level, data, industry, sub, subInd]);

  const chipCounts = useMemo(() => {
    const c: Record<Quad, number> = { lead: 0, impr: 0, weak: 0, lag: 0 };
    for (const r of base) c[r.quad]++;
    return c;
  }, [base]);

  const rows = useMemo(() => {
    const filtered = quadFilter === "all" ? base : base.filter((r) => r.quad === quadFilter);
    return [...filtered].sort((a, b) => (sort === "rs" ? b.rs - a.rs : Math.abs(b.mom) - Math.abs(a.mom)));
  }, [base, quadFilter, sort]);

  const openRow = (r: (typeof rows)[number]) => {
    if (r.stock) { onSelectStock(r.stock.symbol); return; }
    setDrawer({ level: level === "subgroup" ? "subgroup" : "industry", name: r.id });
  };

  const entityNoun = level === "stock" ? "stocks" : level === "subgroup" ? "subgroups" : "industries";

  return (
    <div className="space-y-3">
      {/* filter row — same options as the rotation page */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect ariaLabel="Filter by industry" value={industry} onChange={(v) => { setIndustry(v); if (sub) setSub(""); }}>
          <option value="">All industries ({data.taxonomy.industries.length})</option>
          {data.taxonomy.industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </FilterSelect>
        <FilterSelect ariaLabel="Filter by subgroup" value={sub} onChange={(v) => setSub(v)}>
          <option value="">All subgroups ({data.taxonomy.subGroupsByIndustry.reduce((a, b) => a + b.subgroups.length, 0)})</option>
          {data.taxonomy.subGroupsByIndustry
            .filter((g) => !industry || g.industry === industry)
            .map((g) => (
              <optgroup key={g.industry} label={g.industry}>
                {g.subgroups.map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
        </FilterSelect>
        <div className="flex-1" />
        <LevelTabs
          level={level}
          onChange={(l) => { setLevel(l); setQuadFilter("all"); }}
          isPro={isPro}
          onUpgrade={onUpgrade}
        />
      </div>

      {/* quadrant chips + sort — the reference's strength controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setQuadFilter("all")}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
              quadFilter === "all" ? "bg-brand text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800/50"
            )}
          >
            All {base.length}
          </button>
          {QUAD_LIST.map((q) => (
            <button
              key={q}
              onClick={() => setQuadFilter(quadFilter === q ? "all" : q)}
              title={QUAD[q].why}
              className={cn(
                "cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                quadFilter === q ? "text-white" : "border text-zinc-300 hover:bg-zinc-800/50"
              )}
              style={quadFilter === q ? { background: QUAD[q].color } : { borderColor: `${QUAD[q].color}55` }}
            >
              {!quadFilter || quadFilter !== q ? <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: QUAD[q].color }} /> : null}
              {QUAD[q].name} {chipCounts[q]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">Rank by</span>
          <div className="flex overflow-hidden rounded-md border border-zinc-700">
            {([
              { id: "rs", label: "Strongest now" },
              { id: "chg", label: "Biggest change (1 mo)" },
            ] as const).map((o) => (
              <button
                key={o.id}
                onClick={() => setSort(o.id)}
                className={cn(
                  "cursor-pointer px-2.5 py-1 text-[10px] font-semibold transition-colors",
                  sort === o.id ? "bg-brand text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ranked rows */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-0">
          <div className="divide-y divide-zinc-800/60">
            {rows.slice(0, level === "stock" ? 30 : 80).map((r, i) => (
              <div key={r.id} className="px-4 py-3" onClick={() => openRow(r)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 cursor-pointer items-center gap-2">
                    <span className="w-6 shrink-0 font-mono text-[10px] text-zinc-400">{i + 1}</span>
                    <span className="truncate text-xs font-semibold text-zinc-100 hover:underline" title={r.fullName}>{r.name}</span>
                    <QuadTag q={r.quad} />
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="font-bold text-zinc-100">RS {r.rs}</span>
                    <span className={r.mom >= 0 ? "text-profit" : "text-loss"}>
                      {r.mom >= 0 ? "+" : ""}{r.mom} RS/mo
                    </span>
                    {r.stock && <span className={changeColor(r.stock.changePct)}>{fmtPct(r.stock.changePct, 1)}</span>}
                  </div>
                </div>
                {/* RS bar with the 50 midline */}
                <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-600" />
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, r.rs))}%`, background: QUAD[r.quad].color, opacity: 0.75 }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                  <span>
                    {r.group
                      ? `${r.group.ranked} ranked · ${r.group.count} total${r.group.leaders.length > 0 ? " · leaders " : ""}`
                      : r.stock?.name}
                    {r.group?.leaders.slice(0, 3).map((l) => (
                      <button
                        key={l.symbol}
                        onClick={(e) => { e.stopPropagation(); onSelectStock(l.symbol); }}
                        className="ml-1.5 cursor-pointer rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300 hover:text-brand-text"
                      >
                        {l.symbol.replace(".NS", "")} {l.rs}
                      </button>
                    ))}
                  </span>
                  <span className="text-zinc-500">{entityNoun} by RS rating</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-zinc-500">RS ranks are still filling in — check back after the next sync.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {data.updatedAt && (
        <div className="text-[10px] text-zinc-400">Updated · {data.updatedAt.slice(0, 10)}</div>
      )}

      {drawer && (
        <RotationDrawer
          data={data}
          target={drawer}
          onClose={() => setDrawer(null)}
          onSelectStock={onSelectStock}
        />
      )}
    </div>
  );
}
