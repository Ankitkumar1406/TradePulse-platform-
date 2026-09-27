/**
 * Scanner catalog — the full EOD scan suite (Horizontal Resistance,
 * Tight Setup, Inside Bar, Flags & Pennants, VCP, Shakeout, Gap Up / Gap Filling /
 * Earnings Gap Up / Positive Earnings Reaction, Volume Gainers / High Volume /
 * Dense Volume / Volume Footprint, Momentum Scanner with RS rating, RS High Before
 * Price High, 52 Week High, Recent IPOs, IPO Setups, Circuit Revision, Past
 * Winners, Shorting Scanner). The Multi-Timeframe RSI scans and the Trader
 * Choice screens are TradePulse's own additions.
 *
 * Each scan is a self-contained DB query (+ optional bar-based post-filter).
 */

import { db, descNullsLast } from "@/lib/db";
import { loadBarsForSymbols, weeklyBars, monthlyBars, type Bar } from "@/lib/bars";
import { emaSeries, rsi } from "@/lib/indicators";

export type MetricType = "num" | "pct" | "rsi" | "price" | "vol" | "mcap" | "date" | "x" | "str";

export interface ScanColumn {
  key: string;
  label: string;
  type: MetricType;
}

export interface ScanRow {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  sector: string | null;
  /** Universal RS rating (0-99 percentile of the 6-month return) — attached to every row for chart-grid filters. */
  rs?: number | null;
  /** MarketSmith-style ratings attached to every row (Task 33). */
  epsScore?: number | null; // 1-99 composite growth percentile
  adRating?: string | null; // A+ … E accumulation/distribution grade
  epsChgYoy?: number | null; // latest Q diluted EPS growth YoY, %
  // Trailing performance carried on every row so the results can be re-sorted client-side.
  mom1M?: number | null;
  mom3M?: number | null;
  mom6M?: number | null;
  metrics: Record<string, number | string | null>;
}

export interface ScanResult {
  columns: ScanColumn[];
  rows: ScanRow[];
  scanned: number;
}

export interface ScanDef {
  id: string;
  name: string;
  category: string;
  description: string;
  needsBars?: boolean;
  basic?: boolean;
  /** When set, rows with a live RS rating below this are dropped after the run (keeps code honest to its own description). */
  minRs?: number;
  run: () => Promise<ScanResult>;
}

// ---------------------------------------------------------------- helpers

const BASE_SELECT = {
  symbol: true, name: true, price: true, changePct: true, marketCap: true, sector: true,
  mom1M: true, mom3M: true, mom6M: true,
};

type Cand = {
  symbol: string; name: string; price: number | null; changePct: number | null;
  marketCap: number | null; sector: string | null;
  mom1M?: number | null; mom3M?: number | null; mom6M?: number | null;
} & Record<string, unknown>;

function buildRows(
  stocks: Cand[],
  columns: ScanColumn[],
  metricsFor: (s: Record<string, unknown>) => Record<string, number | string | null>
): ScanRow[] {
  return stocks.map((s) => {
    const r = s as unknown as Record<string, unknown>;
    return {
      symbol: s.symbol, name: s.name, price: s.price, changePct: s.changePct,
      marketCap: s.marketCap, sector: s.sector,
      mom1M: (s.mom1M as number | null) ?? null,
      mom3M: (s.mom3M as number | null) ?? null,
      mom6M: (s.mom6M as number | null) ?? null,
      metrics: metricsFor(r),
    };
  });
}

/** Wrap a raw run so every returned row also carries the universal ratings (RS, EPS score, A/D, EPS chg %). */
function withRs(run: () => Promise<ScanResult>): () => Promise<ScanResult> {
  return async () => {
    const result = await run();
    await attachRs(result.rows);
    return result;
  };
}

/** Wrap a run with the scan's minimum-RS promise (e.g. "RS rating 80+"): rows
 *  whose live RS rating (stored 12M weighted, else 6M percentile) is below the
 *  floor — or missing entirely — are dropped. Applied after attachRs so the
 *  same universal rating the UI displays is what the filter enforces. */
function withMinRs(minRs: number, run: () => Promise<ScanResult>): () => Promise<ScanResult> {
  return async () => {
    const result = await withRs(run)();
    result.rows = result.rows.filter((r) => (r.rs ?? -1) >= minRs);
    return result;
  };
}

async function countUniverse(): Promise<number> {
  return db.stock.count({ where: { price: { not: null } } });
}

/**
 * RS rating map — percentile rank (0-99) of the 6-month return across the whole
 * priced universe. Computed once per run and cached ~15 min; every scan row
 * carries it so the chart grid can filter by RS strength.
 */
async function rsRankMap(): Promise<Map<string, number>> {
  const g = globalThis as unknown as { __tpRsRanks?: { at: number; map: Map<string, number> } };
  const now = Date.now();
  if (g.__tpRsRanks && now - g.__tpRsRanks.at < 15 * 60_000) return g.__tpRsRanks.map;

  const stocks = await db.stock.findMany({
    where: { mom6M: { not: null }, price: { not: null } },
    select: { symbol: true, mom6M: true },
  });
  const sorted = stocks.map((s) => s.mom6M as number).sort((a, b) => a - b);
  const rank = (v: number) => {
    let lo = 0;
    for (const r of sorted) if (r < v) lo++;
    return Math.round((lo / Math.max(1, sorted.length - 1)) * 99);
  };
  const map = new Map(stocks.map((s) => [s.symbol, rank(s.mom6M as number)]));
  g.__tpRsRanks = { at: now, map };
  return map;
}

/**
 * Universal per-stock extras — RS rating (6M percentile, live), plus the
 * MarketSmith-style ratings stored on Stock rows by the ratings recompute
 * (EPS score 1-99, A/D grade A+…E, quarterly EPS growth %). Cached ~15 min;
 * every scan row carries them so all screener outputs show the same columns.
 */
interface UniversalRatings {
  rs: Map<string, number>;
  epsScore: Map<string, number>;
  adRating: Map<string, string>;
  epsChgYoy: Map<string, number>;
}

async function universalRatings(): Promise<UniversalRatings> {
  const g = globalThis as unknown as { __tpUniversalRatings?: { at: number; u: UniversalRatings } };
  const now = Date.now();
  if (g.__tpUniversalRatings && now - g.__tpUniversalRatings.at < 15 * 60_000) return g.__tpUniversalRatings.u;

  const [rsMap, rows] = await Promise.all([
    rsRankMap(),
    db.stock.findMany({
      where: { price: { not: null } },
      select: { symbol: true, rsRating: true, epsScore: true, adRating: true, epsQuarterlyGrowth: true },
    }),
  ]);
  const u: UniversalRatings = {
    rs: rsMap,
    epsScore: new Map(),
    adRating: new Map(),
    epsChgYoy: new Map(),
  };
  for (const s of rows) {
    // MarketSmith-style 12M weighted RS where the ratings recompute has it;
    // fall back to the live 6M percentile otherwise.
    const storedRs = s.rsRating ?? null;
    if (storedRs != null) u.rs.set(s.symbol, storedRs);
    if (s.epsScore != null) u.epsScore.set(s.symbol, s.epsScore);
    if (s.adRating != null) u.adRating.set(s.symbol, s.adRating);
    if (s.epsQuarterlyGrowth != null) u.epsChgYoy.set(s.symbol, Math.round(s.epsQuarterlyGrowth * 1000) / 10);
  }
  g.__tpUniversalRatings = { at: now, u };
  return u;
}

async function attachRs<T extends { symbol: string }>(rows: T[]): Promise<T[]> {
  try {
    const u = await universalRatings();
    for (const r of rows) {
      const x = r as T & { rs?: number | null; epsScore?: number | null; adRating?: string | null; epsChgYoy?: number | null };
      x.rs = u.rs.get(r.symbol) ?? null;
      x.epsScore = u.epsScore.get(r.symbol) ?? null;
      x.adRating = u.adRating.get(r.symbol) ?? null;
      x.epsChgYoy = u.epsChgYoy.get(r.symbol) ?? null;
    }
  } catch {
    /* ratings are best-effort extra columns — never fail a scan over them */
  }
  return rows;
}

/** Null-safe round to 1 decimal — a missing select field must never crash a hit() (blank column, not a 500). */
function r1(x: number | null | undefined): number | null {
  return x == null || !Number.isFinite(x) ? null : Number(x.toFixed(1));
}

function lastBars(bars: Bar[]): { prev: Bar; today: Bar } | null {
  if (bars.length < 3) return null;
  return { prev: bars[bars.length - 2], today: bars[bars.length - 1] };
}

function emaLast(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series[series.length - 1] ?? null;
}

function maxHigh(bars: Bar[], from: number, to: number): number | null {
  if (from < 0 || to > bars.length || from >= to) return null;
  let m = -Infinity;
  for (let i = from; i < to; i++) if (bars[i].high > m) m = bars[i].high;
  return m === -Infinity ? null : m;
}

function minLow(bars: Bar[], from: number, to: number): number | null {
  if (from < 0 || to > bars.length || from >= to) return null;
  let m = Infinity;
  for (let i = from; i < to; i++) if (bars[i].low < m) m = bars[i].low;
  return m === Infinity ? null : m;
}

function rangePct(bars: Bar[], from: number, to: number): number | null {
  const h = maxHigh(bars, from, to);
  const l = minLow(bars, from, to);
  const ref = bars[Math.min(to, bars.length) - 1]?.close;
  if (h == null || l == null || !ref) return null;
  return ((h - l) / ref) * 100;
}

/**
 * Shared runner for bar-based scans: fetch candidates from the DB (the FULL
 * priced universe — an earlier revision cut the pool to the top ~900 by
 * market cap, silently dropping every small-cap hit from the results), load
 * their recent daily bars in CHUNKS (a single query for 3,000+ symbols would
 * materialise ~1M rows at once and OOM the dev server), apply the per-stock
 * predicate, collect metric rows. `hit` returns the metrics object for a
 * match, or null to skip.
 */
async function scanWithBars<T extends Record<string, unknown>>(opts: {
  where?: Record<string, unknown>;
  barsLimit: number;
  minBars: number;
  select?: Record<string, boolean>;
  hit: (s: Cand & T, bars: Bar[]) => Record<string, number | string | null> | null;
  columns: ScanColumn[];
  sortMetric?: string;
  sortDesc?: boolean;
  cap?: number;
}): Promise<ScanResult> {
  const candidates = (await db.stock.findMany({
    // equities only: names without a market cap are funds/ETFs (liquid
    // money-market ETFs sit flat at ₹1,000 and "break out" on noise every
    // other session, flooding breakout/coil scans) — or rows whose mcap
    // column is simply absent, which would render blank anyway
    where: (opts.where ?? { price: { not: null }, marketCap: { not: null } }) as never,
    // deterministic output order; no take — the universe IS the candidate pool
    orderBy: descNullsLast("marketCap"),
    select: { ...BASE_SELECT, ...(opts.select ?? {}) },
  })) as (Cand & T)[];

  // Bars are loaded and evaluated in bounded chunks so peak memory stays flat
  // no matter how large the candidate window is (Trader Choice 5 scans 2,900+).
  const rows: ScanRow[] = [];
  const CHUNK = 400;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const batch = candidates.slice(i, i + CHUNK);
    const barsMap = await loadBarsForSymbols(batch.map((s) => s.symbol), opts.barsLimit);
    for (const s of batch) {
      const bars = barsMap.get(s.symbol);
      if (!bars || bars.length < opts.minBars) continue;
      // per-symbol isolation — one malformed candidate (null field, short
      // history) must never 500 the whole scan
      let metrics: Record<string, number | string | null> | null = null;
      try {
        metrics = opts.hit(s, bars);
      } catch {
        metrics = null;
      }
      if (!metrics) continue;
      rows.push({
        symbol: s.symbol, name: s.name, price: s.price, changePct: s.changePct,
        marketCap: s.marketCap, sector: s.sector,
        mom1M: (s.mom1M as number | null) ?? null,
        mom3M: (s.mom3M as number | null) ?? null,
        mom6M: (s.mom6M as number | null) ?? null,
        metrics,
      });
    }
  }
  if (opts.sortMetric) {
    const key = opts.sortMetric;
    rows.sort((a, b) => {
      const av = a.metrics[key], bv = b.metrics[key];
      const an = typeof av === "number" ? av : -Infinity;
      const bn = typeof bv === "number" ? bv : -Infinity;
      return opts.sortDesc ? bn - an : an - bn;
    });
  }
  const capped = rows.slice(0, opts.cap ?? 60);
  return { columns: opts.columns, rows: capped, scanned: candidates.length };
}

// ---------------------------------------------------------------- chart patterns

const FRESH_BREAKOUT_LEVEL_BARS = 60;

const chartPatternScans: ScanDef[] = [
  {
    id: "resistance-daily", name: "Horizontal Resistance : Daily", category: "Chart Patterns", basic: true, needsBars: true,
    description: "Closed above the highest high of the previous 60 daily sessions — a fresh daily breakout of horizontal resistance.",
    run: () =>
      scanWithBars({
        barsLimit: 75, minBars: 65,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const n = bars.length;
          const level = maxHigh(bars, n - 1 - FRESH_BREAKOUT_LEVEL_BARS, n - 1);
          if (level == null) return null;
          const today = bars[n - 1], yday = bars[n - 2];
          if (today.close <= level || yday.close > level) return null; // fresh only
          if (today.close > level * 1.12) return null; // already runaway
          return {
            breakoutPct: Number(((today.close / level - 1) * 100).toFixed(2)),
            fromHighPct: s.fromHighPct as number,
          };
        },
        columns: [
          { key: "breakoutPct", label: "Above level", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "breakoutPct",
      }),
  },
  {
    id: "resistance-weekly", name: "Horizontal Resistance : Weekly", category: "Chart Patterns", needsBars: true,
    description: "Weekly close above the highest high of the previous 30 weeks — the multi-month base has cleared.",
    run: () =>
      scanWithBars({
        barsLimit: 520, minBars: 220,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const weekly = weeklyBars(bars);
          const n = weekly.length;
          if (n < 32) return null;
          const level = maxHigh(weekly, n - 1 - 30, n - 1);
          if (level == null) return null;
          const today = weekly[n - 1], yday = weekly[n - 2];
          if (today.close <= level || yday.close > level) return null;
          if (today.close > level * 1.15) return null;
          return {
            breakoutPct: Number(((today.close / level - 1) * 100).toFixed(2)),
            fromHighPct: s.fromHighPct as number,
          };
        },
        columns: [
          { key: "breakoutPct", label: "Above level", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "breakoutPct",
      }),
  },
  {
    id: "resistance-monthly", name: "Horizontal Resistance : Monthly", category: "Chart Patterns", needsBars: true,
    description: "Monthly close above the highest high of the previous 18 months — all-time-style structural breakouts.",
    run: () =>
      scanWithBars({
        barsLimit: 520, minBars: 220,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const monthly = monthlyBars(bars);
          const n = monthly.length;
          if (n < 20) return null;
          const level = maxHigh(monthly, n - 1 - 18, n - 1);
          if (level == null) return null;
          const today = monthly[n - 1], yday = monthly[n - 2];
          if (today.close <= level || yday.close > level) return null;
          if (today.close > level * 1.2) return null;
          return {
            breakoutPct: Number(((today.close / level - 1) * 100).toFixed(2)),
            fromHighPct: s.fromHighPct as number,
          };
        },
        columns: [
          { key: "breakoutPct", label: "Above level", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "breakoutPct",
      }),
  },
  {
    id: "tight-daily", name: "Tight Setup : Daily", category: "Chart Patterns", basic: true, needsBars: true,
    description: "Five-day range under 4.5% and ten-day range under 9%, closing in the top quarter — a sideways coil next to the highs.",
    run: () =>
      scanWithBars({
        barsLimit: 60, minBars: 40,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const n = bars.length;
          const r5 = rangePct(bars, n - 5, n);
          const r10 = rangePct(bars, n - 10, n);
          if (r5 == null || r10 == null) return null;
          if (r5 > 4.5 || r10 > 9) return null;
          const h10 = maxHigh(bars, n - 10, n), l10 = minLow(bars, n - 10, n);
          const close = bars[n - 1].close;
          if (h10 == null || l10 == null || h10 <= l10) return null;
          if ((close - l10) / (h10 - l10) < 0.75) return null;
          if (s.fromHighPct == null || (s.fromHighPct as number) > 15) return null; // too far below the 52w high (unknown ⇒ exclude)
          return { tightRange5: Number(r5.toFixed(2)), fromHighPct: s.fromHighPct as number };
        },
        columns: [
          { key: "tightRange5", label: "5-bar range %", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "tightRange5",
      }),
  },
  {
    id: "tight-weekly", name: "Tight Setup : Weekly", category: "Chart Patterns", needsBars: true,
    description: "Five-week range under 10% with the weekly close in the top quarter — the quiet base before expansion.",
    run: () =>
      scanWithBars({
        barsLimit: 520, minBars: 220,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const weekly = weeklyBars(bars);
          const n = weekly.length;
          if (n < 16) return null;
          const r5 = rangePct(weekly, n - 5, n);
          if (r5 == null || r5 > 10) return null;
          const h5 = maxHigh(weekly, n - 5, n), l5 = minLow(weekly, n - 5, n);
          const close = weekly[n - 1].close;
          if (h5 == null || l5 == null || h5 <= l5) return null;
          if ((close - l5) / (h5 - l5) < 0.75) return null;
          if (s.fromHighPct == null || (s.fromHighPct as number) > 15) return null; // too far below the 52w high (unknown ⇒ exclude)
          return { tightRange5: Number(r5.toFixed(2)), fromHighPct: s.fromHighPct as number };
        },
        columns: [
          { key: "tightRange5", label: "5-week range %", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "tightRange5",
      }),
  },
  {
    id: "inside-daily", name: "Inside Bar : Daily", category: "Chart Patterns", basic: true, needsBars: true,
    description: "Today's range sits fully inside yesterday's bar and the prior bar traded 1.5%+ — compression before expansion.",
    run: () =>
      scanWithBars({
        barsLimit: 12, minBars: 3,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const pair = lastBars(bars);
          if (!pair) return null;
          const { prev, today } = pair;
          const prevRange = ((prev.high - prev.low) / prev.close) * 100;
          if (prevRange < 1.5) return null;
          if (!(today.high < prev.high && today.low > prev.low)) return null;
          return { prevRangePct: Number(prevRange.toFixed(2)), fromHighPct: s.fromHighPct as number };
        },
        columns: [
          { key: "prevRangePct", label: "Prev range %", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
      }),
  },
  {
    id: "inside-weekly", name: "Inside Bar : Weekly", category: "Chart Patterns", needsBars: true,
    description: "This week's range is fully inside last week's bar — a pause inside a weekly candle, often pre-breakout.",
    run: () =>
      scanWithBars({
        barsLimit: 520, minBars: 220,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const weekly = weeklyBars(bars);
          if (weekly.length < 3) return null;
          const prev = weekly[weekly.length - 2], today = weekly[weekly.length - 1];
          const prevRange = ((prev.high - prev.low) / prev.close) * 100;
          if (prevRange < 2.5) return null;
          if (!(today.high < prev.high && today.low > prev.low)) return null;
          return { prevRangePct: Number(prevRange.toFixed(2)), fromHighPct: s.fromHighPct as number };
        },
        columns: [
          { key: "prevRangePct", label: "Prev range %", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
      }),
  },
  {
    id: "flags-pennants", name: "Flags & Pennants", category: "Chart Patterns", needsBars: true,
    description: "A sharp 12%+ pole followed by a shallow 2-15% drift sideways, price holding above the pole base — continuation pocket.",
    run: () =>
      scanWithBars({
        barsLimit: 70, minBars: 50,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const n = bars.length;
          let best: { poleEnd: number; ret: number } | null = null;
          // the pole reads 9 bars ahead — i must keep i+9 inside the array
          // (i <= n-10); the old open-ended bound read past the last bar.
          for (let i = n - 45; i <= n - 1 - 9; i++) {
            if (i < 0) continue;
            const ret = (bars[i + 9].close / bars[i].close - 1) * 100;
            if (ret >= 12 && (!best || i + 9 > best.poleEnd)) best = { poleEnd: i + 9, ret };
          }
          if (!best) return null;
          const flagBars = n - 1 - best.poleEnd;
          if (flagBars < 3 || flagBars > 12) return null;
          const flagHigh = maxHigh(bars, best.poleEnd, n);
          if (flagHigh == null) return null;
          const pullback = ((flagHigh - bars[n - 1].close) / flagHigh) * 100;
          if (pullback < 2 || pullback > 15) return null;
          const poleBase = bars[best.poleEnd - 9].close;
          if (bars[n - 1].close < poleBase) return null;
          return {
            poleRet: Number(best.ret.toFixed(1)),
            pullbackPct: Number(pullback.toFixed(1)),
            fromHighPct: s.fromHighPct as number,
          };
        },
        columns: [
          { key: "poleRet", label: "Pole gain", type: "pct" },
          { key: "pullbackPct", label: "Flag depth", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "pullbackPct",
      }),
  },
  {
    id: "vcp", name: "VCP", category: "Chart Patterns", needsBars: true,
    description: "Volatility Contraction Pattern — three successive range contractions into a tight 6% final base with drying volume, near the 52-week high.",
    run: () =>
      scanWithBars({
        barsLimit: 70, minBars: 50,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const n = bars.length;
          const w1 = rangePct(bars, n - 45, n - 30);
          const w2 = rangePct(bars, n - 30, n - 15);
          const w3 = rangePct(bars, n - 15, n);
          if (w1 == null || w2 == null || w3 == null) return null;
          if (w1 < 12) return null;               // needs a volatile base to contract from
          if (w2 >= w1 * 0.85) return null;        // contraction 1
          if (w3 >= w2 * 0.85) return null;        // contraction 2
          if (w3 > 6) return null;                 // final tightness
          if ((s.fromHighPct as number) > 12) return null; // too far below the 52w high
          const avgVol = (from: number, to: number) => {
            let sum = 0;
            for (let i = from; i < to; i++) sum += bars[i].volume || 0;
            return sum / Math.max(1, to - from);
          };
          const earlyVol = avgVol(n - 45, n - 30), tailVol = avgVol(n - 6, n);
          if (earlyVol > 0 && tailVol / earlyVol > 1.05) return null;
          return {
            r1: Number(w1.toFixed(1)), r2: Number(w2.toFixed(1)), r3: Number(w3.toFixed(1)),
            fromHighPct: s.fromHighPct as number,
          };
        },
        columns: [
          { key: "r1", label: "Range 1 %", type: "pct" },
          { key: "r2", label: "Range 2 %", type: "pct" },
          { key: "r3", label: "Range 3 %", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "r3",
      }),
  },
];

// ---------------------------------------------------------------- gaps & earnings

const gapEarningsScans: ScanDef[] = [
  {
    id: "gap-up", name: "Gap Up", category: "Gaps & Earnings", basic: true,
    description: "Opened more than 2% above yesterday's close — overnight demand or news. The gap size is ranked so the strongest openings surface first.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "gapPct", label: "Gap %", type: "pct" },
        { key: "changePct", label: "Change", type: "pct" },
      ];
      const stocks = await db.stock.findMany({
        where: { open: { not: null }, prevClose: { not: null }, price: { not: null }, marketCap: { not: null } },
        orderBy: descNullsLast("marketCap"), select: { ...BASE_SELECT, open: true, prevClose: true },
      });
      const filtered = stocks
        .filter((s) => s.prevClose && (s.open as number) > (s.prevClose as number) * 1.02)
        .sort((a, b) => (b.open as number) / (b.prevClose as number) - (a.open as number) / (a.prevClose as number))
        .slice(0, 60);
      return {
        columns,
        rows: buildRows(filtered, columns, (s) => ({
          gapPct: s.prevClose ? Number((((s.open as number) - (s.prevClose as number)) / (s.prevClose as number) * 100).toFixed(2)) : null,
          changePct: s.changePct as number,
        })),
        scanned: await countUniverse(),
      };
    },
  },
  {
    id: "gap-filling", name: "Gap Filling", category: "Gaps & Earnings", needsBars: true,
    description: "A recent up-gap is being traded back into — price is re-entering the unfilled zone left behind by the gap day.",
    run: () =>
      scanWithBars({
        barsLimit: 15, minBars: 8,
        hit: (_s, bars) => {
          const n = bars.length;
          const today = bars[n - 1];
          for (let g = n - 6; g <= n - 2; g++) {
            if (g < 1) continue;
            const gapDay = bars[g], before = bars[g - 1];
            if (gapDay.open <= before.close * 1.01) continue;
            const zoneTop = gapDay.open, zoneBottom = before.close;
            if (today.low > zoneTop || today.close < zoneBottom) continue;
            const depth = zoneTop - zoneBottom;
            const fillPct = depth > 0 ? ((zoneTop - today.low) / depth) * 100 : 100;
            return {
              fillPct: Number(Math.min(100, fillPct).toFixed(0)),
              daysSince: n - 1 - g,
            };
          }
          return null;
        },
        columns: [
          { key: "fillPct", label: "Gap filled", type: "pct" },
          { key: "daysSince", label: "Days since gap", type: "num" },
        ],
        sortMetric: "fillPct",
      }),
  },
  {
    id: "earnings-gap-up", name: "Earnings Gap Up", category: "Gaps & Earnings",
    description: "Gapped up 2%+ with results announced in the last 4 days — the market paid for the print.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "gapPct", label: "Gap %", type: "pct" },
        { key: "earningsDate", label: "Earnings date", type: "date" },
      ];
      const stocks = await db.stock.findMany({
        where: {
          open: { not: null }, prevClose: { not: null }, price: { not: null }, marketCap: { not: null },
          earningsDate: { gte: new Date(Date.now() - 4 * 86400_000), lte: new Date() },
        },
        orderBy: descNullsLast("marketCap"), select: { ...BASE_SELECT, open: true, prevClose: true, earningsDate: true },
      });
      const filtered = stocks
        .filter((s) => s.prevClose && (s.open as number) > (s.prevClose as number) * 1.02)
        .sort((a, b) => (b.open as number) / (b.prevClose as number) - (a.open as number) / (a.prevClose as number))
        .slice(0, 60);
      return {
        columns,
        rows: buildRows(filtered, columns, (s) => ({
          gapPct: s.prevClose ? Number((((s.open as number) - (s.prevClose as number)) / (s.prevClose as number) * 100).toFixed(2)) : null,
          earningsDate: (s.earningsDate as Date)?.toISOString().slice(0, 10) ?? null,
        })),
        scanned: await countUniverse(),
      };
    },
  },
  {
    id: "positive-earnings", name: "Positive Earnings Reaction", category: "Gaps & Earnings", needsBars: true,
    description: "Results in the last 10 days and the stock is up 2%+ since the announcement bar — constructive post-earnings drift.",
    run: () =>
      scanWithBars({
        where: {
          price: { not: null },
          marketCap: { not: null },
          earningsDate: { gte: new Date(Date.now() - 10 * 86400_000), lte: new Date() },
        },
        barsLimit: 30, minBars: 5,
        select: { earningsDate: true },
        hit: (s, bars) => {
          const ed = (s.earningsDate as Date)?.toISOString().slice(0, 10);
          if (!ed) return null;
          let idx = bars.findIndex((b) => b.date >= ed);
          if (idx < 1) idx = bars.length - 1; // announcement bar not in bars yet — use latest
          const before = bars[Math.max(0, idx - 1)].close;
          const now = bars[bars.length - 1].close;
          const reaction = ((now / before) - 1) * 100;
          if (reaction < 2) return null;
          return {
            reactionPct: Number(reaction.toFixed(2)),
            earningsDate: ed,
          };
        },
        columns: [
          { key: "reactionPct", label: "Since results", type: "pct" },
          { key: "earningsDate", label: "Earnings date", type: "date" },
        ],
        sortMetric: "reactionPct", sortDesc: true,
      }),
  },
];

// ---------------------------------------------------------------- shakeout

function shakeoutScan(emaPeriod: number): () => Promise<ScanResult> {
  return () =>
    scanWithBars({
      barsLimit: 220, minBars: emaPeriod + 10,
      hit: (_s, bars) => {
        const n = bars.length;
        const closes = bars.map((b) => b.close);
        const ema = emaLast(closes, emaPeriod);
        if (ema == null) return null;
        const today = bars[n - 1];
        // intraday dip below the EMA, reclaimed by the close on a green candle
        if (!(today.low < ema && today.close > ema && today.close > today.open)) return null;
        return {
          emaDistPct: Number(((today.close / ema - 1) * 100).toFixed(2)),
          dipPct: Number(((ema / today.low - 1) * 100).toFixed(2)),
        };
      },
      columns: [
        { key: "emaDistPct", label: "Close vs EMA", type: "pct" },
        { key: "dipPct", label: "Dip below EMA", type: "pct" },
      ],
      sortMetric: "dipPct", sortDesc: true,
    });
}

const shakeoutScans: ScanDef[] = [
  { id: "shakeout-200", name: "Shakeout : 200 EMA", category: "Shakeout", needsBars: true,
    description: "Dipped below the 200 EMA intraday and closed back above it on a green candle — long-term support defended.",
    run: shakeoutScan(200) },
  { id: "shakeout-50", name: "Shakeout : 50 EMA", category: "Shakeout", basic: true, needsBars: true,
    description: "Dipped below the 50 EMA intraday and closed back above it — swing traders' shakeout of weak hands.",
    run: shakeoutScan(50) },
  { id: "shakeout-21", name: "Shakeout : 21 EMA", category: "Shakeout", needsBars: true,
    description: "Intraday pierce of the 21 EMA reclaimed by the close — short-term trend still intact after the flush.",
    run: shakeoutScan(21) },
  { id: "shakeout-10", name: "Shakeout : 10 EMA", category: "Shakeout", needsBars: true,
    description: "Intraday dip below the 10 EMA that closed back above — momentum names testing the fast line.",
    run: shakeoutScan(10) },
];

// ---------------------------------------------------------------- volume

const volumeScans: ScanDef[] = [
  {
    id: "volume-gainers", name: "Volume Gainers", category: "Volume", basic: true,
    description: "Today's volume is 2x or more of the 3-month average on an up move — the day's biggest volume-backed gainers.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "volRatio", label: "Vol vs 3M avg", type: "x" },
        { key: "changePct", label: "Change", type: "pct" },
      ];
      const stocks = await db.stock.findMany({
        where: { changePct: { gt: 0 }, volume: { not: null }, avgVol3M: { not: null, gt: 0 }, price: { not: null }, marketCap: { not: null } },
        orderBy: descNullsLast("volume"),
        select: { ...BASE_SELECT, volume: true, avgVol3M: true },
      });
      const rows = buildRows(stocks, columns, (s) => ({
        volRatio: s.volume != null && s.avgVol3M ? Number(((s.volume as number) / (s.avgVol3M as number)).toFixed(2)) : null,
        changePct: s.changePct as number,
      }));
      const hit = rows.filter((r) => (r.metrics.volRatio as number) >= 2);
      hit.sort((a, b) => (b.metrics.volRatio as number) - (a.metrics.volRatio as number));
      return { columns, rows: hit.slice(0, 60), scanned: stocks.length };
    },
  },
  {
    id: "volume-spike", name: "Volume Spike", category: "Volume", basic: true, needsBars: true,
    description: "Today's volume exploded to 2.5x or more of its 20-session average — a sudden burst of attention worth inspecting.",
    run: () =>
      scanWithBars({
        barsLimit: 25, minBars: 21,
        hit: (_s, bars) => {
          const n = bars.length;
          const vols = bars.map((b) => b.volume || 0);
          const avg20 = vols.slice(-21, -1).reduce((a, v) => a + v, 0) / 20;
          if (avg20 <= 0) return null;
          const ratio = vols[n - 1] / avg20;
          if (ratio < 2.5) return null;
          return { spike: Number(ratio.toFixed(2)), changePct: null };
        },
        columns: [
          { key: "spike", label: "Vol vs 20d avg", type: "x" },
          { key: "changePct", label: "Change", type: "pct" },
        ],
        sortMetric: "spike", sortDesc: true,
      }),
  },
  {
    id: "high-volume", name: "High Volume Stocks", category: "Volume", needsBars: true,
    description: "Today traded the heaviest volume of the last 60 sessions at 1.8x the average — attention is arriving.",
    run: () =>
      scanWithBars({
        barsLimit: 70, minBars: 61,
        hit: (_s, bars) => {
          const n = bars.length;
          const vols = bars.map((b) => b.volume || 0);
          const today = vols[n - 1];
          const avg = vols.slice(-61, -1).reduce((a, v) => a + v, 0) / 60;
          if (avg <= 0) return null;
          if (today < Math.max(...vols.slice(-61, -1))) return null; // must be the 60-day max
          const ratio = today / avg;
          if (ratio < 1.8) return null;
          return { volVsAvg: Number(ratio.toFixed(2)), changePct: null };
        },
        columns: [
          { key: "volVsAvg", label: "Vol vs 60d avg", type: "x" },
          { key: "changePct", label: "Change", type: "pct" },
        ],
        sortMetric: "volVsAvg", sortDesc: true,
      }),
  },
  {
    id: "dense-volume", name: "Dense Volume", category: "Volume", needsBars: true,
    description: "Three or more of the last six sessions traded at 2x the 60-day average with a net up move — sustained accumulation.",
    run: () =>
      scanWithBars({
        barsLimit: 70, minBars: 61,
        hit: (_s, bars) => {
          const n = bars.length;
          const vols = bars.map((b) => b.volume || 0);
          const avg = vols.slice(-61, -1).reduce((a, v) => a + v, 0) / 60;
          if (avg <= 0) return null;
          let heavy = 0;
          for (let i = n - 6; i < n; i++) if (vols[i] > 2 * avg) heavy++;
          if (heavy < 3) return null;
          const ret6 = ((bars[n - 1].close / bars[n - 7].close) - 1) * 100;
          if (ret6 < 0) return null;
          return { heavyDays: heavy, ret6: Number(ret6.toFixed(2)) };
        },
        columns: [
          { key: "heavyDays", label: "Heavy days", type: "num" },
          { key: "ret6", label: "6-day return", type: "pct" },
        ],
        sortMetric: "heavyDays", sortDesc: true,
      }),
  },
  {
    id: "volume-footprint", name: "Volume Footprint", category: "Volume", needsBars: false,
    description: "Turnover of ₹25 Cr+ today with a 1.5x volume multiple on an up day — institutional-scale money changing hands.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "turnoverCr", label: "Turnover ₹Cr", type: "num" },
        { key: "volRatio", label: "Vol vs 3M avg", type: "x" },
      ];
      const stocks = await db.stock.findMany({
        where: { changePct: { gt: 0 }, volume: { not: null }, avgVol3M: { not: null, gt: 0 }, price: { not: null }, marketCap: { not: null } },
        orderBy: descNullsLast("volume"),
        select: { ...BASE_SELECT, volume: true, avgVol3M: true },
      });
      const rows = buildRows(stocks, columns, (s) => ({
        turnoverCr: s.volume != null && s.price != null ? Number(((s.volume as number) * (s.price as number) / 1e7).toFixed(1)) : null,
        volRatio: s.volume != null && s.avgVol3M ? Number(((s.volume as number) / (s.avgVol3M as number)).toFixed(2)) : null,
      }));
      const hit = rows.filter((r) => (r.metrics.turnoverCr as number) >= 25 && (r.metrics.volRatio as number) >= 1.5);
      hit.sort((a, b) => (b.metrics.turnoverCr as number) - (a.metrics.turnoverCr as number));
      return { columns, rows: hit.slice(0, 60), scanned: stocks.length };
    },
  },
];

// ---------------------------------------------------------------- momentum & RS

const rsScans: ScanDef[] = [
  {
    id: "momentum-scanner", name: "Momentum Scanner", category: "Momentum & RS", basic: true,
    description: "RS rating above 80 (6-month return in the market's top fifth) while trading within 10% of the 52-week high — the flagship momentum screen.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "rsRating", label: "RS rating", type: "num" },
        { key: "mom6M", label: "6M return", type: "pct" },
        { key: "fromHighPct", label: "From 52W high", type: "pct" },
      ];
      const stocks = await db.stock.findMany({
        where: { mom6M: { not: null }, fromHighPct: { not: null }, price: { not: null }, marketCap: { not: null } },
        orderBy: descNullsLast("marketCap"),
        select: { ...BASE_SELECT, mom6M: true, fromHighPct: true },
      });
      const returns = stocks.map((s) => s.mom6M as number).sort((a, b) => a - b);
      const pctRank = (v: number) => {
        let lo = 0;
        for (const r of returns) if (r < v) lo++;
        return Math.round((lo / Math.max(1, returns.length - 1)) * 99);
      };
      const rows = buildRows(stocks, columns, (s) => ({
        rsRating: pctRank(s.mom6M as number),
        mom6M: s.mom6M as number,
        fromHighPct: s.fromHighPct as number,
      }));
      // fromHighPct = % below the 52w high (0 = at the high) — "within 10%" means <= 10
      const hit = rows.filter((r) => (r.metrics.rsRating as number) >= 80 && (r.metrics.fromHighPct as number) <= 10);
      hit.sort((a, b) => (b.metrics.rsRating as number) - (a.metrics.rsRating as number));
      return { columns, rows: hit.slice(0, 60), scanned: stocks.length };
    },
  },
  {
    id: "rs-high-before-price", name: "RS High Before Price High", category: "Momentum & RS",
    description: "Relative strength already in the market's top 15% while price is still 5%+ below its 52-week high — leadership shows in RS before it shows in price.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "rsRating", label: "RS rating", type: "num" },
        { key: "mom3M", label: "3M return", type: "pct" },
        { key: "fromHighPct", label: "From 52W high", type: "pct" },
      ];
      const stocks = await db.stock.findMany({
        where: { mom3M: { not: null }, fromHighPct: { not: null }, price: { not: null }, marketCap: { not: null } },
        orderBy: descNullsLast("marketCap"),
        select: { ...BASE_SELECT, mom3M: true, fromHighPct: true },
      });
      const returns = stocks.map((s) => s.mom3M as number).sort((a, b) => a - b);
      const pctRank = (v: number) => {
        let lo = 0;
        for (const r of returns) if (r < v) lo++;
        return Math.round((lo / Math.max(1, returns.length - 1)) * 99);
      };
      const rows = buildRows(stocks, columns, (s) => ({
        rsRating: pctRank(s.mom3M as number),
        mom3M: s.mom3M as number,
        fromHighPct: s.fromHighPct as number,
      }));
      // 5–20% below the 52w high (fromHighPct is positive-below-high)
      const hit = rows.filter((r) => (r.metrics.rsRating as number) >= 85 && (r.metrics.fromHighPct as number) >= 5 && (r.metrics.fromHighPct as number) <= 20);
      hit.sort((a, b) => (b.metrics.rsRating as number) - (a.metrics.rsRating as number));
      return { columns, rows: hit.slice(0, 60), scanned: stocks.length };
    },
  },
  {
    id: "w52-high", name: "52 Week High", category: "Momentum & RS", basic: true,
    description: "Trading at or within 0.5% of the 52-week high — the strength list that trend systems live on.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "fromHighPct", label: "From 52W high", type: "pct" },
        { key: "mom3M", label: "3M return", type: "pct" },
      ];
      // fromHighPct = % below the 52w high (0 = at the high). Take EVERY stock
      // within 0.5% of it, closest first — the old top-60-by-mcap query cut
      // valid names purely for their size.
      const stocks = await db.stock.findMany({
        where: { fromHighPct: { lte: 0.5 }, price: { not: null }, marketCap: { not: null } },
        orderBy: [{ fromHighPct: "asc" }, descNullsLast("marketCap")],
        select: { ...BASE_SELECT, fromHighPct: true, mom3M: true },
      });
      return { columns, rows: buildRows(stocks, columns, (s) => ({ fromHighPct: s.fromHighPct as number, mom3M: s.mom3M as number })).slice(0, 60), scanned: await countUniverse() };
    },
  },
];

// ---------------------------------------------------------------- specialty

const specialtyScans: ScanDef[] = [
  {
    id: "recent-ipos", name: "Recent IPOs", category: "Specialty", needsBars: true,
    description: "Listed within roughly the last 90 sessions — the fresh-quote list, newest first.",
    run: () =>
      scanWithBars({
        barsLimit: 100, minBars: 1,
        hit: (_s, bars) => {
          const listedDays = bars.length;
          if (listedDays > 90) return null;
          return { listedDays, changePct: null };
        },
        columns: [
          { key: "listedDays", label: "Sessions listed", type: "num" },
          { key: "changePct", label: "Change", type: "pct" },
        ],
        sortMetric: "listedDays",
      }),
  },
  {
    id: "ipo-setups", name: "IPO Setups", category: "Specialty", needsBars: true,
    description: "Recent listings holding above their 20 & 50 EMA within 12% of the post-IPO high and coiling — constructive bases under a year old.",
    run: () =>
      scanWithBars({
        barsLimit: 130, minBars: 25,
        hit: (_s, bars) => {
          const n = bars.length;
          if (n > 120) return null;
          const closes = bars.map((b) => b.close);
          const e20 = emaLast(closes, 20), e50 = emaLast(closes, 50);
          const close = closes[n - 1];
          if (e20 == null || e50 == null) return null;
          if (!(close > e20 && close > e50)) return null;
          const ipoHigh = Math.max(...bars.map((b) => b.high));
          const fromIpoHighPct = ((close / ipoHigh) - 1) * 100;
          if (fromIpoHighPct < -12) return null;
          const r10 = rangePct(bars, n - 10, n);
          if (r10 == null || r10 > 9) return null;
          return {
            fromIpoHighPct: Number(fromIpoHighPct.toFixed(1)),
            listedDays: n,
          };
        },
        columns: [
          { key: "fromIpoHighPct", label: "From IPO high", type: "pct" },
          { key: "listedDays", label: "Sessions listed", type: "num" },
        ],
        sortMetric: "fromIpoHighPct",
      }),
  },
  {
    id: "circuit-revision", name: "Circuit Revision", category: "Specialty",
    description: "Moved 8.5% or more on 1.5x average volume — stocks pressing toward (or under) their price bands today.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "changePct", label: "Change", type: "pct" },
        { key: "volRatio", label: "Vol vs 3M avg", type: "x" },
      ];
      const stocks = await db.stock.findMany({
        where: {
          changePct: { gte: 8.5, lte: 100 }, volume: { not: null }, avgVol3M: { not: null, gt: 0 }, price: { not: null }, marketCap: { not: null },
        },
        orderBy: descNullsLast("changePct"),
        select: { ...BASE_SELECT, volume: true, avgVol3M: true },
      });
      const downs = await db.stock.findMany({
        where: {
          changePct: { lte: -8.5, gte: -100 }, volume: { not: null }, avgVol3M: { not: null, gt: 0 }, price: { not: null }, marketCap: { not: null },
        },
        orderBy: { changePct: "asc" },
        select: { ...BASE_SELECT, volume: true, avgVol3M: true },
      });
      const all = [...stocks, ...downs];
      const rows = buildRows(all, columns, (s) => ({
        changePct: s.changePct as number,
        volRatio: s.volume != null && s.avgVol3M ? Number(((s.volume as number) / (s.avgVol3M as number)).toFixed(2)) : null,
      }));
      const hit = rows.filter((r) => Math.abs(r.metrics.changePct as number) >= 8.5 && (r.metrics.volRatio as number) >= 1.5);
      hit.sort((a, b) => Math.abs(b.metrics.changePct as number) - Math.abs(a.metrics.changePct as number));
      return { columns, rows: hit.slice(0, 60), scanned: await countUniverse() };
    },
  },
  {
    id: "past-winners", name: "Past Winners", category: "Specialty",
    description: "Up 8%+ in a month and 15%+ in three while holding the 50 SMA near highs — established moves that are still working.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "mom1M", label: "1M return", type: "pct" },
        { key: "mom3M", label: "3M return", type: "pct" },
        { key: "fromHighPct", label: "From 52W high", type: "pct" },
      ];
      const stocks = await db.stock.findMany({
        where: { mom1M: { gte: 8 }, mom3M: { gte: 15 }, aboveSma50: true, fromHighPct: { lte: 12 }, price: { not: null }, marketCap: { not: null } },
        orderBy: descNullsLast("mom3M"),
        select: { ...BASE_SELECT, mom1M: true, mom3M: true, fromHighPct: true },
      });
      return {
        columns,
        rows: buildRows(stocks, columns, (s) => ({ mom1M: s.mom1M as number, mom3M: s.mom3M as number, fromHighPct: s.fromHighPct as number })).slice(0, 60),
        scanned: await countUniverse(),
      };
    },
  },
  {
    id: "shorting", name: "Shorting Scanner", category: "Specialty",
    description: "Below the 50 SMA with negative MACD, RSI capped under 60 and 10%+ off the high — the relative-weakness side of the market.",
    run: async () => {
      const columns: ScanColumn[] = [
        { key: "rsi14", label: "RSI (14)", type: "rsi" },
        { key: "fromHighPct", label: "From 52W high", type: "pct" },
        { key: "changePct", label: "Change", type: "pct" },
      ];
      const stocks = await db.stock.findMany({
        where: {
          aboveSma50: false, macdHist: { lt: 0 }, rsi14: { gte: 35, lte: 60 },
          fromHighPct: { gte: 10 }, changePct: { lt: 0 }, price: { not: null }, marketCap: { not: null },
        },
        orderBy: { rsi14: "asc" },
        select: { ...BASE_SELECT, rsi14: true, fromHighPct: true },
      });
      return {
        columns,
        rows: buildRows(stocks, columns, (s) => ({ rsi14: s.rsi14 as number, fromHighPct: s.fromHighPct as number, changePct: s.changePct as number })).slice(0, 60),
        scanned: await countUniverse(),
      };
    },
  },
];

// ------------------------------------------------------- multi-timeframe RSI
// TradePulse addition.

async function multiTimeframeRsi(dailyMin: number, dailyMax: number): Promise<ScanResult> {
  const columns: ScanColumn[] = [
    { key: "mRSI", label: "Monthly RSI", type: "rsi" },
    { key: "wRSI", label: "Weekly RSI", type: "rsi" },
    { key: "dRSI", label: "Daily RSI", type: "rsi" },
    { key: "fromHighPct", label: "From 52W high", type: "pct" },
  ];
  // cheap prefilter on the stored daily RSI before loading bars
  const candidates = await db.stock.findMany({
    where: { rsi14: { gte: 30, lte: 70 }, price: { not: null }, marketCap: { not: null } },
    orderBy: descNullsLast("marketCap"),
    select: { ...BASE_SELECT, rsi14: true, fromHighPct: true },
  });
  const rows: ScanRow[] = [];
  // bars load in bounded chunks — a full-universe 520-bar pull in one query
  // materialises ~1.5M rows (OOM precedent on the 4GB box)
  const CHUNK = 400;
  outer: for (let i = 0; i < candidates.length; i += CHUNK) {
    const batch = candidates.slice(i, i + CHUNK);
    const barsMap = await loadBarsForSymbols(batch.map((s) => s.symbol), 520);
    for (const s of batch) {
      const bars = barsMap.get(s.symbol);
      if (!bars || bars.length < 60) continue;
      const monthly = monthlyBars(bars).map((b: Bar) => b.close);
      const weekly = weeklyBars(bars).map((b: Bar) => b.close);
      const mRsi = monthly.length >= 15 ? rsi(monthly) : null;
      const wRsi = weekly.length >= 15 ? rsi(weekly) : null;
      const dRsi = bars.length >= 20 ? rsi(bars.map((b) => b.close)) : null;
      if (mRsi == null || wRsi == null || dRsi == null) continue;
      if (!(mRsi > 60 && wRsi > 60 && dRsi > dailyMin && dRsi < dailyMax)) continue;
      rows.push({
        symbol: s.symbol, name: s.name, price: s.price, changePct: s.changePct,
        marketCap: s.marketCap, sector: s.sector,
        mom1M: (s.mom1M as number | null) ?? null,
        mom3M: (s.mom3M as number | null) ?? null,
        mom6M: (s.mom6M as number | null) ?? null,
        metrics: {
          mRSI: Number(mRsi.toFixed(1)), wRSI: Number(wRsi.toFixed(1)),
          dRSI: Number(dRsi.toFixed(1)), fromHighPct: s.fromHighPct,
        },
      });
      if (rows.length >= 60) break outer;
    }
  }
  rows.sort((a, b) => (a.metrics.dRSI as number) - (b.metrics.dRSI as number));
  return { columns, rows, scanned: candidates.length };
}

const mtfScans: ScanDef[] = [
  {
    id: "mtf-3stage", name: "3 Stage RSI", category: "Multi-Timeframe RSI", needsBars: true,
    description: "TradePulse addition — monthly RSI > 60, weekly RSI > 60, daily RSI pulled back into the 38-45 buy zone: the classic 3-stage setup.",
    run: () => multiTimeframeRsi(38, 45),
  },
  {
    id: "mtf-advanced", name: "Advanced 3 Stage RSI", category: "Multi-Timeframe RSI", needsBars: true,
    description: "TradePulse addition — monthly RSI > 60, weekly RSI > 60, daily RSI holding 58-65: strength never really left; continuation setup.",
    run: () => multiTimeframeRsi(58, 65),
  },
];

// -------------------------------------------------------------- Trader Choice
// Six hand-picked multi-condition screens, each rebuilt from our own bar-based
// primitives and numbered Trader Choice 1–6 (the last one is a 6-signal
// confluence screen that counts how many independent signals a stock fires).

function volAvg(bars: Bar[], from: number, to: number): number {
  let sum = 0;
  for (let i = Math.max(0, from); i < to; i++) sum += bars[i].volume || 0;
  return sum / Math.max(1, to - Math.max(0, from));
}

const traderChoiceScans: ScanDef[] = [
  {
    id: "trader-choice-1", name: "Trader Choice 1", category: "Trader Choice", needsBars: true, minRs: 80,
    description: "Momentum & breakout setup — RS rating 80+, within 12% of the 52-week high, a tightening 10-day coil, stacked 20>50 EMAs and above-average volume.",
    run: () =>
      scanWithBars({
        barsLimit: 70, minBars: 60,
        select: { fromHighPct: true, mom6M: true },
        hit: (s, bars) => {
          const n = bars.length;
          if (s.fromHighPct == null || (s.fromHighPct as number) > 12) return null; // too far below the 52w high
          const r10 = rangePct(bars, n - 10, n);
          if (r10 == null || r10 > 12) return null;
          const closes = bars.map((b) => b.close);
          const e20 = emaLast(closes, 20), e50 = emaLast(closes, 50);
          const close = closes[n - 1];
          if (e20 == null || e50 == null || !(close > e20 && e20 > e50)) return null;
          const vol = volAvg(bars, n - 20, n - 1);
          if (vol > 0 && (bars[n - 1].volume || 0) < vol) return null;
          return {
            fromHighPct: r1(s.fromHighPct as number),
            tightRange10: Number(r10.toFixed(1)),
            mom6M: r1(s.mom6M as number),
          };
        },
        columns: [
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
          { key: "tightRange10", label: "10-day range", type: "pct" },
          { key: "mom6M", label: "6M return", type: "pct" },
        ],
        sortMetric: "fromHighPct", sortDesc: true,
      }),
  },
  {
    id: "trader-choice-2", name: "Trader Choice 2", category: "Trader Choice", needsBars: true,
    description: "Clean technicals & price action — a fresh 20-session high booked with a narrow-range or inside day, trending above the 50 EMA and not more than 10% off the high.",
    run: () =>
      scanWithBars({
        barsLimit: 70, minBars: 60,
        select: { fromHighPct: true },
        hit: (s, bars) => {
          const n = bars.length;
          if (s.fromHighPct == null || (s.fromHighPct as number) > 10) return null; // too far below the 52w high
          const closes = bars.map((b) => b.close);
          const e50 = emaLast(closes, 50);
          if (e50 == null || closes[n - 1] <= e50) return null;
          const priorHigh = maxHigh(bars, n - 21, n - 1);
          if (priorHigh == null) return null;
          const today = bars[n - 1];
          if (today.close <= priorHigh) return null;
          const yday = bars[n - 2];
          const ydayRange = ((yday.high - yday.low) / yday.close) * 100;
          const inside = today.high < yday.high && today.low > yday.low;
          if (!inside && ydayRange > 4.5) return null; // needs a coil or inside day
          return {
            newHighPct: Number(((today.close / priorHigh - 1) * 100).toFixed(2)),
            prevRangePct: Number(ydayRange.toFixed(2)),
            fromHighPct: r1(s.fromHighPct as number),
          };
        },
        columns: [
          { key: "newHighPct", label: "Above 20d high", type: "pct" },
          { key: "prevRangePct", label: "Prev range %", type: "pct" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "newHighPct", sortDesc: true,
      }),
  },
  {
    id: "trader-choice-3", name: "Trader Choice 3", category: "Trader Choice", needsBars: true, minRs: 70,
    description: "Breakout filters — closed above the 40-day high on 1.5x volume with an RS rating of 70+ and the 20 EMA trending up.",
    run: () =>
      scanWithBars({
        barsLimit: 70, minBars: 60,
        select: { mom6M: true },
        hit: (s, bars) => {
          const n = bars.length;
          const level = maxHigh(bars, n - 1 - 40, n - 1);
          if (level == null) return null;
          const today = bars[n - 1], yday = bars[n - 2];
          if (!(today.close > level && yday.close <= level)) return null;
          const avg = volAvg(bars, n - 21, n - 1);
          if (avg <= 0 || (today.volume || 0) < 1.5 * avg) return null;
          const closes = bars.map((b) => b.close);
          const e = emaSeries(closes, 20);
          const eNow = e[n - 1], ePrev = e[n - 6];
          if (eNow == null || ePrev == null || eNow <= ePrev) return null;
          return {
            breakoutPct: Number(((today.close / level - 1) * 100).toFixed(2)),
            volVsAvg: Number(((today.volume || 0) / avg).toFixed(2)),
            mom6M: r1(s.mom6M as number),
          };
        },
        columns: [
          { key: "breakoutPct", label: "Above 40d high", type: "pct" },
          { key: "volVsAvg", label: "Vol vs avg", type: "x" },
          { key: "mom6M", label: "6M return", type: "pct" },
        ],
        sortMetric: "breakoutPct", sortDesc: true,
      }),
  },
  {
    id: "trader-choice-4", name: "Trader Choice 4", category: "Trader Choice", needsBars: true,
    description: "Volume-backed trend — 2x volume on an up day, closing in the top third of the range, above the 200 EMA with a positive 5-day run.",
    run: () =>
      scanWithBars({
        barsLimit: 220, minBars: 210,
        hit: (_s, bars) => {
          const n = bars.length;
          const closes = bars.map((b) => b.close);
          const e200 = emaLast(closes, 200);
          if (e200 == null || closes[n - 1] <= e200) return null;
          const today = bars[n - 1];
          if (today.close <= today.open) return null;
          const avg = volAvg(bars, n - 61, n - 1);
          if (avg <= 0 || (today.volume || 0) < 2 * avg) return null;
          const range = today.high - today.low;
          if (range <= 0 || (today.close - today.low) / range < 0.66) return null;
          const ret5 = ((closes[n - 1] / closes[n - 6]) - 1) * 100;
          if (ret5 <= 0) return null;
          return {
            volVsAvg: Number(((today.volume || 0) / avg).toFixed(2)),
            ret5: Number(ret5.toFixed(2)),
            closeLoc: Number((((today.close - today.low) / range) * 100).toFixed(0)),
          };
        },
        columns: [
          { key: "volVsAvg", label: "Vol vs 60d avg", type: "x" },
          { key: "ret5", label: "5-day return", type: "pct" },
          { key: "closeLoc", label: "Close in range %", type: "num" },
        ],
        sortMetric: "volVsAvg", sortDesc: true,
      }),
  },
  {
    id: "trader-choice-5", name: "Trader Choice 5", category: "Trader Choice", needsBars: true,
    description: "Low-base breakout screen — close ≥ 30% above the 66-day low, ≥ ₹30, ₹3 Cr+ turnover on 20-day average volume, above the 200 SMA, the last three weekly candles each rose ≤ 6%, and this week breaks the 4-week high. Scans every NSE name above ₹30 (no market-cap filter), so small caps are never excluded.",
    run: () =>
      scanWithBars({
        // price ≥ ₹30 across the WHOLE universe — the take must cover every
        // qualifying stock (2,900+ names), not a top-N slice by market cap.
        // No market-cap filter: Yahoo lacks the field for a few listed names
        // (e.g. ARTEMISMED.NS) and the turnover floor already removes illiquid
        // micro-caps, so a size filter would only silently drop legitimate hits.
        where: { price: { gte: 30 }, marketCap: { not: null } },
        barsLimit: 220, minBars: 210,
        hit: (_s, bars) => {
          const n = bars.length;
          const closes = bars.map((b) => b.close);
          const close = closes[n - 1];
          // ₹3 Cr+ turnover on 20-day average volume
          const avgVol = volAvg(bars, n - 20, n);
          if (avgVol <= 0 || close * avgVol <= 30_000_000) return null;
          // above the 200 SMA
          const sma200 = closes.slice(-200).reduce((a, c) => a + c, 0) / Math.min(200, closes.length);
          if (close <= sma200) return null;
          // close ≥ 1.30 × the 66-day low
          const low66 = minLow(bars, n - 66, n);
          if (low66 == null || low66 <= 0 || close / low66 < 1.3) return null;
          // weekly checks — Monday-anchored weekly candles (last one partial)
          const wk = weeklyBars(bars);
          if (wk.length < 6) return null;
          // this week breaks the 4-week high
          let prior4High = -Infinity;
          for (let i = wk.length - 5; i < wk.length - 1; i++) prior4High = Math.max(prior4High, wk[i].high);
          if (!Number.isFinite(prior4High) || wk[wk.length - 1].high <= prior4High) return null;
          // each of the last three completed weeks rose ≤ 6% (close over close)
          for (let k = 1; k <= 3; k++) {
            const w = wk[wk.length - 1 - k], wp = wk[wk.length - 2 - k];
            if (!w || !wp || wp.close <= 0) return null;
            if ((w.close / wp.close - 1) * 100 > 6) return null;
          }
          return {
            turnoverCr: Number(((close * avgVol) / 10_000_000).toFixed(1)),
            above66LowPct: Number(((close / low66 - 1) * 100).toFixed(1)),
            breakPct: Number(((wk[wk.length - 1].high / prior4High - 1) * 100).toFixed(1)),
          };
        },
        columns: [
          { key: "turnoverCr", label: "Turnover (₹ Cr, 20D avg)", type: "num" },
          { key: "above66LowPct", label: "Above 66D low", type: "pct" },
          { key: "breakPct", label: "Above 4W high", type: "pct" },
        ],
        sortMetric: "turnoverCr", sortDesc: true,
        cap: 200,
      }),
  },
  {
    id: "trader-choice-6", name: "Trader Choice 6", category: "Trader Choice", needsBars: true,
    description: "Six-signal confluence — near 52W high, above 50 & 200 EMA, strong 6M momentum, tight 10-day coil, 1.5x volume and RSI 50-75 counted per stock; only names firing four or more signals make the list.",
    run: () =>
      scanWithBars({
        barsLimit: 220, minBars: 210,
        select: { fromHighPct: true, mom6M: true, rsi14: true },
        hit: (s, bars) => {
          const n = bars.length;
          const closes = bars.map((b) => b.close);
          const close = closes[n - 1];
          const e50 = emaLast(closes, 50), e200 = emaLast(closes, 200);
          let signals = 0;
          const notes: string[] = [];
          if ((s.fromHighPct as number) <= 10) { signals++; notes.push("52W"); }
          if (e50 != null && close > e50) { signals++; notes.push("50E"); }
          if (e200 != null && close > e200) { signals++; notes.push("200E"); }
          const r10 = rangePct(bars, n - 10, n);
          if (r10 != null && r10 <= 12) { signals++; notes.push("coil"); }
          const avg = volAvg(bars, n - 21, n - 1);
          if (avg > 0 && (bars[n - 1].volume || 0) >= 1.5 * avg) { signals++; notes.push("vol"); }
          const mom6M = s.mom6M as number | null;
          const rsiV = s.rsi14 as number | null;
          if ((mom6M != null && mom6M > 15) || (rsiV != null && rsiV >= 50 && rsiV <= 75)) { signals++; notes.push("mom"); }
          if (signals < 4) return null;
          return {
            signals,
            tags: notes.join(" "),
            fromHighPct: r1(s.fromHighPct as number),
          };
        },
        columns: [
          { key: "signals", label: "Signals (of 6)", type: "num" },
          { key: "tags", label: "Which", type: "str" },
          { key: "fromHighPct", label: "From 52W high", type: "pct" },
        ],
        sortMetric: "signals", sortDesc: true,
      }),
  },
  {
    id: "trader-choice-7", name: "Trader Choice 7", category: "Trader Choice", needsBars: true,
    description: "Fundamental-momentum stack — NSE stocks above the 20/50/200 EMA with 30-day average volume above 100K, quarterly revenue growth (QoQ) positive, quarterly diluted EPS growth (YoY) above 30%, and the day's high within 0-30% of the 52-week high. Price above ₹30.",
    run: () =>
      scanWithBars({
        // Exchange = NSE (the universe is NSE-only) · price > ₹30 · the two
        // fundamental filters run in the DB so only fundamentals-backed names
        // get their bars loaded.
        where: {
          price: { gte: 30 },
          marketCap: { not: null },
          epsQuarterlyGrowth: { gt: 0.30 },
          revenueQoQGrowth: { gt: 0 },
          symbol: { endsWith: ".NS" },
        },
        // The 52W-high lookback below reads n-250 — the window must actually
        // contain 250 sessions (the old drifting loader used to overshoot its
        // limit and accidentally supply them; minBars 250 skips candidates
        // whose shorter history could never pass that check).
        barsLimit: 260, minBars: 250,
        select: { epsQuarterlyGrowth: true, revenueQoQGrowth: true },
        hit: (_s, bars) => {
          const n = bars.length;
          const closes = bars.map((b) => b.close);
          const close = closes[n - 1];
          // price above the 20 / 50 / 200 EMA
          const e20 = emaLast(closes, 20), e50 = emaLast(closes, 50), e200 = emaLast(closes, 200);
          if (e20 == null || e50 == null || e200 == null) return null;
          if (!(close > e20 && close > e50 && close > e200)) return null;
          // 30-day average volume above 100K shares
          const avg30 = volAvg(bars, n - 30, n);
          if (avg30 <= 100_000) return null;
          // the day's high sits 0-30% below the 52-week high
          const h52 = maxHigh(bars, n - 250, n);
          const today = bars[n - 1];
          if (h52 == null || h52 <= 0 || today.high <= 0) return null;
          const belowPct = ((h52 - today.high) / h52) * 100;
          if (belowPct < 0 || belowPct > 30) return null;
          return {
            epsYoY: Number((_s.epsQuarterlyGrowth as number * 100).toFixed(1)),
            revQoQ: Number((_s.revenueQoQGrowth as number * 100).toFixed(1)),
            below52: Number(belowPct.toFixed(1)),
            avgVol30D: Math.round(avg30),
          };
        },
        columns: [
          { key: "epsYoY", label: "EPS chg % (YoY)", type: "pct" },
          { key: "revQoQ", label: "Revenue chg % (QoQ)", type: "pct" },
          { key: "below52", label: "High vs 52W high", type: "pct" },
          { key: "avgVol30D", label: "Avg vol (30D)", type: "vol" },
        ],
        sortMetric: "epsYoY", sortDesc: true,
      }),
  },
];

// ---------------------------------------------------------------- catalog

export const RAW_SCANS: ScanDef[] = [
  ...chartPatternScans, ...gapEarningsScans, ...shakeoutScans, ...volumeScans,
  ...rsScans, ...specialtyScans, ...mtfScans, ...traderChoiceScans,
];

/** Final catalog — every scan's rows are post-processed to carry the universal RS rating, and minRs promises are enforced. */
export const SCANS: ScanDef[] = RAW_SCANS.map((s) => ({
  ...s,
  run: s.minRs != null ? withMinRs(s.minRs, s.run) : withRs(s.run),
}));

// ------------------------------------------------------- shared run cache
// Three layers, cheapest first:
//   L1 — in-process map (15 min) for scanner-tab re-runs & confluence reuse
//   L2 — the ScanResult table (persistent; written nightly by the precompute
//        pipeline and lazily on a miss) so a freshly restarted server or a
//        cold day serves scans from ONE indexed row read instead of re-running
//   L3 — the live scan itself (never in a request path after the first run)

import { currentDataDate, loadCachedScan, saveScanResult } from "@/lib/scan-store";

const SCAN_CACHE_TTL = 15 * 60 * 1000;
const scanCache = new Map<string, { at: number; result: ScanResult }>();

/** Warm/refresh the L1 cache (used by the nightly precompute). */
export function setScanCache(id: string, result: ScanResult): void {
  scanCache.set(id, { at: Date.now(), result });
}

/** Run a scan: L1 → L2 (DB cache for the current data session) → live run. */
export async function runScanCached(scan: ScanDef): Promise<ScanResult> {
  const hit = scanCache.get(scan.id);
  if (hit && Date.now() - hit.at < SCAN_CACHE_TTL) return hit.result;

  // L2 — persistent cache keyed on the current EOD session.
  try {
    const dataDate = await currentDataDate();
    if (dataDate) {
      const cached = await loadCachedScan(scan.id, dataDate);
      if (cached) {
        scanCache.set(scan.id, { at: Date.now(), result: cached });
        return cached;
      }
    }
  } catch {
    /* cache reads are best-effort — fall through to the live run */
  }

  const t0 = Date.now();
  const result = await scan.run();
  const durationMs = Date.now() - t0;

  if (scanCache.size > 60) {
    for (const [k, v] of scanCache) if (Date.now() - v.at >= SCAN_CACHE_TTL) scanCache.delete(k);
  }
  scanCache.set(scan.id, { at: Date.now(), result });

  // Lazy backfill: this click's run becomes tomorrow's single-row read.
  const dataDate = await currentDataDate().catch(() => null);
  if (dataDate) {
    saveScanResult(scan.id, dataDate, result, durationMs).catch(() => {});
  }
  return result;
}

// ---------------------------------------------------------------- lookups

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "Chart Patterns": "Horizontal resistance breakouts, tight coils, inside bars, flags & pennants and VCP — the structure scans.",
  "Gaps & Earnings": "Gap ups, gaps being filled, earnings-day gaps and post-results reactions.",
  Shakeout: "Intraday dips below the 10/21/50/200 EMA reclaimed by the close — support defended.",
  Volume: "Volume spikes & gainers, 60-day volume peaks, dense accumulation and institutional turnover footprints.",
  "Momentum & RS": "Momentum scanner with RS rating, RS-high-before-price-high leadership and the 52-week high list.",
  Specialty: "Recent IPOs, IPO bases, circuit-band movers, established past winners and the shorting side.",
  "Multi-Timeframe RSI": "TradePulse addition — monthly + weekly + daily RSI alignment setups.",
  "Trader Choice": "Seven hand-picked multi-condition screens — momentum breakout, price action, breakout filters, volume trend, a low-base weekly breakout, a 6-signal confluence screen and a fundamental-momentum EMA stack (EPS + revenue growth). Every result carries RS, EPS score and A/D rating.",
};

/** Category list with display descriptions, in catalog display order. */
export const SCAN_CATEGORIES = [...new Set(SCANS.map((s) => s.category))].map((category) => ({
  category,
  description: CATEGORY_DESCRIPTIONS[category] ?? "",
}));

/** Find a scan by id (used by the run API). */
export function getScan(id: string): ScanDef | undefined {
  return SCANS.find((s) => s.id === id);
}
