/**
 * Sector momentum — multi-timeframe RSI (daily / weekly / monthly, RSI-14)
 * for NSE indices and DB sectors, classified with the shared taxonomy in
 * momentum-classes.ts (see that file for the strength buckets).
 *
 * Data sources:
 *  - NSE indices: Yahoo chart history (verified symbols with full 2y data).
 *  - Sectors: median of the top-15 liquid constituents' RSI computed from the
 *    stored 2y close series (no extra network cost).
 *
 * Result is cached for 6 h (EOD platform — data moves once a day).
 */

import { db, descNullsLast } from "@/lib/db";
import { fetchChart } from "@/lib/yahoo";
import { rsi } from "@/lib/indicators";
import { classifyMomentum, momentumSort, type MomentumClass, type MomentumRow } from "@/lib/momentum-classes";

export { MOMENTUM_CLASSES, classifyMomentum } from "@/lib/momentum-classes";
export type { MomentumClass, MomentumRow } from "@/lib/momentum-classes";

// ---------------------------------------------------------------- aggregation

/** Last close per ISO week (Monday-anchored, UTC) from a [ts, close] series. */
export function weeklyCloses(series: [number, number][]): number[] {
  const buckets = new Map<string, number>();
  for (const [ts, c] of series) {
    const d = new Date(ts * 1000);
    const monday = (d.getUTCDay() + 6) % 7;
    const key = String(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - monday));
    buckets.set(key, c);
  }
  return [...buckets.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map((e) => e[1]);
}

/** Last close per calendar month (UTC) from a [ts, close] series. */
export function monthlyCloses(series: [number, number][]): number[] {
  const buckets = new Map<string, number>();
  for (const [ts, c] of series) {
    const d = new Date(ts * 1000);
    const key = String(d.getUTCFullYear() * 12 + d.getUTCMonth());
    buckets.set(key, c);
  }
  return [...buckets.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map((e) => e[1]);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function multiRsi(series: [number, number][]): { d: number | null; w: number | null; m: number | null } {
  const daily = series.map((s) => s[1]);
  const weekly = weeklyCloses(series);
  const monthly = monthlyCloses(series);
  return {
    d: daily.length >= 20 ? rsi(daily) : null,
    w: weekly.length >= 15 ? rsi(weekly) : null,
    m: monthly.length >= 15 ? rsi(monthly) : null,
  };
}

// ---------------------------------------------------------------- rows

export interface SectorMomentumData {
  indices: MomentumRow[];
  sectors: MomentumRow[];
  updatedAt: string;
}

/**
 * NSE indices Yahoo serves with full 2y history (verified live).
 * ^CNXMIDCAP & friends now return a single bar — they are intentionally not
 * listed here; sectors below cover them via constituents instead.
 */
const MOMENTUM_INDICES: { symbol: string; name: string }[] = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^NSMIDCP", name: "NIFTY NEXT 50" },
  { symbol: "^NSEBANK", name: "NIFTY BANK" },
  { symbol: "^CNXIT", name: "NIFTY IT" },
  { symbol: "^CNXPHARMA", name: "NIFTY PHARMA" },
  { symbol: "^NSEMDCP50", name: "NIFTY MIDCAP 50" },
  { symbol: "^CRSLDX", name: "NIFTY 500" },
];

async function computeIndexRows(): Promise<MomentumRow[]> {
  const rows: MomentumRow[] = [];
  for (const def of MOMENTUM_INDICES) {
    try {
      const chart = await fetchChart(def.symbol, "2y");
      const series: [number, number][] = [];
      for (let i = 0; i < chart.timestamp.length; i++) {
        const c = chart.indicators.quote[0].close[i];
        if (c != null && Number.isFinite(c)) series.push([chart.timestamp[i], c]);
      }
      if (series.length < 20) continue;
      const { d, w, m } = multiRsi(series);
      const price = series[series.length - 1][1];
      const prev = series[series.length - 2]?.[1] ?? price;
      rows.push({
        name: def.name,
        kind: "index",
        symbol: def.symbol,
        price,
        changePct: prev ? ((price - prev) / prev) * 100 : null,
        dailyRSI: d,
        weeklyRSI: w,
        monthlyRSI: m,
        classification: d != null && w != null && m != null ? classifyMomentum(d, w, m) : null,
      });
    } catch {
      // index unavailable — skip rather than break the whole view
    }
  }
  return rows;
}

async function computeSectorRows(): Promise<MomentumRow[]> {
  const PER_SECTOR = 15;
  const groups = await db.stock.groupBy({
    by: ["sector"],
    where: { sector: { not: null, notIn: ["Unknown"] }, closes: { not: null } },
    _count: { symbol: true },
  });

  const rows: MomentumRow[] = [];
  for (const grp of groups) {
    const sector = grp.sector as string;
    if (!sector) continue;
    const top = await db.stock.findMany({
      where: { sector, closes: { not: null }, price: { not: null } },
      orderBy: descNullsLast("marketCap"),
      take: PER_SECTOR,
      select: { name: true, closes: true, price: true, prevClose: true },
    });
    if (top.length < 3) continue; // not enough constituents for a median

    const dArr: number[] = [];
    const wArr: number[] = [];
    const mArr: number[] = [];
    let lastPrice: number | null = null;
    let changeSum = 0;
    let changeN = 0;
    for (const s of top) {
      if (!s.closes) continue;
      let series: [number, number][];
      try {
        series = JSON.parse(s.closes) as [number, number][];
      } catch {
        continue;
      }
      if (series.length < 20) continue;
      const { d, w, m } = multiRsi(series);
      if (d != null) dArr.push(d);
      if (w != null) wArr.push(w);
      if (m != null) mArr.push(m);
      lastPrice = s.price;
      if (s.price != null && s.prevClose) {
        changeSum += ((s.price - s.prevClose) / s.prevClose) * 100;
        changeN++;
      }
    }

    const d = median(dArr);
    const w = median(wArr);
    const m = median(mArr);
    rows.push({
      name: sector,
      kind: "sector",
      symbol: null,
      price: lastPrice,
      changePct: changeN ? changeSum / changeN : null,
      dailyRSI: d,
      weeklyRSI: w,
      monthlyRSI: m,
      classification: d != null && w != null && m != null ? classifyMomentum(d, w, m) : null,
      constituents: top.length,
      topNames: top.slice(0, 5).map((s) => s.name),
    });
  }
  return rows;
}

// ---------------------------------------------------------------- cache

interface MomentumGlobals {
  __tpSectorMomentum?: { at: number; data: SectorMomentumData; promise?: Promise<SectorMomentumData> };
}
const g = globalThis as unknown as MomentumGlobals;

const TTL_MS = 6 * 3600 * 1000;

export async function getSectorMomentum(force = false): Promise<SectorMomentumData> {
  const cached = g.__tpSectorMomentum;
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.data;
  if (cached?.promise) return cached.promise; // in-flight

  const promise = (async () => {
    const [indices, sectors] = await Promise.all([computeIndexRows(), computeSectorRows()]);
    indices.sort(momentumSort);
    sectors.sort(momentumSort);
    const data: SectorMomentumData = { indices, sectors, updatedAt: new Date().toISOString() };
    g.__tpSectorMomentum = { at: Date.now(), data };
    return data;
  })();

  g.__tpSectorMomentum = { at: Date.now(), data: { indices: [], sectors: [], updatedAt: new Date().toISOString() }, promise };
  promise.catch(() => {
    // failed compute — drop the dead entry so the next call retries
    if (g.__tpSectorMomentum?.promise === promise) g.__tpSectorMomentum = undefined;
  });
  return promise;
}
