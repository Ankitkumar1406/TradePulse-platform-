import { db } from "@/lib/db";

/**
 * Market-breadth history loader (server-only).
 *
 * Owns the per-session breadth history computation previously inlined in
 * /api/market/breadth-history. The heavy window-function scan covers ~380
 * sessions × ~3.5k symbols (~1.3M rows) and takes seconds on a small box —
 * so the result is cached in module memory and kept warm:
 *
 * - warmBreadthCache() is called once at server boot (from the scheduler)
 *   so the first visitor gets instant charts instead of a cold compute.
 * - loadBreadthHistory() serves stale rows immediately once a cache exists
 *   and refreshes in the background (single-flight) — the breadth page
 *   never blocks on a recompute after the first warm-up.
 */

export interface BreadthHistoryRow {
  date: string;
  adv: number;
  dec: number;
  above20: number;
  above50: number;
  above200: number;
  nh: number;
  nl: number;
}

const HISTORY_TTL_MS = 15 * 60_000;

const g = globalThis as unknown as {
  __breadthHistoryCache?: {
    key: string;
    at: number;
    rows: BreadthHistoryRow[];
    lastFullDate: string | null;
    recompute?: Promise<BreadthHistoryRow[]>;
  };
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
const SQL_VERSION = "v3";

function parseRows(rows: Record<string, number | string>[]): BreadthHistoryRow[] {
  return rows.map((r) => ({
    date: String(r.date),
    adv: Number(r.adv),
    dec: Number(r.dec),
    above20: Number(r.above20),
    above50: Number(r.above50),
    above200: Number(r.above200),
    nh: Number(r.nh),
    nl: Number(r.nl),
  }));
}

async function lastFullSession(): Promise<string | null> {
  const lastFull = await db.$queryRawUnsafe<{ date: string }[]>(
    `SELECT date FROM "DailyBar" GROUP BY date HAVING COUNT(*) >= 800 ORDER BY date DESC LIMIT 1`,
  );
  return lastFull[0]?.date ?? null;
}

async function computeHistory(): Promise<BreadthHistoryRow[]> {
  const rows = await db.$queryRawUnsafe<Record<string, number | string>[]>(HISTORY_SQL);
  return parseRows(rows);
}

/**
 * Newest fully-populated session (≥800 symbols) — the breadth page shows
 * "history through" this date.
 */
export async function breadthLastFullDate(): Promise<string | null> {
  return lastFullSession();
}

/**
 * Breadth history with stale-while-revalidate semantics:
 * - fresh cache → returned immediately
 * - stale cache → returned immediately while a single background recompute runs
 * - cold cache → computed inline (the only blocking case; boot warm-up makes
 *   this rare)
 */
export async function loadBreadthHistory(): Promise<{
  history: BreadthHistoryRow[];
  lastFullDate: string | null;
  stale: boolean;
}> {
  const lastFull = await lastFullSession();
  const key = SQL_VERSION + ":" + (lastFull ?? "");
  const cached = g.__breadthHistoryCache;

  if (cached && cached.key === key) {
    if (Date.now() - cached.at < HISTORY_TTL_MS) {
      return { history: cached.rows, lastFullDate: cached.lastFullDate, stale: false };
    }
    // Stale but usable — refresh in the background (single-flight) and serve now.
    if (!cached.recompute) {
      cached.recompute = computeHistory()
        .then((rows) => {
          g.__breadthHistoryCache = { key, at: Date.now(), rows, lastFullDate: lastFull };
          return rows;
        })
        .catch(() => cached.rows) // keep stale rows on failure — retry next call
        .finally(() => {
          if (g.__breadthHistoryCache) g.__breadthHistoryCache.recompute = undefined;
        });
    }
    return { history: cached.rows, lastFullDate: cached.lastFullDate, stale: true };
  }

  // Cold cache (new session completed, SQL bumped, or first boot before warm-up).
  const rows = await computeHistory();
  g.__breadthHistoryCache = { key, at: Date.now(), rows, lastFullDate: lastFull };
  return { history: rows, lastFullDate: lastFull, stale: false };
}

/** Boot-time warm-up — fire-and-forget; never throws. */
export async function warmBreadthCache(): Promise<void> {
  try {
    await loadBreadthHistory();
  } catch {
    /* DB not ready yet — the sweeper/next request will warm it later. */
  }
}
