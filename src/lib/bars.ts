/**
 * OHLCV bar access from the DailyBar table + weekly/monthly aggregation
 * helpers used by multi-timeframe scanners and the sector momentum view.
 */

import { db } from "@/lib/db";

export interface Bar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolBars {
  symbol: string;
  bars: Bar[];
}

/** Load daily bars for one symbol, oldest first. */
export async function loadSymbolBars(symbol: string, limit = 500): Promise<SymbolBars> {
  const rows = await db.dailyBar.findMany({
    where: { symbol },
    orderBy: { date: "desc" },
    take: limit,
  });
  const bars: Bar[] = rows
    .reverse()
    .map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  return { symbol, bars };
}

/** Load daily bars for many symbols in one query (for bar-based scanners).
 *
 *  - Strict window: each symbol keeps EXACTLY its most recent `limit` bars.
 *    (The old window arithmetic drifted — it grew ~1 bar per 2 sessions past
 *    the limit, silently changing how many bars every scan evaluated.)
 *  - Date cutoff: `limit` sessions ≈ `limit × 1.45` calendar days (NSE trades
 *    ~252 sessions/year); fetch 30% beyond that so holiday clusters never
 *    shorten the window for actively-trading names. Cuts short-lookback scans
 *    from a full-history pull (~1.2M rows) to a fraction of it.
 */
export async function loadBarsForSymbols(symbols: string[], limit = 260): Promise<Map<string, Bar[]>> {
  if (symbols.length === 0) return new Map();
  const cutoff = new Date(Date.now() - Math.ceil(limit * 1.45 * 1.3) * 86400_000).toISOString().slice(0, 10);
  const rows = await db.dailyBar.findMany({
    where: { symbol: { in: symbols }, date: { gte: cutoff } },
    orderBy: [{ symbol: "asc" }, { date: "asc" }],
  });
  const bySymbol = new Map<string, Bar[]>();
  for (const r of rows) {
    let list = bySymbol.get(r.symbol);
    if (!list) {
      list = [];
      bySymbol.set(r.symbol, list);
    }
    if (list.length >= limit) list.shift();
    list.push({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });
  }
  return bySymbol;
}

function isoMonday(ts: number): string {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return new Date(monday).toISOString().slice(0, 10);
}

function isoMonth(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Aggregate daily bars into weekly bars (Monday-anchored, UTC).
 * The last (possibly partial) week is included — its "close" is the latest close.
 */
export function weeklyBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let cur: { key: string; bar: Bar } | null = null;
  for (const b of bars) {
    const ts = Date.parse(`${b.date}T00:00:00Z`);
    const key = isoMonday(ts);
    if (!cur || cur.key !== key) {
      if (cur) out.push(cur.bar);
      cur = { key, bar: { ...b } };
    } else {
      const c = cur.bar;
      c.high = Math.max(c.high, b.high);
      c.low = Math.min(c.low, b.low);
      c.close = b.close;
      c.volume += b.volume;
    }
  }
  if (cur) out.push(cur.bar);
  return out;
}

/** Aggregate daily bars into calendar-month bars (UTC). */
export function monthlyBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let cur: { key: string; bar: Bar } | null = null;
  for (const b of bars) {
    const ts = Date.parse(`${b.date}T00:00:00Z`);
    const key = isoMonth(ts);
    if (!cur || cur.key !== key) {
      if (cur) out.push(cur.bar);
      cur = { key, bar: { ...b } };
    } else {
      const c = cur.bar;
      c.high = Math.max(c.high, b.high);
      c.low = Math.min(c.low, b.low);
      c.close = b.close;
      c.volume += b.volume;
    }
  }
  if (cur) out.push(cur.bar);
  return out;
}
