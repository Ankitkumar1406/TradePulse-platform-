/**
 * MarketSmith-style ratings, recomputed over the whole universe after every
 * sync (and runnable standalone via scripts/compute-ratings.ts):
 *
 *  · rsRating (1-99) — percentile of the 12-month weighted momentum
 *    0.4·3M + 0.2·6M + 0.2·9M + 0.2·12M, the classic IBD/MarketSmith RS
 *    weighting that emphasises the most recent quarter.
 *  · epsScore (1-99) — composite percentile of fundamental growth:
 *    0.44·latest-quarter EPS growth YoY + 0.44·3-year net-income CAGR
 *    + 0.12·revenue QoQ (weights follow MarketSmith's EPS rating schema;
 *    missing components re-normalise across what is available).
 *  · adRating (A+ … E) — 13-week accumulation/distribution: the ratio of
 *    up-day volume to down-day volume, banded to MarketSmith's letter grades.
 *
 * Percentiles are ranked across every stock that has the underlying data, so
 * the scores are always relative to the current NSE universe.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

interface RatingsGlobals {
  __tpRatingsRunning?: boolean;
}
const g = globalThis as unknown as RatingsGlobals;

/** 1-99 percentile rank of `v` inside a sorted-ascending array of all values. */
function percentile1to99(sorted: number[], v: number): number {
  let lo = 0;
  for (const r of sorted) if (r < v) lo++;
  return Math.min(99, Math.max(1, Math.round((lo / Math.max(1, sorted.length - 1)) * 98) + 1));
}

/** MarketSmith-style A/D grade from the 13-week up/down volume ratio. */
export function adGrade(ratio: number): string {
  if (ratio >= 3.0) return "A+";
  if (ratio >= 2.0) return "A";
  if (ratio >= 1.5) return "A-";
  if (ratio >= 1.2) return "B+";
  if (ratio >= 1.0) return "B";
  if (ratio >= 0.9) return "B-";
  if (ratio >= 0.8) return "C+";
  if (ratio >= 0.7) return "C";
  if (ratio >= 0.6) return "C-";
  if (ratio >= 0.5) return "D+";
  if (ratio >= 0.4) return "D";
  if (ratio >= 0.3) return "D-";
  return "E";
}

/**
 * Weighted 12-month RS momentum from five spot closes (t, t-63, t-126,
 * t-189, t-252). Needs at least ~6 months of history; older anchors fall
 * back to the newest available shorter window, exactly like the original
 * series-based computation.
 */
function weightedRs(
  c0: number | null, c63: number | null, c126: number | null, c189: number | null, c252: number | null
): number | null {
  if (c0 == null || c63 == null || c0 <= 0 || c63 <= 0) return null;
  const r3 = c0 / c63 - 1;
  const r6 = c126 != null && c126 > 0 ? c0 / c126 - 1 : r3;
  const r9 = c189 != null && c189 > 0 ? c0 / c189 - 1 : r6;
  const r12 = c252 != null && c252 > 0 ? c0 / c252 - 1 : r6;
  return 0.4 * r3 + 0.2 * r6 + 0.2 * r9 + 0.2 * r12;
}

/** Give the event loop a beat so queued API renders (and their DB queries) run. */
async function yieldLoop(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

interface AdRow {
  symbol: string;
  open: number;
  close: number;
  volume: number;
}

/**
 * Recompute RS rating, EPS score and A/D rating for the entire universe and
 * persist them on Stock rows. Safe to call concurrently (single-flight).
 * Returns the number of stocks updated.
 */
export async function recomputeRatings(): Promise<number> {
  if (g.__tpRatingsRunning) return 0;
  g.__tpRatingsRunning = true;
  try {
    const stocks = await db.stock.findMany({
      where: { price: { not: null } },
      select: {
        symbol: true,
        epsQuarterlyGrowth: true,
        netIncome3YCagr: true,
        revenueQoQGrowth: true,
      },
    });

    // ---- RS rating (weighted 12M momentum) ------------------------------
    // Set-based: pull ONLY the 5 close prices needed per symbol (t, t-63,
    // -126, -189, -252) from DailyBar via one window query. The previous
    // implementation streamed the full 2y `closes` JSON column for all 3,548
    // stocks (~100 MB) and JSON.parsed every row — that blocked the event
    // loop for seconds after every sync and ballooned the process to ~2 GB,
    // making every API route crawl. Symbols missing from DailyBar (rare:
    // recent IPOs / SMEs) fall back to parsing their stored closes.
    type MomentumRow = { symbol: string; c0: number | null; c63: number | null; c126: number | null; c189: number | null; c252: number | null };
    const momRows = await db.$queryRaw<MomentumRow[]>(Prisma.sql`
      SELECT symbol,
             MAX(CASE WHEN rn = 1        THEN close END) AS c0,
             MAX(CASE WHEN rn = 64       THEN close END) AS c63,
             MAX(CASE WHEN rn = 127      THEN close END) AS c126,
             MAX(CASE WHEN rn = 190      THEN close END) AS c189,
             MAX(CASE WHEN rn = 253      THEN close END) AS c252
        FROM (
          SELECT symbol, close,
                 ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM DailyBar
        )
       WHERE rn <= 253
       GROUP BY symbol
    `);

    const rsRaw = new Map<string, number>();
    for (const r of momRows) {
      const w = weightedRs(r.c0, r.c63, r.c126, r.c189, r.c252);
      if (w != null) rsRaw.set(r.symbol, w);
    }

    // Fallback for symbols with closes but no DailyBar coverage. NOT EXISTS
    // via raw SQL — a Prisma `notIn` with ~3k symbols blows the SQLite
    // parameter limit.
    const missingRows = await db.$queryRaw<{ symbol: string; closes: string }[]>(Prisma.sql`
      SELECT s.symbol, s.closes
        FROM Stock s
       WHERE s.price IS NOT NULL AND s.closes IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM DailyBar d WHERE d.symbol = s.symbol)
    `);
    for (const s of missingRows) {
      let closes: number[];
      try {
        closes = (JSON.parse(s.closes as string) as [number, number][]).map((p) => p[1]);
      } catch {
        continue;
      }
      const w = weightedRs(
        closes[closes.length - 1] ?? null,
        closes[closes.length - 1 - 63] ?? null,
        closes[closes.length - 1 - 126] ?? null,
        closes[closes.length - 1 - 189] ?? null,
        closes[closes.length - 1 - 252] ?? null
      );
      if (w != null) rsRaw.set(s.symbol, w);
    }
    const rsSorted = [...rsRaw.values()].sort((a, b) => a - b);
    const rsRating = new Map<string, number>();
    for (const [sym, v] of rsRaw) rsRating.set(sym, percentile1to99(rsSorted, v));
    await yieldLoop(); // let queued API renders run before the next heavy phase

    // ---- EPS score (composite percentile of the three growth metrics) ---
    const epsQ = stocks.map((s) => ({ sym: s.symbol, v: s.epsQuarterlyGrowth })).filter((x): x is { sym: string; v: number } => x.v != null);
    const cagr = stocks.map((s) => ({ sym: s.symbol, v: s.netIncome3YCagr })).filter((x): x is { sym: string; v: number } => x.v != null);
    const rev = stocks.map((s) => ({ sym: s.symbol, v: s.revenueQoQGrowth })).filter((x): x is { sym: string; v: number } => x.v != null);
    const pctOf = (rows: { sym: string; v: number }[]) => {
      const sorted = rows.map((r) => r.v).sort((a, b) => a - b);
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.sym, percentile1to99(sorted, r.v) / 100);
      return m;
    };
    const pctQ = pctOf(epsQ), pctC = pctOf(cagr), pctR = pctOf(rev);
    const epsComposite = new Map<string, number>();
    for (const s of stocks) {
      const parts: { w: number; p?: number }[] = [
        { w: 0.44, p: pctQ.get(s.symbol) },
        { w: 0.44, p: pctC.get(s.symbol) },
        { w: 0.12, p: pctR.get(s.symbol) },
      ];
      const have = parts.filter((p) => p.p != null);
      if (have.length === 0) continue;
      const wsum = have.reduce((a, p) => a + p.w, 0);
      epsComposite.set(s.symbol, have.reduce((a, p) => a + (p.p as number) * p.w, 0) / wsum);
    }
    const epsRating = new Map<string, number>();
    for (const [sym, comp] of epsComposite) epsRating.set(sym, Math.min(99, Math.max(1, Math.round(comp * 98) + 1)));
    await yieldLoop();

    // ---- A/D rating (13-week up/down volume from DailyBar) --------------
    const adRows = await db.$queryRaw<AdRow[]>(Prisma.sql`
      SELECT symbol, open, close, volume FROM (
        SELECT symbol, date, open, close, volume,
               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
        FROM DailyBar
      )
      WHERE rn <= 65
      ORDER BY symbol, date ASC
    `);
    const adBySymbol = new Map<string, AdRow[]>();
    for (const r of adRows) {
      const arr = adBySymbol.get(r.symbol);
      if (arr) arr.push(r);
      else adBySymbol.set(r.symbol, [r]);
    }
    const adRating = new Map<string, string>();
    for (const [sym, bars] of adBySymbol) {
      let upVol = 0, downVol = 0;
      for (const b of bars) {
        if (b.close > b.open) upVol += b.volume;
        else if (b.close < b.open) downVol += b.volume;
      }
      if (upVol + downVol <= 0) continue;
      adRating.set(sym, adGrade(upVol / Math.max(1, downVol)));
    }

    // ---- persist ---------------------------------------------------------
    let updated = 0;
    const all = stocks.map((s) => s.symbol);
    const CHUNK = 500;
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK);
      await db.$transaction(
        chunk.map((sym) =>
          db.stock.update({
            where: { symbol: sym },
            data: {
              rsRating: rsRating.get(sym) ?? null,
              epsScore: epsRating.get(sym) ?? null,
              adRating: adRating.get(sym) ?? null,
            },
          })
        )
      );
      updated += chunk.length;
    }
    await db.syncState
      .updateMany({ where: { id: "main" }, data: { ratingsSynced: new Date() } })
      .catch(() => {});
    console.log(
      `[ratings] recomputed for ${updated} stocks — rs ${rsRating.size}, eps ${epsRating.size}, ad ${adRating.size}`
    );
    return updated;
  } finally {
    g.__tpRatingsRunning = false;
  }
}
