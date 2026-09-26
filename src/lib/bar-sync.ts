/**
 * Per-symbol OHLCV bar freshness.
 *
 * The universe quotes + closes phases sync every evening and complete in
 * minutes, but the DailyBar chart store is filled by a slow background
 * trickle that can die mid-pass (server recycle) — leaving charts days
 * behind the rest of the app ("scanner says Sep 25, chart ends Sep 23").
 *
 * This module guarantees that any chart the user actually opens is synced
 * to the latest synced EOD date before it is served:
 *  - expectedLatestBarDate(): the calendar date (IST) of the newest quote
 *    snapshot across the universe — the same "data updated till" date the
 *    screener tables show.
 *  - syncSymbolBars(symbol): fetch 2y OHLCV from Yahoo and replace the
 *    symbol's stored bars + current-week candle (single source of truth
 *    for both the on-demand top-up and the background trickle).
 *  - ensureFreshBars(symbol): predicate + single-flight + soft deadline —
 *    fire the top-up only when the symbol is behind, never block the
 *    response for more than a few seconds, never break the chart on error.
 */

import { db } from "@/lib/db";
import { fetchChart } from "@/lib/yahoo";

/** How often a symbol's bars may be re-fetched from the read path. */
const TOPUP_COOLDOWN_MS = 2 * 3600 * 1000;
/** Soft deadline: serve possibly-stale bars rather than stall the request. */
const SOFT_DEADLINE_MS = 4500;
/** Cache TTL for the expected-latest-date lookup. */
const EXP_TTL_MS = 60 * 1000;

const IST_OFFSET_MIN = 330;

interface BarSyncGlobals {
  __tpBarSyncInFlight?: Map<string, Promise<void>>;
  __tpBarSyncFailures?: Map<string, number>;
}
const g = globalThis as unknown as BarSyncGlobals;
const inFlight: Map<string, Promise<void>> = (g.__tpBarSyncInFlight ??= new Map());
const lastFailure: Map<string, number> = (g.__tpBarSyncFailures ??= new Map());
/** After a failed fetch, wait this long before the read path retries. */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

let expDateCache: { date: string; at: number } | null = null;

/**
 * Calendar date (YYYY-MM-DD, IST) of the newest quote snapshot in the
 * universe — i.e. the date "the data is updated till". Falls back to null
 * when the universe has never synced.
 */
export async function expectedLatestBarDate(): Promise<string | null> {
  if (expDateCache && Date.now() - expDateCache.at < EXP_TTL_MS) return expDateCache.date;
  try {
    const agg = await db.stock.aggregate({ _max: { quoteTime: true } });
    const qt = agg._max.quoteTime;
    if (!qt) return null;
    // regularMarketTime is the UTC instant of the last NSE trade (~15:30 IST);
    // shift to IST before taking the calendar date.
    const ist = new Date(qt.getTime() + IST_OFFSET_MIN * 60 * 1000);
    expDateCache = { date: ist.toISOString().slice(0, 10), at: Date.now() };
    return expDateCache.date;
  } catch {
    return null;
  }
}

export interface SymbolBarRow {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Yahoo chart JSON -> bar rows (drops null OHLC points). */
export function chartToRows(symbol: string, chart: Awaited<ReturnType<typeof fetchChart>>): SymbolBarRow[] {
  const ts = chart.timestamp;
  const q = chart.indicators.quote[0];
  const rows: SymbolBarRow[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    rows.push({
      symbol,
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: o, high: h, low: l, close: c,
      volume: v ?? 0,
    });
  }
  return rows;
}

/** Monday (UTC/ISO) anchor of the week containing the given YYYY-MM-DD date. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Current-week OHLC from freshly fetched bars (last week bucket, Mon-anchored). */
export function weeklyOhlc(rows: { date: string; open: number; high: number; low: number; close: number }[]) {
  if (rows.length === 0) return null;
  const monday = mondayOf(rows[rows.length - 1].date);
  const wk = rows.filter((r) => r.date >= monday);
  if (wk.length === 0) return null;
  return {
    wOpen: wk[0].open,
    wHigh: Math.max(...wk.map((r) => r.high)),
    wLow: Math.min(...wk.map((r) => r.low)),
    wClose: wk[wk.length - 1].close,
  };
}

/**
 * Fetch fresh bars for one symbol and merge them into the stored DailyBar
 * rows, then refresh the current-week candle. Returns the newest bar date
 * after the merge, or null when the fetch produced nothing.
 *
 * The merge is a covered-window replace: only dates within the fetched
 * range are deleted. A truncated upstream response (Yahoo occasionally
 * serves a 1-3 bar tail) can then never wipe the stored 2y history — it
 * just refreshes the days it actually returned.
 */
export async function syncSymbolBars(symbol: string, range = "2y"): Promise<string | null> {
  const chart = await fetchChart(symbol, range);
  const rows = chartToRows(symbol, chart);
  if (rows.length === 0) return null;
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  await db.$transaction([
    db.dailyBar.deleteMany({ where: { symbol, date: { gte: rows[0].date } } }),
    db.dailyBar.createMany({ data: rows }),
  ]);
  // keep the builder's Weekly-timeframe price columns fresh alongside bars
  const wk = weeklyOhlc(rows);
  await db.stock.update({
    where: { symbol },
    data: { barsSynced: new Date(), ...(wk ?? {}) },
  });
  return rows[rows.length - 1].date;
}

/**
 * On-demand freshness for chart reads: if the symbol's newest stored bar is
 * older than the universe's latest synced EOD date, top it up before the
 * chart is served. Best-effort by design — any failure leaves the stored
 * bars untouched so the chart still renders.
 */
export async function ensureFreshBars(symbol: string): Promise<void> {
  try {
    const [expected, stock, maxBar] = await Promise.all([
      expectedLatestBarDate(),
      db.stock.findUnique({ where: { symbol }, select: { barsSynced: true } }),
      db.dailyBar.aggregate({ where: { symbol }, _max: { date: true } }),
    ]);
    if (!expected || !stock) return;
    const last = maxBar._max.date;
    if (last && last >= expected) return; // already current
    // a recent attempt (this session or the trickle) — don't hammer Yahoo
    if (stock.barsSynced && Date.now() - stock.barsSynced.getTime() < TOPUP_COOLDOWN_MS) return;
    const failedAt = lastFailure.get(symbol);
    if (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS) return;

    const existing = inFlight.get(symbol);
    if (existing) {
      await Promise.race([existing, sleep(SOFT_DEADLINE_MS)]);
      return;
    }
    const p = (async () => {
      try {
        await syncSymbolBars(symbol);
        lastFailure.delete(symbol);
      } catch {
        lastFailure.set(symbol, Date.now());
      } finally {
        inFlight.delete(symbol);
      }
    })();
    inFlight.set(symbol, p);
    // soft deadline: chart response never waits on a slow upstream
    await Promise.race([p, sleep(SOFT_DEADLINE_MS)]);
  } catch {
    // freshness is an enhancement — the chart must always render
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
