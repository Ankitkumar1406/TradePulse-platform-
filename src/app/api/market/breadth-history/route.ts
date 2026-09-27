import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FNO_UNIVERSE } from "@/lib/fno-universe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Breadth history & breakdowns for the Market breadth page.
 *
 * - history: per-session advances/declines, SMA-20/50/200 participation and
 *   52w highs/lows counts, computed inside SQLite with window functions over
 *   the last ~130 sessions (≈6 months) that have a full universe of bars
 *   (≥800 rows). One scan, aggregated to ~130 rows.
 * - sectors: % of stocks above SMA-20/50 per sector + advances/declines today.
 * - segments: AMFI-style Large (top 100 by mcap) / Mid (101-250) / Small
 *   (rest) breadth so large-vs-small divergence is visible.
 * - fno: breadth for the (approximate) F&O universe vs the rest.
 * - asOf: quote stamp of the current snapshot (SyncState-equivalent).
 *
 * History is cached in module memory keyed by the newest full session and
 * only recomputed when a new session completes (or every 15 min); the
 * breakdown refreshes every 60 s.
 */

interface HistoryRow {
  date: string;
  adv: number;
  dec: number;
  above20: number;
  above50: number;
  above200: number;
  nh: number;
  nl: number;
}

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

const g = globalThis as unknown as {
  __breadthCache?: { histKey: string; at: number; history: HistoryRow[] };
  __breakdownCache?: { at: number; data: unknown };
};

const HISTORY_SQL = `
WITH sessions AS (
  SELECT date FROM "DailyBar" GROUP BY date HAVING COUNT(*) >= 800 ORDER BY date DESC LIMIT 130
),
warm AS (
  -- 130 output sessions + 250 warm-up sessions so the SMA/high/low windows
  -- are primed before the first reported date (windows only see rows in the
  -- CTE, so filtering to 130 dates up-front corrupts the first rows).
  SELECT date FROM "DailyBar" GROUP BY date HAVING COUNT(*) >= 800 ORDER BY date DESC LIMIT 380
),
w AS (
  SELECT
    b.symbol, b.date, b.close, b.high, b.low,
    LAG(b.close) OVER (PARTITION BY b.symbol ORDER BY b.date) AS prevClose,
    AVG(b.close) OVER (PARTITION BY b.symbol ORDER BY b.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS sma20,
    AVG(b.close) OVER (PARTITION BY b.symbol ORDER BY b.date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
    AVG(b.close) OVER (PARTITION BY b.symbol ORDER BY b.date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
    MAX(b.high) OVER (PARTITION BY b.symbol ORDER BY b.date ROWS BETWEEN 249 PRECEDING AND CURRENT ROW) AS hi250,
    MIN(b.low) OVER (PARTITION BY b.symbol ORDER BY b.date ROWS BETWEEN 249 PRECEDING AND CURRENT ROW) AS lo250
  FROM "DailyBar" b
  WHERE b.date IN (SELECT date FROM warm)
)
SELECT
  date,
  CAST(SUM(CASE WHEN prevClose IS NOT NULL AND close > prevClose THEN 1 ELSE 0 END) AS INTEGER) AS adv,
  CAST(SUM(CASE WHEN prevClose IS NOT NULL AND close < prevClose THEN 1 ELSE 0 END) AS INTEGER) AS dec,
  CAST(SUM(CASE WHEN close >= sma20 THEN 1 ELSE 0 END) AS INTEGER) AS above20,
  CAST(SUM(CASE WHEN close >= sma50 THEN 1 ELSE 0 END) AS INTEGER) AS above50,
  CAST(SUM(CASE WHEN close >= sma200 THEN 1 ELSE 0 END) AS INTEGER) AS above200,
  CAST(SUM(CASE WHEN high >= hi250 THEN 1 ELSE 0 END) AS INTEGER) AS nh,
  CAST(SUM(CASE WHEN low <= lo250 THEN 1 ELSE 0 END) AS INTEGER) AS nl
FROM w
WHERE date IN (SELECT date FROM sessions)
GROUP BY date
ORDER BY date ASC
`;

// Bump when HISTORY_SQL changes — the module cache is keyed on it.
const SQL_VERSION = "v2";

async function loadHistory(): Promise<{ history: HistoryRow[]; lastFullDate: string | null }> {
  // Cache key: newest full session — history only changes when a session completes.
  const lastFull = await db.$queryRawUnsafe<{ date: string }[]>(
    `SELECT date FROM "DailyBar" GROUP BY date HAVING COUNT(*) >= 800 ORDER BY date DESC LIMIT 1`,
  );
  const key = SQL_VERSION + ":" + (lastFull[0]?.date ?? "");
  const cached = g.__breadthCache;
  if (cached && cached.histKey === key && Date.now() - cached.at < 15 * 60_000) {
    return { history: cached.history, lastFullDate: lastFull[0]?.date ?? null };
  }

  const rows = await db.$queryRawUnsafe<Record<string, number | string>[]>(HISTORY_SQL);
  const history: HistoryRow[] = rows.map((r) => ({
    date: String(r.date),
    adv: Number(r.adv),
    dec: Number(r.dec),
    above20: Number(r.above20),
    above50: Number(r.above50),
    above200: Number(r.above200),
    nh: Number(r.nh),
    nl: Number(r.nl),
  }));
  g.__breadthCache = { histKey: key, at: Date.now(), history };
  return { history, lastFullDate: lastFull[0]?.date ?? null };
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
    const [{ history, lastFullDate }, breakdown] = await Promise.all([loadHistory(), loadBreakdown()]);
    return NextResponse.json({ history, lastFullDate, ...breakdown });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "breadth history failed" },
      { status: 500 },
    );
  }
}
