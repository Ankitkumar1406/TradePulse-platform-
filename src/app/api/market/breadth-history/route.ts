import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FNO_UNIVERSE } from "@/lib/fno-universe";
import { loadBreadthHistory } from "@/lib/breadth-history";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Breadth history & breakdowns for the Market breadth page.
 *
 * - history: per-session advances/declines, SMA-20/50/200 participation and
 *   52w highs/lows counts for the last ~130 full sessions. Computed in
 *   src/lib/breadth-history.ts — cached in module memory, warmed at server
 *   boot by the scheduler, and served stale-while-revalidate after that, so
 *   this endpoint answers instantly except on a truly cold first boot.
 * - sectors: % of stocks above SMA-20/50 per sector + advances/declines today.
 * - segments: AMFI-style Large (top 100 by mcap) / Mid (101-250) / Small
 *   (rest) breadth so large-vs-small divergence is visible.
 * - fno: breadth for the (approximate) F&O universe vs the rest.
 * - asOf: quote stamp of the current snapshot (SyncState-equivalent).
 *
 * The breakdown refreshes every 60 s (module cache).
 */

interface Breakdown {
  count: number;
  adv: number;
  dec: number;
  above20: number;
  above50: number;
  above200: number;
  pctAbove20: number;
  pctAbove50: number;
  pctAbove200: number;
}

function summarize(rows: StockRow[]): Breakdown {
  const adv = rows.filter((r) => (r.changePct ?? 0) > 0.05).length;
  const dec = rows.filter((r) => (r.changePct ?? 0) < -0.05).length;
  const above20 = rows.filter((r) => r.aboveSma20 === true).length;
  const above50 = rows.filter((r) => r.aboveSma50 === true).length;
  const above200 = rows.filter((r) => r.aboveSma200 === true).length;
  const n = rows.length || 1;
  return {
    count: rows.length,
    adv,
    dec,
    above20,
    above50,
    above200,
    pctAbove20: Math.round((above20 / n) * 100),
    pctAbove50: Math.round((above50 / n) * 100),
    pctAbove200: Math.round((above200 / n) * 100),
  };
}

interface StockRow {
  symbol: string;
  sector: string | null;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  aboveSma20: boolean | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
}

const g = globalThis as unknown as {
  __breakdownCache?: { at: number; data: unknown };
};

async function loadBreakdown() {
  const cached = g.__breakdownCache;
  if (cached && Date.now() - cached.at < 60_000) return cached.data as ReturnType<typeof computeBreakdown>;

  const data = await computeBreakdown();
  g.__breakdownCache = { at: Date.now(), data };
  return data;
}

async function computeBreakdown() {
  const stocks: StockRow[] = await db.stock.findMany({
    where: { price: { not: null }, changePct: { not: null } },
    select: {
      symbol: true, sector: true, price: true, changePct: true, marketCap: true,
      aboveSma20: true, aboveSma50: true, aboveSma200: true,
    },
  });

  // AMFI-style cap segments: top 100 by mcap = Large, 101-250 = Mid, rest = Small.
  const ranked = [...stocks]
    .filter((s) => s.marketCap != null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const rank = new Map<string, number>();
  ranked.forEach((s, i) => rank.set(s.symbol, i));

  const segments = {
    large: summarize(ranked.slice(0, 100)),
    mid: summarize(ranked.slice(100, 250)),
    small: summarize(ranked.slice(250)),
  };

  const fnoRows = stocks.filter((s) => FNO_UNIVERSE.has(s.symbol.replace(".NS", "")));
  const fnoSet = new Set(fnoRows.map((s) => s.symbol));
  const restRows = stocks.filter((s) => !fnoSet.has(s.symbol));
  const fno = { fno: summarize(fnoRows), rest: summarize(restRows) };

  // Sector breadth — % above SMA per sector, today's advances/declines.
  const bySector = new Map<string, StockRow[]>();
  for (const s of stocks) {
    if (!s.sector || s.sector === "Unknown") continue;
    const list = bySector.get(s.sector) ?? [];
    list.push(s);
    bySector.set(s.sector, list);
  }
  const sectors = [...bySector.entries()]
    .map(([sector, rows]) => ({ sector, ...summarize(rows) }))
    .sort((a, b) => b.pctAbove50 - a.pctAbove50);

  const asOf = await db.stock.aggregate({ _max: { quoteTime: true } });

  return {
    sectors,
    segments,
    fno,
    asOf: asOf._max.quoteTime ? asOf._max.quoteTime.toISOString() : null,
  };
}

export async function GET() {
  try {
    const [{ history, lastFullDate }, breakdown] = await Promise.all([loadBreadthHistory(), loadBreakdown()]);
    return NextResponse.json({ history, lastFullDate, ...breakdown });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "breadth history failed" },
      { status: 500 },
    );
  }
}
