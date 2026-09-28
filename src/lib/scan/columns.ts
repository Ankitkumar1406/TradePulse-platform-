/**
 * Scan builder — column store + indicator engine (server only).
 *
 * One immutable Store holds every stock's daily bars (flat typed arrays),
 * weekly/monthly resamples, the Stock snapshot, latest StockMetrics ratings
 * and stock_fundamentals. It is built once per data session and cached on
 * globalThis keyed by the latest bar date — the live counter and every run
 * reuse it instead of re-reading 1.2M bars.
 *
 * Evaluation semantics (decided, spec-aligned):
 *  - Every term carries its own timeframe + offset. A term is materialised as
 *    a full series on ITS timeframe, then as-of joined onto the clause's base
 *    timeframe (a daily row sees the weekly candle its date belongs to — the
 *    partial current week counts as the latest weekly bar).
 *  - Offset {n,'candle'} shifts n candles back on the term's own timeframe;
 *    {'day'|'week'|'month'} shifts calendar periods (bar with date ≤ target).
 *  - Math inside an expression follows standard precedence (^, then × ÷ %,
 *    then + −). NaN anywhere ⇒ that stock's value is null ⇒ clause false,
 *    and the stock is counted as "skipped / insufficient data" when the
 *    clause participated.
 *  - Fundamentals come from stock_fundamentals (weekly Yahoo refresh); the
 *    snapshot overlap (mcap, pe, pb, divYield, eps, bookValue) falls back to
 *    the Stock table so P0 clauses work between refreshes. null ⇒ no match.
 */
import { db, toPgSql } from "@/lib/db";
import { fetchChart } from "@/lib/yahoo";
import type { Expr, FundPeriod, MathOp, Offset, Term, Timeframe } from "./expr-model";
import { isOp } from "./expr-model";

// ---------------------------------------------------------------- store types

export interface TfArrays {
  o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; v: Float64Array;
  d: Int32Array; // epoch days
  n: number;
  // as-of maps from daily bars (only on weekly/monthly)
  fromDaily: Int32Array | null; // dailyIdx -> tfIdx (latest tf bar with date ≤ daily date)
}

export interface FundRow {
  [field: string]: number | null | number[] | undefined;
}

export interface StockRow {
  symbol: string; // DB symbol (RELIANCE.NS)
  name: string;
  sector: string;
  industry: string;
  exchangeCode: string | null;
}

export interface Store {
  symbols: string[]; // index = stock index (only stocks WITH bars)
  rows: StockRow[];
  bySym: Map<string, number>;
  daily: TfArrays; // flat across stocks; stock si uses [off[si], off[si]+n[si])
  off: Int32Array;
  dailyN: Int32Array;
  weekly: TfArrays; // flat across stocks, per-stock offsets below
  monthly: TfArrays;
  weeklyOff: Int32Array;
  weeklyN: Int32Array;
  monthlyOff: Int32Array;
  monthlyN: Int32Array;
  // snapshot numerics (NaN = null)
  snap: Record<string, Float64Array>; // marketCap, peTTM, epsTTM, bookValue, pbRatio, divYield, high52, low52, price, prevClose, changePct, avgVol3M, volume, rsRating, rsMomentum, epsScore, adRatio
  fund: Map<string, Float64Array>; // fundamentals by field (snapshot + computed growth)
  fundQuarterly: Map<string, (Float64Array | null)[]>; // field -> [q0..q7]
  fundAnnual: Map<string, (Float64Array | null)[]>; // field -> [fy0..fy4]
  fundCount: Int32Array; // number of non-null fundamental fields per stock (availability counter)
  maxDate: string;
  indices: Map<string, TfArrays>; // ^NSEI etc (daily)
  builtAt: number;
}

const NaNV = Number.NaN;

// ---------------------------------------------------------------- build

interface RawBar { symbol: string; date: string; open: unknown; high: unknown; low: unknown; close: unknown; volume: unknown }

function epochDay(date: string): number {
  return Math.floor(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000);
}

function emptyTf(cap: number): TfArrays {
  return {
    o: new Float64Array(cap), h: new Float64Array(cap), l: new Float64Array(cap),
    c: new Float64Array(cap), v: new Float64Array(cap), d: new Int32Array(cap), n: 0,
    fromDaily: null,
  };
}

/** ISO week key (Mon-based) / month key from epoch day. */
function weekKey(ed: number): number {
  return Math.floor((ed + 4) / 7); // epoch day 4 = Thursday = ISO week 1 boundary
}
function monthKey(ed: number): number {
  const dt = new Date(ed * 86400000);
  return dt.getUTCFullYear() * 12 + dt.getUTCMonth();
}

function resample(src: TfArrays, mode: "week" | "month", cap: number): TfArrays {
  const out = emptyTf(cap);
  const keyOf = mode === "week" ? weekKey : monthKey;
  let cur = Number.NaN;
  let start = 0;
  const push = (endExclusive: number) => {
    const i = out.n;
    let ho = NaN, hh = NaN, hl = NaN, hc = NaN, hv = 0;
    for (let k = start; k < endExclusive; k++) {
      ho = Number.isNaN(ho) ? src.o[k] : ho;
      hh = Number.isNaN(hh) ? src.h[k] : Math.max(hh, src.h[k]);
      hl = Number.isNaN(hl) ? src.l[k] : Math.min(hl, src.l[k]);
      hc = src.c[k];
      hv += src.v[k];
    }
    out.o[i] = ho; out.h[i] = hh; out.l[i] = hl; out.c[i] = hc; out.v[i] = hv;
    out.d[i] = src.d[endExclusive - 1];
    out.n++;
    start = endExclusive;
  };
  for (let i = 0; i < src.n; i++) {
    const k = keyOf(src.d[i]);
    if (!Number.isNaN(cur) && k !== cur) push(i);
    cur = k;
  }
  if (start < src.n) push(src.n);
  return out;
}

const SNAP_FIELDS = [
  "marketCap", "peTTM", "epsTTM", "bookValue", "pbRatio", "divYield", "high52", "low52",
  "price", "prevClose", "changePct", "avgVol3M", "volume",
] as const;

const METRIC_FIELDS = ["rsRating", "rsMomentum", "epsScore", "adRatio"] as const;

const FUND_SNAPSHOT_FIELDS = [
  "mcap", "pe", "pb", "divYield", "epsTtm", "bookValue",
  "roe", "profitMargin", "opMargin", "debtToEquity", "currentRatio",
  "ev", "evEbitda", "evRevenue", "psTtm", "dividendRate", "payoutRatio", "roa", "grossMargin",
  "quickRatio", "revenueTtm", "ebitda", "netIncome", "fcf", "ocf",
  "totalDebt", "totalCash", "sharesOut",
  "revenueGrowth", "earningsGrowth", "epsGrowthQoQ", "epsGrowthYoY", "epsCagr3Y",
  "fwdEps", "fwdPe", "peg", "instHoldingPct", "insiderHoldingPct",
] as const;
const FUND_QUARTERLY_FIELDS = ["epsQuarterly", "salesQuarterly", "netProfitQuarterly"] as const;
const FUND_ANNUAL_FIELDS = ["annualEps", "annualRevenue", "annualNetProfit"] as const;

const INDEX_SPECS: [string, string][] = [
  ["nifty50", "^NSEI"], ["banknifty", "^NSEBANK"], ["sensex", "^BSESN"],
  ["niftyit", "^CNXIT"], ["indiavix", "^INDIAVIX"], ["niftymidcap100", "^NSEMDCP50"],
];

let indexCache: { at: number; data: Map<string, TfArrays> } | null = null;
const INDEX_TTL = 60 * 60 * 1000; // 1h — index bars only move once a day

async function loadIndexBars(): Promise<Map<string, TfArrays>> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL) return indexCache.data;
  const out = new Map<string, TfArrays>();
  const jobs = INDEX_SPECS.map(async ([id, ysym]) => {
    try {
      const chart = await fetchChart(ysym, "2y");
      const q = chart?.indicators?.quote?.[0];
      if (!chart?.timestamp || !q?.close) return;
      const cap = chart.timestamp.length;
      const tf = emptyTf(cap);
      for (let i = 0; i < cap; i++) {
        const closes = q.close[i];
        if (closes == null) continue;
        const j = tf.n;
        tf.o[j] = q.open?.[i] ?? closes;
        tf.h[j] = q.high?.[i] ?? closes;
        tf.l[j] = q.low?.[i] ?? closes;
        tf.c[j] = closes;
        tf.v[j] = q.volume?.[i] ?? 0;
        tf.d[j] = Math.floor(chart.timestamp[i] / 86400);
        tf.n++;
      }
      if (tf.n > 0) out.set(id, tf);
    } catch {
      // index stays absent — its registry columns evaluate to null (no match)
    }
  });
  await Promise.all(jobs);
  indexCache = { at: Date.now(), data: out };
  return out;
}

export async function buildStore(): Promise<Store> {
  // ---- daily bars, loaded in symbol batches (1.2M+ rows as one Prisma raw
  // result spikes memory hard enough to OOM a 4GB sandbox — chunked loads
  // keep the transient footprint to ~50k rows while the typed-array store
  // grows incrementally)
  const symRows = (await db.$queryRawUnsafe(
    toPgSql(`SELECT symbol, COUNT(*)::int AS n, MIN(date) AS first, MAX(date) AS last
             FROM "DailyBar" GROUP BY symbol ORDER BY symbol`),
  )) as unknown as { symbol: string; n: number; last: string }[];

  const symbols = symRows.map((r) => r.symbol);
  const nSym = symbols.length;
  const bySym = new Map(symbols.map((s, i) => [s, i]));
  const off = new Int32Array(nSym);
  const ns = new Int32Array(nSym);
  let acc = 0;
  symRows.forEach((r, i) => { off[i] = acc; ns[i] = Number(r.n); acc += ns[i]; });
  const total = acc;
  const daily = emptyTf(total);
  const maxDate = symRows.reduce((m, r) => (r.last > m ? r.last : m), "");

  const CHUNK = 300;
  for (let start = 0; start < nSym; start += CHUNK) {
    const batch = symbols.slice(start, start + CHUNK);
    const bars = (await db.$queryRawUnsafe(
      toPgSql(`SELECT symbol, date, open, high, low, close, volume FROM "DailyBar"
               WHERE symbol IN (${batch.map(() => "?").join(",")}) ORDER BY symbol, date`),
      ...batch,
    )) as unknown as RawBar[];
    const fill = new Map<string, number>();
    for (const b of bars) {
      const si = bySym.get(b.symbol)!;
      const k = fill.get(b.symbol) ?? 0;
      const i = off[si] + k;
      daily.o[i] = Number(b.open) || NaNV;
      daily.h[i] = Number(b.high) || NaNV;
      daily.l[i] = Number(b.low) || NaNV;
      daily.c[i] = Number(b.close) || NaNV;
      daily.v[i] = Number(b.volume) || 0;
      daily.d[i] = epochDay(b.date);
      fill.set(b.symbol, k + 1);
    }
  }
  daily.n = total;

  // pass 2 — weekly / monthly resamples (flat, per-stock offsets tracked)
  const weekly = emptyTf(total);
  const monthly = emptyTf(total);
  const wOffPerSym = new Int32Array(nSym);
  const wNPerSym = new Int32Array(nSym);
  const mOffPerSym = new Int32Array(nSym);
  const mNPerSym = new Int32Array(nSym);
  const dailyN = new Int32Array(ns);
  for (let si = 0; si < nSym; si++) {
    const seg = sliceTf(daily, off[si], ns[si]);
    const w = resample(seg, "week", ns[si]);
    const m = resample(seg, "month", ns[si]);
    wOffPerSym[si] = weekly.n; mOffPerSym[si] = monthly.n;
    weekly.o.set(w.o.subarray(0, w.n), weekly.n); weekly.h.set(w.h.subarray(0, w.n), weekly.n);
    weekly.l.set(w.l.subarray(0, w.n), weekly.n); weekly.c.set(w.c.subarray(0, w.n), weekly.n);
    weekly.v.set(w.v.subarray(0, w.n), weekly.n); weekly.d.set(w.d.subarray(0, w.n), weekly.n);
    weekly.n += w.n;
    monthly.o.set(m.o.subarray(0, m.n), monthly.n); monthly.h.set(m.h.subarray(0, m.n), monthly.n);
    monthly.l.set(m.l.subarray(0, m.n), monthly.n); monthly.c.set(m.c.subarray(0, m.n), monthly.n);
    monthly.v.set(m.v.subarray(0, m.n), monthly.n); monthly.d.set(m.d.subarray(0, m.n), monthly.n);
    monthly.n += m.n;
    wNPerSym[si] = w.n; mNPerSym[si] = m.n;
  }
  daily.fromDaily = null;
  attachFromDaily(daily, weekly, off, ns, wOffPerSym);
  attachFromDaily(daily, monthly, off, ns, mOffPerSym);

  // ---- snapshot + metrics + fundamentals
  const stockRows = await db.stock.findMany({
    select: {
      symbol: true, name: true, sector: true, industry: true, exchangeCode: true,
      marketCap: true, peTTM: true, epsTTM: true, bookValue: true, pbRatio: true, divYield: true,
      high52: true, low52: true, price: true, prevClose: true, changePct: true, avgVol3M: true, volume: true,
      epsQuarterlyGrowth: true,
    },
  });
  const snap: Record<string, Float64Array> = {};
  for (const f of SNAP_FIELDS) snap[f] = new Float64Array(nSym).fill(NaNV);
  snap.epsQuarterlyGrowth = new Float64Array(nSym).fill(NaNV);
  const rows: StockRow[] = new Array(nSym);
  for (const s of stockRows) {
    const si = bySym.get(s.symbol);
    if (si == null) continue;
    rows[si] = { symbol: s.symbol, name: s.name, sector: s.sector ?? "", industry: s.industry ?? "", exchangeCode: s.exchangeCode ?? null };
    const map: Record<string, unknown> = s as unknown as Record<string, unknown>;
    for (const f of SNAP_FIELDS) {
      const v = map[f];
      if (typeof v === "number" && Number.isFinite(v)) snap[f][si] = v;
    }
    // growth fallback from the quote trickle (stored as a decimal: 0.35 = +35%)
    const eqg = s.epsQuarterlyGrowth;
    if (typeof eqg === "number" && Number.isFinite(eqg)) snap.epsQuarterlyGrowth[si] = eqg * 100;
  }
  for (let si = 0; si < nSym; si++) {
    if (!rows[si]) rows[si] = { symbol: symbols[si], name: "", sector: "", industry: "", exchangeCode: null };
  }

  const metricArrs: Record<string, Float64Array> = {};
  for (const f of METRIC_FIELDS) metricArrs[f] = new Float64Array(nSym).fill(NaNV);
  const epsGrowthFallback = new Float64Array(nSym).fill(NaNV);
  try {
    const metrics = (await db.$queryRawUnsafe(
      toPgSql(`SELECT DISTINCT ON (symbol) symbol, "rsRating", "rsMomentum", "epsScore", "adRatio"
               FROM "StockMetrics" ORDER BY symbol, date DESC`),
    )) as unknown as { symbol: string; rsRating: unknown; rsMomentum: unknown; epsScore: unknown; adRatio: unknown }[];
    for (const m of metrics) {
      const si = bySym.get(m.symbol);
      if (si == null) continue;
      const map: Record<string, unknown> = m as unknown as Record<string, unknown>;
      for (const f of METRIC_FIELDS) {
        const v = Number(map[f]);
        if (Number.isFinite(v)) metricArrs[f][si] = v;
      }
    }
  } catch {
    // metrics table may be empty — ratings stay null
  }

  // fundamentals: snapshot fallbacks from Stock + stock_fundamentals rows
  const fund = new Map<string, Float64Array>();
  for (const f of FUND_SNAPSHOT_FIELDS) fund.set(f, new Float64Array(nSym).fill(NaNV));
  const fundCount = new Int32Array(nSym);
  const FALLBACK: Record<string, string> = {
    mcap: "marketCap", pe: "peTTM", pb: "pbRatio", divYield: "divYield", epsTtm: "epsTTM", bookValue: "bookValue",
  };
  for (const [f, src] of Object.entries(FALLBACK)) {
    fund.get(f)!.set(snap[src]);
  }
  epsGrowthFallback.set(snap.epsQuarterlyGrowth);
  fund.get("epsGrowthYoY")!.set(epsGrowthFallback);
  const fundQuarterly = new Map<string, (Float64Array | null)[]>();
  const fundAnnual = new Map<string, (Float64Array | null)[]>();
  try {
    const frows = await db.stockFundamentals.findMany();
    for (const fr of frows) {
      const si = bySym.get(fr.symbol);
      if (si == null) continue;
      const rec = fr as unknown as Record<string, unknown>;
      let count = 0;
      for (const f of FUND_SNAPSHOT_FIELDS) {
        const v = rec[f];
        if (typeof v === "number" && Number.isFinite(v)) { fund.get(f)![si] = v; count++; }
      }
      for (const f of FUND_QUARTERLY_FIELDS) {
        const arr = rec[`${f}s`];
        if (Array.isArray(arr)) {
          const slots = fundQuarterly.get(f) ?? new Array(8).fill(null);
          for (let q = 0; q < 8; q++) {
            const v = arr[q];
            if (typeof v === "number" && Number.isFinite(v)) {
              slots[q] = slots[q] ?? new Float64Array(nSym).fill(NaNV);
              slots[q]![si] = v;
            }
          }
          fundQuarterly.set(f, slots);
        }
      }
      for (const f of FUND_ANNUAL_FIELDS) {
        const arr = rec[`${f}s`];
        if (Array.isArray(arr)) {
          const slots = fundAnnual.get(f) ?? new Array(5).fill(null);
          for (let y = 0; y < 5; y++) {
            const v = arr[y];
            if (typeof v === "number" && Number.isFinite(v)) {
              slots[y] = slots[y] ?? new Float64Array(nSym).fill(NaNV);
              slots[y]![si] = v;
            }
          }
          fundAnnual.set(f, slots);
        }
      }
      fundCount[si] = count;
    }
  } catch {
    // stock_fundamentals may not exist yet — snapshot fallbacks still work
  }

  const indices = await loadIndexBars();

  return {
    symbols, rows, bySym,
    daily, off, dailyN,
    weekly, monthly,
    weeklyOff: wOffPerSym, weeklyN: wNPerSym,
    monthlyOff: mOffPerSym, monthlyN: mNPerSym,
    snap: { ...snap, ...metricArrs },
    fund, fundQuarterly, fundAnnual, fundCount,
    maxDate, indices, builtAt: Date.now(),
  };
}

function attachFromDaily(daily: TfArrays, tf: TfArrays, off: Int32Array, ns: Int32Array, tfOff: Int32Array) {
  const map = new Int32Array(daily.n).fill(-1);
  for (let si = 0; si < ns.length; si++) {
    let j = 0;
    for (let i = 0; i < ns[si]; i++) {
      const dd = daily.d[off[si] + i];
      while (j < ns[si] && tf.d[tfOff[si] + j] <= dd) j++;
      map[off[si] + i] = tfOff[si] + Math.max(0, j - 1);
    }
  }
  tf.fromDaily = map;
}

export function sliceTf(tf: TfArrays, start: number, n: number): TfArrays {
  return {
    o: tf.o.subarray(start, start + n), h: tf.h.subarray(start, start + n),
    l: tf.l.subarray(start, start + n), c: tf.c.subarray(start, start + n),
    v: tf.v.subarray(start, start + n), d: tf.d.subarray(start, start + n),
    n, fromDaily: null,
  };
}

// ---------------------------------------------------------------- store cache

interface StoreGlobals {
  __tpScanStore?: { store: Store; key: string; at: number };
}
const g = globalThis as unknown as StoreGlobals;

export async function getStore(): Promise<Store> {
  const state = await db.syncState.findUnique({ where: { id: "main" }, select: { metricsDate: true } });
  const key = state?.metricsDate ?? "";
  const cached = g.__tpScanStore;
  if (cached && cached.key === key && Date.now() - cached.at < 10 * 60 * 1000) return cached.store;
  const store = await buildStore();
  g.__tpScanStore = { store, key, at: Date.now() };
  return store;
}

// ---------------------------------------------------------------- series engine

export interface Sess {
  store: Store;
  si: number;
}

/** Offset in bars on a term's own timeframe. */
export function offsetBars(tf: TfArrays, off: Offset, endIdx: number): number {
  if (!off) return 0;
  const endDay = tf.d[endIdx];
  if (off.unit === "candle") return off.n;
  const days = off.unit === "day" ? off.n : off.unit === "week" ? off.n * 7 : off.n * 30;
  // latest bar with date ≤ endDay - days
  let lo = 0, hi = endIdx, ans = endIdx;
  const target = endDay - days;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tf.d[mid] <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return endIdx - ans;
}

type BinNode =
  | { k: "num"; v: number }
  | { k: "term"; term: Term }
  | { k: "bin"; op: MathOp; a: BinNode; b: BinNode };

/** Compile a flat token expr into a precedence AST. */
export function astOf(expr: Expr): BinNode | null {
  if (expr.length === 0) return null;
  let pos = 0;
  const peek = () => expr[pos];
  const opTok = (x: ReturnType<typeof peek>): MathOp | null => (x && isOp(x) ? x.op : null);
  const parsePrimary = (): BinNode | null => {
    const t = peek();
    if (!t || isOp(t)) return null;
    pos++;
    if (t.t === "bracket") return astOf(t.inner);
    return { k: "term", term: t };
  };
  const parsePow = (): BinNode | null => {
    let a = parsePrimary();
    if (!a) return null;
    for (let op = opTok(peek()); op === "^"; op = opTok(peek())) {
      pos++;
      const b = parsePrimary();
      if (!b) return null;
      a = { k: "bin", op: "^", a, b };
    }
    return a;
  };
  const parseMul = (): BinNode | null => {
    let a = parsePow();
    if (!a) return null;
    for (let op = opTok(peek()); op === "*" || op === "/" || op === "%"; op = opTok(peek())) {
      pos++;
      const b = parsePow();
      if (!b) return null;
      a = { k: "bin", op, a, b };
    }
    return a;
  };
  const parseAdd = (): BinNode | null => {
    let a = parseMul();
    if (!a) return null;
    for (let op = opTok(peek()); op === "+" || op === "-"; op = opTok(peek())) {
      pos++;
      const b = parseMul();
      if (!b) return null;
      a = { k: "bin", op, a, b };
    }
    return a;
  };
  return parseAdd();
}

export { NaNV };
