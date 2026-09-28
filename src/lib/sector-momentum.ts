/**
 * Sector momentum — multi-timeframe RSI (daily / weekly / monthly, RSI-14)
 * for NSE indices and DB sectors, classified with the shared taxonomy in
 * momentum-classes.ts (see that file for the exact published rule).
 *
 * Data sources (honest labels shown in the UI):
 *  - live:      NSE indices the provider serves with full 2y history
 *               (verified: only NIFTY 50 / NEXT 50 / BANK / IT / PHARMA /
 *               MIDCAP 50 / NIFTY 500 have it — every other ^CNX* index now
 *               returns a single bar).
 *  - composite: cap-weighted baskets of an index's major constituents built
 *               from our stored 2y close series (no extra network cost).
 *               Covers the sectoral indices traders actually check (Auto,
 *               FMCG, Metal, Realty, PSU Bank, Energy, Infra, Media,
 *               Fin Service) plus Midcap 100 & Smallcap 100.
 *  - median:    sector rows — median RSI of the top-15 constituents.
 *
 * Result is cached for 6 h (EOD platform — data moves once a day).
 */

import { db, descNullsLast } from "@/lib/db";
import { fetchChart } from "@/lib/yahoo";
import { rsi } from "@/lib/indicators";
import {
  classifyMomentum,
  compositeStrength,
  type MomentumClass,
  type MomentumRow,
  type MoverTicker,
  type SampleTicker,
} from "@/lib/momentum-classes";

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

function multiRsi(series: [number, number][]): {
  d: number | null;
  w: number | null;
  m: number | null;
  dPrev: number | null;
  wPrev: number | null;
  mPrev: number | null;
} {
  const daily = series.map((s) => s[1]);
  const weekly = weeklyCloses(series);
  const monthly = monthlyCloses(series);
  return {
    d: daily.length >= 20 ? rsi(daily) : null,
    w: weekly.length >= 15 ? rsi(weekly) : null,
    m: monthly.length >= 15 ? rsi(monthly) : null,
    // Deltas vs the prior period: daily vs 5 sessions back, weekly/monthly vs
    // the previous completed week/month (drop the last bucket, recompute).
    dPrev: daily.length >= 25 ? rsi(daily.slice(0, -5)) : null,
    wPrev: weekly.length >= 16 ? rsi(weekly.slice(0, -1)) : null,
    mPrev: monthly.length >= 16 ? rsi(monthly.slice(0, -1)) : null,
  };
}

function pctChange(now: number, then: number | undefined | null): number | null {
  if (then == null || !Number.isFinite(then) || then === 0) return null;
  return ((now - then) / then) * 100;
}

function rowFromSeries(
  base: { name: string; kind: "index" | "sector"; source: "live" | "composite"; symbol: string | null; key: string },
  series: [number, number][],
  extra: { constituents?: number; breadthAbove50?: number | null; movers?: { up: MoverTicker[]; down: MoverTicker[] }; sample?: SampleTicker[] },
): MomentumRow | null {
  if (series.length < 20) return null;
  const { d, w, m, dPrev, wPrev, mPrev } = multiRsi(series);
  const price = series[series.length - 1][1];
  const prev1 = series[series.length - 2]?.[1] ?? null;
  const prev5 = series[series.length - 6]?.[1] ?? null;
  return {
    ...base,
    price,
    change1D: pctChange(price, prev1),
    change5D: pctChange(price, prev5),
    dailyRSI: d,
    weeklyRSI: w,
    monthlyRSI: m,
    dDelta: d != null && dPrev != null ? d - dPrev : null,
    wDelta: w != null && wPrev != null ? w - wPrev : null,
    mDelta: m != null && mPrev != null ? m - mPrev : null,
    classification: d != null && w != null && m != null ? classifyMomentum(d, w, m) : null,
    ...extra,
  };
}

// ---------------------------------------------------------------- composites

/**
 * Major constituents per NSE sectoral index (curated top names by index
 * weight; intersected with the DB universe at runtime — the basket is built
 * only from names we actually hold 2y closes for).
 */
export const COMPOSITE_MEMBERS: Record<string, string[]> = {
  "NIFTY AUTO": [
    "MARUTI.NS", "TATAMOTORS.NS", "M&M.NS", "BAJAJ-AUTO.NS", "EICHERMOT.NS", "HEROMOTOCO.NS",
    "TVSMOTOR.NS", "ASHOKLEY.NS", "MOTHERSON.NS", "BOSCHLTD.NS", "BHARATFORG.NS", "EXIDEINDS.NS",
    "APOLLOTYRE.NS", "CEATLTD.NS", "MRF.NS", "TIINDIA.NS", "UNOMINDA.NS", "SONACOMS.NS", "ESCORTS.NS",
  ],
  "NIFTY FMCG": [
    "HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "BRITANNIA.NS", "TATACONSUM.NS", "DABUR.NS",
    "MARICO.NS", "GODREJCP.NS", "COLPAL.NS", "RADICO.NS", "EMAMILTD.NS", "VBL.NS", "UBL.NS",
    "PATANJALI.NS",
  ],
  "NIFTY METAL": [
    "TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "VEDL.NS", "JINDALSTEL.NS", "SAIL.NS", "NMDC.NS",
    "APLAPOLLO.NS", "NATIONALUM.NS", "HINDZINC.NS", "WELCORP.NS", "RATNAMANI.NS", "JSL.NS",
    "MOIL.NS", "LLOYDSME.NS",
  ],
  "NIFTY REALTY": [
    "DLF.NS", "MACROTECH.NS", "GODREJPROP.NS", "OBEROIRLTY.NS", "PRESTIGE.NS", "PHOENIXLTD.NS",
    "BRIGADE.NS", "SOBHA.NS", "ANANTRAJ.NS", "NBCC.NS", "PURVA.NS", "OMAXE.NS", "NESCO.NS",
  ],
  "NIFTY PSU BANK": [
    "SBIN.NS", "BANKBARODA.NS", "PNB.NS", "CANBK.NS", "UNIONBANK.NS", "INDIANB.NS", "BANKINDIA.NS",
    "MAHABANK.NS", "UCOBANK.NS", "CENTRALBK.NS", "PSB.NS", "IOB.NS",
  ],
  "NIFTY ENERGY": [
    "RELIANCE.NS", "ONGC.NS", "COALINDIA.NS", "NTPC.NS", "POWERGRID.NS", "GAIL.NS", "IOC.NS",
    "BPCL.NS", "HPCL.NS", "OIL.NS", "ADANIGREEN.NS", "ADANIPOWER.NS", "TATAPOWER.NS", "PETRONET.NS",
    "IGL.NS", "MGL.NS", "GUJGASLTD.NS", "ATGL.NS", "NHPC.NS", "NLCINDIA.NS",
  ],
  "NIFTY INFRA": [
    "LT.NS", "ADANIPORTS.NS", "IRFC.NS", "PFC.NS", "RECLTD.NS", "CONCOR.NS", "GMRAIRPORT.NS",
    "IRB.NS", "NTPC.NS", "POWERGRID.NS", "ONGC.NS", "GAIL.NS", "IOC.NS", "ADANIGREEN.NS", "NBCC.NS",
    "HUDCO.NS", "INDIGO.NS",
  ],
  "NIFTY MEDIA": [
    "SUNTV.NS", "ZEEL.NS", "PVRINOX.NS", "NETWORK18.NS", "TV18BRDCST.NS", "SAREGAMA.NS",
    "TIPSMUSIC.NS", "PFOCUS.NS", "HATHWAY.NS",
  ],
  "NIFTY FIN SERVICE": [
    "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS", "AXISBANK.NS", "BAJFINANCE.NS",
    "BAJAJFINSV.NS", "JIOFIN.NS", "SBILIFE.NS", "HDFCLIFE.NS", "ICICIPRULI.NS", "ICICIGI.NS",
    "HDFCAMC.NS", "CHOLAFIN.NS", "SBICARD.NS", "SHRIRAMFIN.NS", "MUTHOOTFIN.NS", "LICHSGFIN.NS",
    "MANAPPURAM.NS", "PNBHOUSING.NS", "PFC.NS", "RECLTD.NS", "IRFC.NS",
  ],
};

/**
 * Cap-weighted composite close series from member close series. Each member
 * is normalised to 1.0 at its first available close (level index, not a ₹
 * price); weights are fixed by market cap and re-normalised per session over
 * the members that have data that day. Sessions with data for < 70% of
 * members are dropped.
 */
export function buildCompositeSeries(
  members: { symbol: string; closes: [number, number][]; marketCap: number | null }[],
): [number, number][] {
  const usable = members.filter((m) => m.closes.length >= 60);
  if (usable.length < 8) return [];
  const totalCap = usable.reduce((a, m) => a + (m.marketCap ?? 0), 0);
  const weight = new Map<string, number>(
    usable.map((m) => [m.symbol, (m.marketCap ?? 0) / (totalCap || usable.length)]),
  );

  const byTs = new Map<number, Map<string, number>>();
  const firstClose = new Map<string, number>();
  for (const m of usable) {
    const rel: [number, number][] = m.closes.map(([ts, c], i) => {
      if (!firstClose.has(m.symbol)) firstClose.set(m.symbol, c);
      return [ts, c / (firstClose.get(m.symbol) || c)];
    });
    for (const [ts, c] of rel) {
      let row = byTs.get(ts);
      if (!row) { row = new Map(); byTs.set(ts, row); }
      row.set(m.symbol, c);
    }
  }

  const minCoverage = Math.max(8, Math.ceil(usable.length * 0.7));
  const out: [number, number][] = [];
  for (const ts of [...byTs.keys()].sort((a, b) => a - b)) {
    const row = byTs.get(ts)!;
    if (row.size < minCoverage) continue;
    let wSum = 0;
    let level = 0;
    for (const [symbol, rel] of row) {
      const w = weight.get(symbol) ?? 0;
      level += w * rel;
      wSum += w;
    }
    if (wSum > 0) out.push([ts, level / wSum]);
  }
  return out;
}

// ---------------------------------------------------------------- rows

export interface SectorMomentumData {
  indices: MomentumRow[];
  sectors: MomentumRow[];
  /** Latest fully-populated EOD session (YYYY-MM-DD) — the single "as of" stamp. */
  asOf: string | null;
  generatedAt: string;
}

/**
 * Indices the provider serves with full 2y history (verified live — every
 * other legacy ^CNX* symbol returns a single bar).
 */
const LIVE_INDICES: { symbol: string; name: string }[] = [
  { symbol: "^NSEI", name: "NIFTY 50" },
  { symbol: "^NSMIDCP", name: "NIFTY NEXT 50" },
  { symbol: "^NSEBANK", name: "NIFTY BANK" },
  { symbol: "^CNXIT", name: "NIFTY IT" },
  { symbol: "^CNXPHARMA", name: "NIFTY PHARMA" },
  { symbol: "^NSEMDCP50", name: "NIFTY MIDCAP 50" },
  { symbol: "^CRSLDX", name: "NIFTY 500" },
];

/** Yahoo-GICS sector → NSE-friendly display label. */
export const SECTOR_LABELS: Record<string, string> = {
  Technology: "IT",
  "Financial Services": "Financials",
  Healthcare: "Pharma & Healthcare",
  "Consumer Cyclical": "Auto & Discretionary",
  "Consumer Defensive": "FMCG & Staples",
  "Basic Materials": "Metals & Materials",
  "Real Estate": "Realty",
  "Communication Services": "Media & Telecom",
  Energy: "Oil & Gas",
  Utilities: "Power & Utilities",
  Industrials: "Capital Goods & Infra",
};

interface StockLite {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  changePct: number | null;
  aboveSma50: boolean | null;
}

async function fetchLiveIndex(def: { symbol: string; name: string }): Promise<MomentumRow | null> {
  try {
    const chart = await fetchChart(def.symbol, "2y");
    const series: [number, number][] = [];
    for (let i = 0; i < chart.timestamp.length; i++) {
      const c = chart.indicators.quote[0].close[i];
      if (c != null && Number.isFinite(c)) series.push([chart.timestamp[i], c]);
    }
    return rowFromSeries(
      { name: def.name, kind: "index", source: "live", symbol: def.symbol, key: def.symbol },
      series,
      {},
    );
  } catch {
    return null; // index unavailable — skip rather than break the whole view
  }
}

async function computeIndexRows(): Promise<MomentumRow[]> {
  const live = await Promise.all(LIVE_INDICES.map(fetchLiveIndex));
  const rows = live.filter((r): r is MomentumRow => r != null);

  // Composite baskets for the sectoral indices the provider no longer serves
  // with history + Midcap/Smallcap 100 from market-cap ranks.
  const allMembers = [...new Set(Object.values(COMPOSITE_MEMBERS).flat())];
  const [memberRows, allStocks] = await Promise.all([
    db.stock.findMany({
      where: { symbol: { in: allMembers }, closes: { not: null } },
      select: { symbol: true, marketCap: true, changePct: true, aboveSma50: true, closes: true },
    }),
    db.stock.findMany({
      where: { marketCap: { not: null } },
      orderBy: descNullsLast("marketCap"),
      select: { symbol: true },
    }),
  ]);
  const memberMap = new Map(memberRows.map((m) => [m.symbol, m]));

  const parseCloses = (json: string): [number, number][] => {
    try {
      return JSON.parse(json) as [number, number][];
    } catch {
      return [];
    }
  };

  const buildCompositeRow = (name: string, symbols: string[]): MomentumRow | null => {
    const members = symbols
      .map((s) => memberMap.get(s))
      .filter((m): m is (typeof memberRows)[number] => m != null)
      .map((m) => ({ symbol: m.symbol, closes: parseCloses(m.closes as string), marketCap: m.marketCap }));
    const series = buildCompositeSeries(members);
    const withData = members.filter((m) => m.closes.length >= 60);
    const above50 = withData.filter((m) => memberMap.get(m.symbol)?.aboveSma50 === true).length;
    const movers = moversOf(
      withData.map((m) => ({
        symbol: m.symbol,
        changePct: memberMap.get(m.symbol)?.changePct ?? null,
      })),
    );
    // Sample: top 8 by weight with today's change + daily RSI.
    const sample: SampleTicker[] = [...withData]
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, 8)
      .map((m) => {
        const { d } = multiRsi(m.closes);
        return { symbol: m.symbol.replace(".NS", ""), change1D: memberMap.get(m.symbol)?.changePct ?? null, dailyRSI: d };
      });
    return rowFromSeries(
      { name, kind: "index", source: "composite", symbol: null, key: `composite:${name}` },
      series,
      {
        constituents: withData.length,
        breadthAbove50: withData.length ? Math.round((above50 / withData.length) * 100) : null,
        movers,
        sample,
      },
    );
  };

  for (const [name, symbols] of Object.entries(COMPOSITE_MEMBERS)) {
    const row = buildCompositeRow(name, symbols);
    if (row) rows.push(row);
  }

  // Midcap 100 / Smallcap 100 composites from market-cap ranks (2 = 101-250, 3 = 251-400).
  const rankSymbols = allStocks.map((s) => s.symbol);
  const midcap = rankSymbols.slice(100, 250);
  const smallcap = rankSymbols.slice(250, 400);
  const midRow = await (async () => {
    const members = await db.stock.findMany({
      where: { symbol: { in: midcap }, closes: { not: null } },
      select: { symbol: true, marketCap: true, changePct: true, aboveSma50: true, closes: true },
    });
    const mm = new Map(members.map((m) => [m.symbol, m]));
    const list = midcap
      .map((s) => mm.get(s))
      .filter((m): m is (typeof members)[number] => m != null)
      .map((m) => ({ symbol: m.symbol, closes: parseCloses(m.closes as string), marketCap: m.marketCap }));
    const withData = list.filter((m) => m.closes.length >= 60);
    const above50 = withData.filter((m) => mm.get(m.symbol)?.aboveSma50 === true).length;
    return rowFromSeries(
      { name: "NIFTY MIDCAP 100", kind: "index", source: "composite", symbol: null, key: "composite:NIFTY MIDCAP 100" },
      buildCompositeSeries(list),
      {
        constituents: withData.length,
        breadthAbove50: withData.length ? Math.round((above50 / withData.length) * 100) : null,
        movers: moversOf(withData.map((m) => ({ symbol: m.symbol, changePct: mm.get(m.symbol)?.changePct ?? null }))),
        sample: withData
          .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
          .slice(0, 8)
          .map((m) => ({ symbol: m.symbol.replace(".NS", ""), change1D: mm.get(m.symbol)?.changePct ?? null, dailyRSI: multiRsi(m.closes).d })),
      },
    );
  })();
  if (midRow) rows.push(midRow);
  const smallRow = await (async () => {
    const members = await db.stock.findMany({
      where: { symbol: { in: smallcap }, closes: { not: null } },
      select: { symbol: true, marketCap: true, changePct: true, aboveSma50: true, closes: true },
    });
    const mm = new Map(members.map((m) => [m.symbol, m]));
    const list = smallcap
      .map((s) => mm.get(s))
      .filter((m): m is (typeof members)[number] => m != null)
      .map((m) => ({ symbol: m.symbol, closes: parseCloses(m.closes as string), marketCap: m.marketCap }));
    const withData = list.filter((m) => m.closes.length >= 60);
    const above50 = withData.filter((m) => mm.get(m.symbol)?.aboveSma50 === true).length;
    return rowFromSeries(
      { name: "NIFTY SMALLCAP 100", kind: "index", source: "composite", symbol: null, key: "composite:NIFTY SMALLCAP 100" },
      buildCompositeSeries(list),
      {
        constituents: withData.length,
        breadthAbove50: withData.length ? Math.round((above50 / withData.length) * 100) : null,
        movers: moversOf(withData.map((m) => ({ symbol: m.symbol, changePct: mm.get(m.symbol)?.changePct ?? null }))),
        sample: withData
          .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
          .slice(0, 8)
          .map((m) => ({ symbol: m.symbol.replace(".NS", ""), change1D: mm.get(m.symbol)?.changePct ?? null, dailyRSI: multiRsi(m.closes).d })),
      },
    );
  })();
  if (smallRow) rows.push(smallRow);

  return rows;
}

/** 3 strongest + 3 weakest constituents by today's change. */
function moversOf(rows: { symbol: string; changePct: number | null }[]): { up: MoverTicker[]; down: MoverTicker[] } {
  const valid = rows
    .filter((r) => r.changePct != null && Number.isFinite(r.changePct))
    .map((r) => ({ symbol: r.symbol.replace(".NS", ""), change1D: r.changePct as number }));
  const sorted = [...valid].sort((a, b) => (b.change1D ?? 0) - (a.change1D ?? 0));
  return { up: sorted.slice(0, 3), down: sorted.slice(-3).reverse() };
}

async function computeSectorRows(stocksWithSector: StockLite[]): Promise<MomentumRow[]> {
  const PER_SECTOR = 15;
  const bySector = new Map<string, StockLite[]>();
  for (const s of stocksWithSector) {
    if (!s.sector || s.sector === "Unknown") continue;
    const list = bySector.get(s.sector) ?? [];
    list.push(s);
    bySector.set(s.sector, list);
  }

  const rows: MomentumRow[] = [];
  for (const [sector, pool] of bySector) {
    const topSymbols = [...pool]
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, PER_SECTOR);
    if (topSymbols.length < 3) continue;

    const detailed = await db.stock.findMany({
      where: { symbol: { in: topSymbols.map((s) => s.symbol) }, closes: { not: null } },
      select: { symbol: true, closes: true },
    });
    const closesMap = new Map(detailed.map((d) => [d.symbol, d.closes as string]));

    const dArr: number[] = [];
    const wArr: number[] = [];
    const mArr: number[] = [];
    const dPrevArr: number[] = [];
    const wPrevArr: number[] = [];
    const mPrevArr: number[] = [];
    const sample: SampleTicker[] = [];
    for (const s of topSymbols) {
      const json = closesMap.get(s.symbol);
      if (!json) continue;
      let series: [number, number][];
      try {
        series = JSON.parse(json) as [number, number][];
      } catch {
        continue;
      }
      if (series.length < 20) continue;
      const { d, w, m, dPrev, wPrev, mPrev } = multiRsi(series);
      if (d != null) dArr.push(d);
      if (w != null) wArr.push(w);
      if (m != null) mArr.push(m);
      if (dPrev != null) dPrevArr.push(dPrev);
      if (wPrev != null) wPrevArr.push(wPrev);
      if (mPrev != null) mPrevArr.push(mPrev);
      if (sample.length < 8) {
        sample.push({ symbol: s.symbol.replace(".NS", ""), change1D: s.changePct, dailyRSI: d });
      }
    }
    if (dArr.length < 3) continue; // not enough constituents for a median

    const d = median(dArr);
    const w = median(wArr);
    const m = median(mArr);
    const dPrev = median(dPrevArr);
    const wPrev = median(wPrevArr);
    const mPrev = median(mPrevArr);
    const withChg = pool.filter((s) => s.changePct != null && Number.isFinite(s.changePct));
    const above50 = pool.filter((s) => s.aboveSma50 === true).length;
    rows.push({
      name: SECTOR_LABELS[sector] ?? sector,
      kind: "sector",
      symbol: null,
      key: `sector:${sector}`,
      source: "median",
      price: null,
      change1D: withChg.length
        ? withChg.reduce((a, s) => a + (s.changePct ?? 0), 0) / withChg.length
        : null,
      change5D: null,
      dailyRSI: d,
      weeklyRSI: w,
      monthlyRSI: m,
      dDelta: d != null && dPrev != null ? d - dPrev : null,
      wDelta: w != null && wPrev != null ? w - wPrev : null,
      mDelta: m != null && mPrev != null ? m - mPrev : null,
      classification: d != null && w != null && m != null ? classifyMomentum(d, w, m) : null,
      constituents: pool.length,
      breadthAbove50: pool.length ? Math.round((above50 / pool.length) * 100) : null,
      movers: moversOf(pool.map((s) => ({ symbol: s.symbol, changePct: s.changePct }))),
      sample,
      sectorValue: sector,
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
    const [asOfRow, stockRows] = await Promise.all([
      db.$queryRawUnsafe<{ date: string }[]>(`SELECT MAX(date) AS date FROM "DailyBar"`),
      db.stock.findMany({
        where: { sector: { not: null, notIn: ["Unknown"] } },
        select: {
          symbol: true, name: true, sector: true, marketCap: true,
          changePct: true, aboveSma50: true,
        },
      }),
    ]);
    const asOf = asOfRow[0]?.date ?? null;

    const [indices, sectors] = await Promise.all([
      computeIndexRows(),
      computeSectorRows(
        stockRows.map((s) => ({
          symbol: s.symbol,
          name: s.name,
          sector: s.sector,
          marketCap: s.marketCap,
          changePct: s.changePct,
          aboveSma50: s.aboveSma50,
        })),
      ),
    ]);

    // Rank within each table by composite strength (strongest = 1) and sort by it.
    const rankRows = (rows: MomentumRow[]) => {
      const sorted = [...rows].sort((a, b) => compositeStrength(b) - compositeStrength(a));
      sorted.forEach((r, i) => { r.rank = i + 1; });
      return sorted;
    };
    const rankedIndices = rankRows(indices);
    const rankedSectors = rankRows(sectors);

    const data: SectorMomentumData = {
      indices: rankedIndices,
      sectors: rankedSectors,
      asOf,
      generatedAt: new Date().toISOString(),
    };
    g.__tpSectorMomentum = { at: Date.now(), data };
    return data;
  })();

  g.__tpSectorMomentum = { at: Date.now(), data: { indices: [], sectors: [], asOf: null, generatedAt: new Date().toISOString() }, promise };
  promise.catch(() => {
    // failed compute — drop the dead entry so the next call retries
    if (g.__tpSectorMomentum?.promise === promise) g.__tpSectorMomentum = undefined;
  });
  return promise;
}
