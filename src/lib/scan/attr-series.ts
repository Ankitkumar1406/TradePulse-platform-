/**
 * Scan builder — registry attribute → series dispatch + expression evaluator.
 *
 * `attrSeries` computes any registered time-based attribute as a full series
 * on the attribute's OWN timeframe for one stock; `exprSeries` evaluates a
 * whole Expr (math AST with precedence) aligned to a base timeframe via
 * as-of joins. Scalars for text/fundamental attributes come from the store's
 * snapshot maps. Cross-sectional columns (RS rating percentile, sector /
 * industry RS rank) are computed once per store and cached.
 */
import type { Expr, FundPeriod, Term, Timeframe } from "./expr-model";
import { isOp } from "./expr-model";
import { astOf, offsetBars, sliceTf, type Sess, type Store, type TfArrays } from "./columns";
import {
  adLineS, aroonS, adxS, binOp, cciS, constS, daysSinceHighestS, daysSinceLowestS, demaS,
  emaS, highestS, hmaS, linregS, lowestS, macdS, mfiS, medianS, nan, obvS, pvtS, psarS, rmaS,
  rsiS, smaS, stddevS, stochKs, supertrendS, trueRangeS, unaryOp, vwmaS, vortexS, wmaS,
} from "./indicators";

type MaybeS = Float64Array | null;

// ---------------------------------------------------------------- session helpers

export function segFor(s: Sess, tf: Timeframe): TfArrays {
  const st = s.store;
  const base = tf === "weekly" ? st.weekly : tf === "monthly" ? st.monthly : st.daily;
  const off = tf === "weekly" ? st.weeklyOff[s.si] : tf === "monthly" ? st.monthlyOff[s.si] : st.off[s.si];
  const n = tf === "weekly" ? st.weeklyN[s.si] : tf === "monthly" ? st.monthlyN[s.si] : st.dailyN[s.si];
  return sliceTf(base, off, n);
}

// NOTE: Store carries per-stock offsets for weekly/monthly — see columns.ts.

/** As-of scalar from an index tf for a given epoch day. */
function indexScalarAt(store: Store, id: string, day: number, col: "c" | "d" = "c", back = 0): number {
  const tf = store.indices.get(id);
  if (!tf || tf.n === 0) return nan;
  let lo = 0, hi = tf.n - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tf.d[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return nan;
  const idx = Math.max(0, ans - back);
  return col === "c" ? tf.c[idx] : nan;
}

function indexChangePct(store: Store, id: string, day: number, backBars: number): number {
  const tf = store.indices.get(id);
  if (!tf || tf.n === 0) return nan;
  let lo = 0, hi = tf.n - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tf.d[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0 || ans - backBars < 0) return nan;
  const now = tf.c[ans], before = tf.c[ans - backBars];
  return before > 0 ? ((now - before) / before) * 100 : nan;
}

// ---------------------------------------------------------------- cross-sectional

interface CrossCache { rsScore: Float64Array; rsRating: Float64Array; sectorRank: Float64Array; industryRank: Float64Array }

/**
 * rsScore = 40% last 3M + 20% each prior 3M return. Ratings are percentiles
 * across the whole universe; sector/industry rank = rank of the group's mean
 * score (1 = strongest group).
 */
export function crossSection(store: Store): CrossCache {
  const cache = (store as Store & { __cross?: CrossCache }).__cross;
  if (cache) return cache;
  const n = store.symbols.length;
  const score = new Float64Array(n).fill(nan);
  const rets = (k: number): Float64Array => {
    const out = new Float64Array(n).fill(nan);
    for (let si = 0; si < n; si++) {
      const start = store.off[si], len = store.dailyN[si];
      if (len <= k) continue;
      const now = store.daily.c[start + len - 1];
      const before = store.daily.c[start + len - 1 - k];
      if (Number.isFinite(now) && Number.isFinite(before) && before > 0) out[si] = ((now - before) / before) * 100;
    }
    return out;
  };
  const r63 = rets(63), r126 = rets(126), r189 = rets(189), r252 = rets(252);
  for (let si = 0; si < n; si++) {
    if (Number.isNaN(r126[si])) continue;
    score[si] = 0.4 * r63[si] + 0.2 * r126[si] + 0.2 * r189[si] + 0.2 * r252[si];
  }
  // percentile rating
  const rating = new Float64Array(n).fill(nan);
  {
    const idx = [...Array(n).keys()].filter((i) => !Number.isNaN(score[i]));
    idx.sort((a, b) => score[a] - score[b]);
    idx.forEach((si, rank) => {
      rating[si] = idx.length > 1 ? 1 + Math.round((99 * rank) / (idx.length - 1)) : 50;
    });
  }
  // group ranks
  const groupRank = (keyOf: (si: number) => string): Float64Array => {
    const out = new Float64Array(n).fill(nan);
    const sums = new Map<string, { s: number; c: number }>();
    for (let si = 0; si < n; si++) {
      const k = keyOf(si);
      if (!k || Number.isNaN(score[si])) continue;
      const e = sums.get(k) ?? { s: 0, c: 0 };
      e.s += score[si]; e.c++;
      sums.set(k, e);
    }
    const means = [...sums.entries()].map(([k, v]) => [k, v.s / v.c] as const).sort((a, b) => b[1] - a[1]);
    const rankOf = new Map(means.map(([k], i) => [k, i + 1]));
    for (let si = 0; si < n; si++) {
      const r = rankOf.get(keyOf(si));
      if (r) out[si] = r;
    }
    return out;
  };
  const sectorRank = groupRank((si) => store.rows[si]?.sector ?? "");
  const industryRank = groupRank((si) => store.rows[si]?.industry ?? "");
  const out = { rsScore: score, rsRating: rating, sectorRank, industryRank };
  (store as Store & { __cross?: CrossCache }).__cross = out;
  return out;
}

/** Rating as of `back` bars ago — percentile of the score computed at that bar. */
export function rsRatingAt(store: Store, back: number): Float64Array {
  if (back <= 0) return crossSection(store).rsRating;
  const n = store.symbols.length;
  const score = new Float64Array(n).fill(nan);
  const rets = (k: number): Float64Array => {
    const out = new Float64Array(n).fill(nan);
    for (let si = 0; si < n; si++) {
      const start = store.off[si], len = store.dailyN[si];
      const end = len - 1 - back;
      if (end < k) continue;
      const now = store.daily.c[start + end];
      const before = store.daily.c[start + end - k];
      if (Number.isFinite(now) && Number.isFinite(before) && before > 0) out[si] = ((now - before) / before) * 100;
    }
    return out;
  };
  const r63 = rets(63), r126 = rets(126), r189 = rets(189), r252 = rets(252);
  for (let si = 0; si < n; si++) {
    if (Number.isNaN(r126[si])) continue;
    score[si] = 0.4 * r63[si] + 0.2 * r126[si] + 0.2 * r189[si] + 0.2 * r252[si];
  }
  const rating = new Float64Array(n).fill(nan);
  const idx = [...Array(n).keys()].filter((i) => !Number.isNaN(score[i]));
  idx.sort((a, b) => score[a] - score[b]);
  idx.forEach((si, rank) => {
    rating[si] = idx.length > 1 ? 1 + Math.round((99 * rank) / (idx.length - 1)) : 50;
  });
  return rating;
}

// ---------------------------------------------------------------- market-cap name

interface McapRank { large: Set<number>; mid: Set<number> }

export function mcapRankOf(store: Store): McapRank {
  const holder = store as Store & { __mcapRank?: McapRank };
  if (holder.__mcapRank) return holder.__mcapRank;
  const idx = [...Array(store.symbols.length).keys()]
    .filter((i) => Number.isFinite(store.snap.marketCap[i]))
    .sort((a, b) => store.snap.marketCap[b] - store.snap.marketCap[a]);
  const rank: McapRank = { large: new Set(idx.slice(0, 100)), mid: new Set(idx.slice(100, 250)) };
  holder.__mcapRank = rank;
  return rank;
}

export function mcapClassOf(store: Store, si: number): string {
  const mcap = store.snap.marketCap[si];
  if (!Number.isFinite(mcap)) return "";
  const r = mcapRankOf(store);
  if (r.large.has(si)) return "Large";
  if (r.mid.has(si)) return "Mid";
  return "Small";
}

// ---------------------------------------------------------------- candlestick patterns

function patSeg(s: Sess): TfArrays { return segFor(s, "daily"); }

function patternFlag(s: Sess, id: string, shift: number): number {
  const seg = patSeg(s);
  const i = seg.n - 1 - shift;
  if (i < 3) return nan;
  const o = seg.o[i], h = seg.h[i], l = seg.l[i], c = seg.c[i];
  const po = seg.o[i - 1], ph = seg.h[i - 1], pl = seg.l[i - 1], pc = seg.c[i - 1];
  const p2o = seg.o[i - 2], p2h = seg.h[i - 2], p2l = seg.l[i - 2], p2c = seg.c[i - 2];
  const range = h - l, body = Math.abs(c - o), pRange = ph - pl, pBody = Math.abs(pc - po);
  if (!(range > 0) || !(pRange > 0)) return nan;
  const upper = h - Math.max(o, c), lower = Math.min(o, c) - l;
  const bull = c > o, bear = c < o;
  const near = (x: number, y: number) => Math.abs(x - y) <= 0.001 * ((x + y) / 2 || 1);
  switch (id) {
    case "doji": return body <= 0.1 * range ? 1 : 0;
    case "hammer": return bull && lower >= 2 * body && upper <= 0.35 * body && body / range > 0.05 ? 1 : 0;
    case "invHammer": return bull && upper >= 2 * body && lower <= 0.35 * body ? 1 : 0;
    case "hangingMan": return bear && lower >= 2 * body && upper <= 0.35 * body && i > 0 && pc > po ? 1 : 0;
    case "shootingStar": return bear && upper >= 2 * body && lower <= 0.35 * body ? 1 : 0;
    case "marubozu": return body >= 0.9 * range ? 1 : 0;
    case "spinningTop": return body <= 0.3 * range && upper > body && lower > body ? 1 : 0;
    case "bullEngulfing": return bull && bear && c > po && o < pc && body > pBody ? 1 : 0;
    case "bearEngulfing": return bear && bull && o > pc && c < po && body > pBody ? 1 : 0;
    case "bullHarami": return bear && bull && o > pc && c < po ? 1 : 0;
    case "bearHarami": return bull && bear && o < pc && c > po ? 1 : 0;
    case "piercingLine": return bear && bull && o < l[i - 1] * 0.999 === false && o < pc && c > (po + pc) / 2 && c < po ? 1 : 0;
    case "darkCloud": return bull && bear && o > pc && c < (po + pc) / 2 && c > po ? 1 : 0;
    case "morningStar": return bear && p2c < p2o && pBody2(p2o, p2c) > 0 && body < 0.5 * pBody2(p2o, p2c) && bull && c > (p2o + p2c) / 2 ? 1 : 0;
    case "eveningStar": return bull && p2c > p2o && body < 0.5 * pBody2(p2o, p2c) && bear && c < (p2o + p2c) / 2 ? 1 : 0;
    case "threeSoldiers": return bull && pc > po && p2c > p2o && c > pc && pc > p2c && upper < 0.3 * body && upper1(ph, pc, po) < 0.3 * pBody ? 1 : 0;
    case "threeCrows": return bear && pc < po && p2c < p2o && c < pc && pc < p2c && lower1(pl, pc, po) > 0.7 * pBody ? 1 : 0;
    case "tweezerTop": return near(h, ph) && bear && pc > po ? 1 : 0;
    case "tweezerBottom": return near(l, pl) && bull && pc < po ? 1 : 0;
    default: return nan;
  }
  function pBody2(o2: number, c2: number) { return Math.abs(c2 - o2); }
  function upper1(h1: number, c1: number, o1: number) { return h1 - Math.max(c1, o1); }
  function lower1(l1: number, c1: number, o1: number) { return Math.min(c1, o1) - l1; }
}

const PATTERN_IDS = new Set([
  "doji", "hammer", "invHammer", "hangingMan", "shootingStar", "marubozu", "spinningTop",
  "bullEngulfing", "bearEngulfing", "bullHarami", "bearHarami", "piercingLine", "darkCloud",
  "morningStar", "eveningStar", "threeSoldiers", "threeCrows", "tweezerTop", "tweezerBottom",
]);

// ---------------------------------------------------------------- pivots

function pivotSeries(s: Sess, sys: string, lvl: string, tf: Timeframe): MaybeS {
  const seg = segFor(s, tf);
  const n = seg.n;
  const out = new Float64Array(n).fill(nan);
  for (let i = 1; i < n; i++) {
    const H = seg.h[i - 1], L = seg.l[i - 1], C = seg.c[i - 1];
    if (!Number.isFinite(H) || !Number.isFinite(L) || !Number.isFinite(C)) continue;
    const span = H - L;
    let v = nan;
    if (sys === "classic") {
      const PP = (H + L + C) / 3;
      v = lvl === "pp" ? PP
        : lvl === "r1" ? 2 * PP - L
        : lvl === "s1" ? 2 * PP - H
        : lvl === "r2" ? PP + span
        : lvl === "s2" ? PP - span
        : lvl === "r3" ? H + 2 * (PP - L)
        : L - 2 * (H - PP);
    } else if (sys === "fibonacci") {
      const PP = (H + L + C) / 3;
      v = lvl === "pp" ? PP
        : lvl === "r1" ? PP + 0.382 * span
        : lvl === "s1" ? PP - 0.382 * span
        : lvl === "r2" ? PP + 0.618 * span
        : lvl === "s2" ? PP - 0.618 * span
        : lvl === "r3" ? PP + span
        : PP - span;
    } else if (sys === "camarilla") {
      v = lvl === "pp" ? (H + L + C) / 3
        : lvl === "r1" ? C + (span * 1.1) / 12
        : lvl === "s1" ? C - (span * 1.1) / 12
        : lvl === "r2" ? C + (span * 1.1) / 6
        : lvl === "s2" ? C - (span * 1.1) / 6
        : lvl === "r3" ? C + (span * 1.1) / 4
        : C - (span * 1.1) / 4;
    } else {
      const PP = (H + L + 2 * C) / 4;
      v = lvl === "pp" ? PP
        : lvl === "r1" ? 2 * PP - L
        : lvl === "s1" ? 2 * PP - H
        : lvl === "r2" ? PP + span
        : lvl === "s2" ? PP - span
        : lvl === "r3" ? PP + 2 * span
        : PP - 2 * span;
    }
    out[i] = v;
  }
  return out;
}

// ---------------------------------------------------------------- attr dispatch

const num = (v: number) => (Number.isFinite(v) ? v : nan);

/** One registered attribute as a series on ITS OWN timeframe. */
export function attrSeries(s: Sess, name: string, tf: Timeframe, shift: number, period: FundPeriod | undefined, args?: Expr[]): MaybeS {
  const st = s.store;
  // ---- text / snapshot / fundamental attrs come back as scalars
  const scalar = attrScalar(s, name, period);
  if (scalar != null) {
    if (typeof scalar !== "number") return null; // text attrs are handled by the comparator layer
    return constS(scalar, Math.max(1, segFor(s, tf).n));
  }
  if (scalar === null) return null; // fundamental referenced but absent → no match

  const seg = segFor(s, tf);
  const n = seg.n;
  if (n === 0) return null;
  const i = n - 1 - shift;
  if (i < 0) return null;
  const argN = (k: number, d: number): number => {
    const a = args?.[k];
    if (a && a[0] && a[0].t === "number") return a[0].value;
    return d;
  };
  const argExpr = (k: number): Expr | undefined => args?.[k];

  switch (name) {
    // ---- price & volume
    case "open": return seg.o;
    case "high": return seg.h;
    case "low": return seg.l;
    case "close": return seg.c;
    case "volume": return seg.v;
    case "prevClose": { const out = new Float64Array(n).fill(nan); out.set(seg.c.subarray(0, n - 1), 1); return out; }
    case "change": { const out = new Float64Array(n).fill(nan); for (let k = 1; k < n; k++) out[k] = seg.c[k] - seg.c[k - 1]; return out; }
    case "changePct": { const out = new Float64Array(n).fill(nan); for (let k = 1; k < n; k++) if (seg.c[k - 1] > 0) out[k] = ((seg.c[k] - seg.c[k - 1]) / seg.c[k - 1]) * 100; return out; }
    case "gapPct": { const out = new Float64Array(n).fill(nan); for (let k = 1; k < n; k++) if (seg.c[k - 1] > 0) out[k] = ((seg.o[k] - seg.c[k - 1]) / seg.c[k - 1]) * 100; return out; }
    case "range": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = seg.h[k] - seg.l[k]; return out; }
    case "trueRange": return trueRangeS(seg.h, seg.l, seg.c);
    case "typicalPrice": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = (seg.h[k] + seg.l[k] + seg.c[k]) / 3; return out; }
    case "medianPrice": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = (seg.h[k] + seg.l[k]) / 2; return out; }
    case "ohlc4": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = (seg.o[k] + seg.h[k] + seg.l[k] + seg.c[k]) / 4; return out; }
    case "tradedValue": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = seg.c[k] * seg.v[k]; return out; }
    case "bodySize": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = Math.abs(seg.c[k] - seg.o[k]); return out; }
    case "upperShadow": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = seg.h[k] - Math.max(seg.o[k], seg.c[k]); return out; }
    case "lowerShadow": { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = Math.min(seg.o[k], seg.c[k]) - seg.l[k]; return out; }
    case "avgVolume": { const p = argN(0, 20); return smaS(seg.v, p); }
    case "relVolume": {
      const p = argN(0, 20);
      const av = smaS(seg.v, p);
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = av[k] > 0 ? seg.v[k] / av[k] : nan;
      return out;
    }
    case "high52": return highestS(seg.c, Math.min(252, n));
    case "low52": return lowestS(seg.c, Math.min(252, n));
    case "ath": return highestS(seg.c, n);
    case "atl": return lowestS(seg.c, n);
    case "fromHighPct": {
      const hi = highestS(seg.c, Math.min(252, n));
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = hi[k] > 0 ? ((seg.c[k] - hi[k]) / hi[k]) * 100 : nan;
      return out;
    }
    case "fromLowPct": {
      const lo = lowestS(seg.c, Math.min(252, n));
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = lo[k] > 0 ? ((seg.c[k] - lo[k]) / lo[k]) * 100 : nan;
      return out;
    }
    case "daysSinceHigh52": return daysSinceHighestS(seg.c, Math.min(252, n));
    case "daysSinceLow52": return daysSinceLowestS(seg.c, Math.min(252, n));
    case "daysSinceFirstTrade": { const out = new Float64Array(n).fill(nan); if (n > 0) out.fill(seg.d[n - 1] - seg.d[0]); return out; }

    // ---- moving averages (source = arg0 series, period = arg1)
    case "sma": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => smaS(x, p));
    case "ema": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => emaS(x, p));
    case "wma": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => wmaS(x, p));
    case "rma": return maOver(s, tf, argExpr(0), argN(1, 14), (x, p) => rmaS(x, p));
    case "dema": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => demaS(x, p));
    case "tema": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => temaSHelper(x, p));
    case "hma": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => hmaS(x, p));
    case "vwma": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => vwmaS(x, seg.v, p));
    case "linreg": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => linregS(x, p, "value"));
    case "linregSlope": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => linregS(x, p, "slope"));

    // ---- momentum
    case "rsi": return rsiS(seg.c, argN(0, 14));
    case "macdLine": { const m = macdS(seg.c, argN(0, 12), argN(1, 26), argN(2, 9)); return m.line; }
    case "macdSignal": { const m = macdS(seg.c, argN(0, 12), argN(1, 26), argN(2, 9)); return m.signal; }
    case "macdHist": { const m = macdS(seg.c, argN(0, 12), argN(1, 26), argN(2, 9)); return m.hist; }
    case "stochK": { const r = stochKs(seg.h, seg.l, seg.c, argN(0, 14), argN(1, 3), argN(2, 3)); return r.k; }
    case "stochD": { const r = stochKs(seg.h, seg.l, seg.c, argN(0, 14), argN(1, 3), argN(2, 3)); return r.d; }
    case "stochRsi": {
      const r = rsiS(seg.c, argN(0, 14));
      const raw = stochKs(r, r, r, argN(1, 14), argN(2, 3), argN(3, 3));
      return raw.k;
    }
    case "williamsR": {
      const p = argN(0, 14);
      const hh = highestS(seg.h, p), ll = lowestS(seg.l, p);
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) { const span = hh[k] - ll[k]; if (span > 0) out[k] = ((hh[k] - seg.c[k]) / span) * -100; }
      return out;
    }
    case "cci": return cciS(seg.h, seg.l, seg.c, argN(0, 20));
    case "roc": {
      const p = argN(0, 12);
      const out = new Float64Array(n).fill(nan);
      for (let k = p; k < n; k++) if (seg.c[k - p] > 0) out[k] = ((seg.c[k] / seg.c[k - p]) - 1) * 100;
      return out;
    }
    case "momentum": {
      const p = argN(0, 10);
      const out = new Float64Array(n).fill(nan);
      for (let k = p; k < n; k++) out[k] = seg.c[k] - seg.c[k - p];
      return out;
    }
    case "mfi": return mfiS(seg.h, seg.l, seg.c, seg.v, argN(0, 14));
    case "cmo": {
      const p = argN(0, 14);
      const out = new Float64Array(n).fill(nan);
      for (let k = p; k < n; k++) {
        let up = 0, dn = 0, bad = false;
        for (let j = 0; j < p; j++) {
          const d = seg.c[k - j] - seg.c[k - j - 1];
          if (Number.isNaN(d)) { bad = true; break; }
          if (d > 0) up += d; else dn -= d;
        }
        if (!bad && up + dn > 0) out[k] = (100 * (up - dn)) / (up + dn);
      }
      return out;
    }
    case "ppo": {
      const f = argN(0, 12), sl = argN(1, 26);
      const ef = emaS(seg.c, f), es = emaS(seg.c, sl);
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = es[k] !== 0 ? ((ef[k] - es[k]) / es[k]) * 100 : nan;
      return out;
    }
    case "trix": {
      const p = argN(0, 15);
      const e3 = emaS(emaS(emaS(seg.c, p), p), p);
      const out = new Float64Array(n).fill(nan);
      for (let k = 1; k < n; k++) if (e3[k - 1] > 0) out[k] = ((e3[k] / e3[k - 1]) - 1) * 100;
      return out;
    }
    case "uo": {
      const p1 = argN(0, 7), p2 = argN(1, 14), p3 = argN(2, 28);
      const out = new Float64Array(n).fill(nan);
      const bp = new Float64Array(n), tr = trueRangeS(seg.h, seg.l, seg.c);
      for (let k = 1; k < n; k++) bp[k] = seg.c[k] - Math.min(seg.l[k], seg.c[k - 1]);
      const avg = (p: number, k: number): number => {
        let sbp = 0, str = 0;
        for (let j = 0; j < p; j++) { sbp += bp[k - j] || 0; str += tr[k - j] || 0; }
        return str > 0 ? sbp / str : nan;
      };
      for (let k = p3; k < n; k++) {
        const a1 = avg(p1, k), a2 = avg(p2, k), a3 = avg(p3, k);
        if (Number.isFinite(a1) && Number.isFinite(a2) && Number.isFinite(a3)) out[k] = (100 * (4 * a1 + 2 * a2 + a3)) / 7;
      }
      return out;
    }
    case "ao": {
      const mp = new Float64Array(n);
      for (let k = 0; k < n; k++) mp[k] = (seg.h[k] + seg.l[k]) / 2;
      const f = smaS(mp, argN(0, 5)), sl = smaS(mp, argN(1, 34));
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = f[k] - sl[k];
      return out;
    }

    // ---- trend
    case "adx": return adxS(seg.h, seg.l, seg.c, argN(0, 14)).adx;
    case "plusDI": return adxS(seg.h, seg.l, seg.c, argN(0, 14)).plusDI;
    case "minusDI": return adxS(seg.h, seg.l, seg.c, argN(0, 14)).minusDI;
    case "supertrend": return supertrendS(seg.h, seg.l, seg.c, argN(0, 10), argN(1, 3)).value;
    case "supertrendDir": return supertrendS(seg.h, seg.l, seg.c, argN(0, 10), argN(1, 3)).dir;
    case "psar": return psarS(seg.h, seg.l, argN(0, 0.02), argN(1, 0.2));
    case "aroonUp": return aroonS(seg.h, seg.l, argN(0, 25)).up;
    case "aroonDown": return aroonS(seg.h, seg.l, argN(0, 25)).down;
    case "aroonOsc": return aroonS(seg.h, seg.l, argN(0, 25)).osc;
    case "ichimokuTenkan": { const p = argN(0, 9); const hh = highestS(seg.h, p), ll = lowestS(seg.l, p); const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = (hh[k] + ll[k]) / 2; return out; }
    case "ichimokuKijun": { const p = argN(1, 26); const hh = highestS(seg.h, p), ll = lowestS(seg.l, p); const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = (hh[k] + ll[k]) / 2; return out; }
    case "ichimokuSenkouA": {
      const t = argN(0, 9), k = argN(1, 26);
      const hhT = highestS(seg.h, t), llT = lowestS(seg.l, t);
      const hhK = highestS(seg.h, k), llK = lowestS(seg.l, k);
      const out = new Float64Array(n).fill(nan);
      for (let j = k; j < n; j++) out[j] = ((hhT[j - k] + llT[j - k]) / 2 + (hhK[j - k] + llK[j - k]) / 2) / 2;
      return out;
    }
    case "ichimokuSenkouB": {
      const sb = argN(2, 52);
      const hh = highestS(seg.h, sb), ll = lowestS(seg.l, sb);
      const out = new Float64Array(n).fill(nan);
      for (let j = argN(1, 26); j < n; j++) out[j] = (hh[j - argN(1, 26)] + ll[j - argN(1, 26)]) / 2;
      return out;
    }
    case "ichimokuChikou": {
      const back = argN(1, 26);
      const out = new Float64Array(n).fill(nan);
      out.set(seg.c.subarray(0, Math.max(0, n - back)), back);
      return out;
    }
    case "vortexPlus": return vortexS(seg.h, seg.l, seg.c, argN(0, 14)).plus;
    case "vortexMinus": return vortexS(seg.h, seg.l, seg.c, argN(0, 14)).minus;
    case "elderBull": {
      const e = emaS(seg.c, argN(0, 13));
      const out = new Float64Array(n);
      for (let k = 0; k < n; k++) out[k] = seg.h[k] - e[k];
      return out;
    }
    case "elderBear": {
      const e = emaS(seg.c, argN(0, 13));
      const out = new Float64Array(n);
      for (let k = 0; k < n; k++) out[k] = seg.l[k] - e[k];
      return out;
    }
    case "haOpen": return heikin(seg).o;
    case "haHigh": return heikin(seg).h;
    case "haLow": return heikin(seg).l;
    case "haClose": return heikin(seg).c;

    // ---- volatility
    case "atr": return rmaS(trueRangeS(seg.h, seg.l, seg.c), argN(0, 14));
    case "natr": {
      const a = rmaS(trueRangeS(seg.h, seg.l, seg.c), argN(0, 14));
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = seg.c[k] > 0 ? (a[k] / seg.c[k]) * 100 : nan;
      return out;
    }
    case "bbUpper": return bands(seg, argN(0, 20), argN(1, 2)).up;
    case "bbMiddle": return bands(seg, argN(0, 20), argN(1, 2)).mid;
    case "bbLower": return bands(seg, argN(0, 20), argN(1, 2)).lo;
    case "bbPctB": return bands(seg, argN(0, 20), argN(1, 2)).pctB;
    case "bbBandwidth": return bands(seg, argN(0, 20), argN(1, 2)).bw;
    case "keltnerUpper": return kelt(seg, argN(0, 20), argN(1, 10), argN(2, 2)).up;
    case "keltnerMiddle": return kelt(seg, argN(0, 20), argN(1, 10), argN(2, 2)).mid;
    case "keltnerLower": return kelt(seg, argN(0, 20), argN(1, 10), argN(2, 2)).lo;
    case "donchianUpper": return highestS(seg.h, argN(0, 20));
    case "donchianLower": return lowestS(seg.l, argN(0, 20));
    case "donchianMiddle": {
      const up = highestS(seg.h, argN(0, 20)), lo = lowestS(seg.l, argN(0, 20));
      const out = new Float64Array(n);
      for (let k = 0; k < n; k++) out[k] = (up[k] + lo[k]) / 2;
      return out;
    }
    case "stddev": return maOver(s, tf, argExpr(0), argN(1, 20), (x, p) => stddevS(x, p));
    case "histVol": {
      const p = argN(0, 20);
      const lr = new Float64Array(n).fill(nan);
      for (let k = 1; k < n; k++) if (seg.c[k - 1] > 0 && seg.c[k] > 0) lr[k] = Math.log(seg.c[k] / seg.c[k - 1]);
      const sd = stddevS(lr, p);
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = sd[k] * 100 * Math.sqrt(252);
      return out;
    }
    case "squeezeFlag": {
      const bb = bands(seg, 20, 2), ke = kelt(seg, 20, 10, 1.5);
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) {
        const bbw = bb.bw[k], keW = ke.up[k] - ke.lo[k];
        const keMidW = keMidWidth(ke, k);
        out[k] = Number.isFinite(bbw) && Number.isFinite(keMidW) ? (bbw / 100) * bb.mid[k] < keMidW ? 1 : 0 : nan;
      }
      return out;
    }

    // ---- volume indicators
    case "obv": return obvS(seg.c, seg.v);
    case "adLine": return adLineS(seg.h, seg.l, seg.c, seg.v);
    case "pvt": return pvtS(seg.c, seg.v);
    case "cmf": {
      const p = argN(0, 20);
      const out = new Float64Array(n).fill(nan);
      for (let k = p - 1; k < n; k++) {
        let clvV = 0, vSum = 0, bad = false;
        for (let j = 0; j < p; j++) {
          const span = seg.h[k - j] - seg.l[k - j];
          if (!(span >= 0) || Number.isNaN(span)) { bad = true; break; }
          const clv = span > 0 ? ((seg.c[k - j] - seg.l[k - j]) - (seg.h[k - j] - seg.c[k - j])) / span : 0;
          clvV += clv * seg.v[k - j];
          vSum += seg.v[k - j];
        }
        if (!bad && vSum > 0) out[k] = clvV / vSum;
      }
      return out;
    }
    case "chaikinOsc": {
      const ad = adLineS(seg.h, seg.l, seg.c, seg.v);
      const f = emaS(ad, argN(0, 3)), sl = emaS(ad, argN(1, 10));
      const out = new Float64Array(n);
      for (let k = 0; k < n; k++) out[k] = f[k] - sl[k];
      return out;
    }
    case "forceIndex": {
      const p = argN(0, 13);
      const raw = new Float64Array(n).fill(nan);
      for (let k = 1; k < n; k++) raw[k] = (seg.c[k] - seg.c[k - 1]) * seg.v[k];
      return emaS(raw, p);
    }
    case "volOsc": {
      const f = argN(0, 5), sl = argN(1, 10);
      const sf = smaS(seg.v, f), ss = smaS(seg.v, sl);
      const out = new Float64Array(n).fill(nan);
      for (let k = 0; k < n; k++) out[k] = ss[k] > 0 ? ((sf[k] - ss[k]) / ss[k]) * 100 : nan;
      return out;
    }
    case "eom": {
      const p = argN(0, 14);
      const raw = new Float64Array(n).fill(nan);
      for (let k = 1; k < n; k++) {
        const mid = (seg.h[k] + seg.l[k]) / 2, prev = (seg.h[k - 1] + seg.l[k - 1]) / 2;
        const span = seg.h[k] - seg.l[k];
        const box = seg.v[k] > 0 ? seg.v[k] / 1e8 / Math.max(span, 1e-9) : nan;
        raw[k] = Number.isFinite(box) && box !== 0 ? ((mid - prev) * box) : nan;
      }
      return smaS(raw, p);
    }

    // ---- window functions (over an arbitrary operand series)
    case "winMax": case "highest": return winOver(s, tf, argExpr(1), argN(0, 20), highestS);
    case "winMin": case "lowest": return winOver(s, tf, argExpr(1), argN(0, 20), lowestS);
    case "winAvg": return winOver(s, tf, argExpr(1), argN(0, 20), smaS);
    case "median": return winOver(s, tf, argExpr(1), argN(0, 20), medianS);
    case "winSum": {
      const x = operandSeries(s, tf, argExpr(1));
      if (!x) return null;
      const p = argN(0, 20);
      const out = new Float64Array(x.length).fill(nan);
      for (let k = p - 1; k < x.length; k++) {
        let sum = 0, bad = false;
        for (let j = 0; j < p; j++) { const v = x[k - j]; if (Number.isNaN(v)) { bad = true; break; } sum += v; }
        if (!bad) out[k] = sum;
      }
      return out;
    }
    case "winCount": {
      // bars in the window where the operand series is positive (the grammar
      // expresses conditions as arithmetic — e.g. Count(10, Close − Open))
      const x = operandSeries(s, tf, argExpr(1));
      if (!x) return null;
      const p = argN(0, 10);
      const out = new Float64Array(x.length).fill(nan);
      for (let k = p - 1; k < x.length; k++) {
        let c = 0, bad = false;
        for (let j = 0; j < p; j++) { const v = x[k - j]; if (Number.isNaN(v)) { bad = true; break; } if (v > 0) c++; }
        if (!bad) out[k] = c;
      }
      return out;
    }
    case "winChange": {
      const x = operandSeries(s, tf, argExpr(1));
      if (!x) return null;
      const p = argN(0, 1);
      const out = new Float64Array(x.length).fill(nan);
      for (let k = p; k < x.length; k++) out[k] = x[k] - x[k - p];
      return out;
    }
    case "winPctChange": {
      const x = operandSeries(s, tf, argExpr(1));
      if (!x) return null;
      const p = argN(0, 1);
      const out = new Float64Array(x.length).fill(nan);
      for (let k = p; k < x.length; k++) if (x[k - p] > 0) out[k] = ((x[k] / x[k - p]) - 1) * 100;
      return out;
    }
    case "daysSinceHighest": return winOver(s, tf, argExpr(1), argN(0, 20), daysSinceHighestS);
    case "daysSinceLowest": return winOver(s, tf, argExpr(1), argN(0, 20), daysSinceLowestS);

    // ---- math functions (elementwise over the operand)
    case "abs": return math1(s, tf, argExpr(0), Math.abs);
    case "sqrt": return math1(s, tf, argExpr(0), Math.sqrt);
    case "floor": return math1(s, tf, argExpr(0), Math.floor);
    case "ceil": return math1(s, tf, argExpr(0), Math.ceil);
    case "exp": return math1(s, tf, argExpr(0), Math.exp);
    case "sign": return math1(s, tf, argExpr(0), Math.sign);
    case "log": return math1(s, tf, argExpr(0), (x) => (x > 0 ? Math.log10(x) : nan));
    case "ln": return math1(s, tf, argExpr(0), (x) => (x > 0 ? Math.log(x) : nan));
    case "round": {
      const x = operandSeries(s, tf, argExpr(0));
      if (!x) return null;
      const d = argN(1, 0);
      const m = Math.pow(10, d);
      return unaryOp(x, (v) => Math.round(v * m) / m);
    }
    case "max2": case "min2": {
      const a = operandSeries(s, tf, argExpr(0)), b = operandSeries(s, tf, argExpr(1));
      if (!a || !b) return null;
      const out = new Float64Array(Math.max(a.length, b.length)).fill(nan);
      for (let k = 0; k < out.length; k++) {
        const av = a[Math.min(k, a.length - 1)], bv = b[Math.min(k, b.length - 1)];
        out[k] = name === "max2" ? Math.max(av, bv) : Math.min(av, bv);
      }
      return out;
 }

    // ---- pivots
    case "insideBar": {
      const out = new Float64Array(n).fill(nan);
      for (let k = 1; k < n; k++) out[k] = seg.h[k] < seg.h[k - 1] && seg.l[k] > seg.l[k - 1] ? 1 : 0;
      return out;
    }
    case "outsideBar": {
      const out = new Float64Array(n).fill(nan);
      for (let k = 1; k < n; k++) out[k] = seg.h[k] > seg.h[k - 1] && seg.l[k] < seg.l[k - 1] ? 1 : 0;
      return out;
    }
    case "nr4": case "nr7": {
      const p = name === "nr4" ? 4 : 7;
      const r = new Float64Array(n);
      for (let k = 0; k < n; k++) r[k] = seg.h[k] - seg.l[k];
      const out = new Float64Array(n).fill(nan);
      for (let k = p - 1; k < n; k++) {
        let min = Infinity, bad = false;
        for (let j = 0; j < p; j++) { const v = r[k - j]; if (Number.isNaN(v)) { bad = true; break; } if (v < min) min = v; }
        if (!bad) out[k] = r[k] <= min ? 1 : 0;
      }
      return out;
    }

    default:
      if (name.startsWith("piv-")) {
        const [, sys, lvl] = name.split("-");
        return pivotSeries(s, sys, lvl, tf);
      }
      if (PATTERN_IDS.has(name)) {
        const out = new Float64Array(n).fill(nan);
        out[i] = patternFlag(s, name, shift);
        return out;
      }
      return null; // unknown id — the whitelist will mark the clause unevaluable
  }
}

// helpers used by the dispatch
function temaSHelper(x: Float64Array, p: number): Float64Array {
  const e1 = emaS(x, p), e2 = emaS(e1, p), e3 = emaS(e2, p);
  const out = new Float64Array(x.length).fill(nan);
  for (let i = 0; i < x.length; i++) out[i] = 3 * e1[i] - 3 * e2[i] + e3[i];
  return out;
}
type MaFn = (x: Float64Array, p: number) => Float64Array;

/** Materialise the MA source operand (defaults to Close), then apply the MA. */
function maOver(s: Sess, tf: Timeframe, src: Expr | undefined, p: number, f: MaFn): MaybeS {
  const x = src ? operandSeries(s, tf, src) : segFor(s, tf).c;
  if (!x) return null;
  return f(x, p);
}

function operandSeries(s: Sess, baseTf: Timeframe, expr: Expr | undefined): MaybeS {
  if (!expr || expr.length === 0) return null;
  const r = exprSeries(s, expr, baseTf, 0);
  return r.ok ? r.series : null;
}

function math1(s: Sess, tf: Timeframe, src: Expr | undefined, f: (x: number) => number): MaybeS {
  const x = operandSeries(s, tf, src);
  if (!x) return null;
  return unaryOp(x, f);
}

function winOver(s: Sess, tf: Timeframe, src: Expr | undefined, p: number, f: MaFn): MaybeS {
  return maOver(s, tf, src, p, f);
}

function bands(seg: TfArrays, p: number, mult: number) {
  const n = seg.n;
  const mid = smaS(seg.c, p), sd = stddevS(seg.c, p);
  const up = new Float64Array(n), lo = new Float64Array(n), pctB = new Float64Array(n).fill(nan), bw = new Float64Array(n).fill(nan);
  for (let k = 0; k < n; k++) {
    up[k] = mid[k] + mult * sd[k];
    lo[k] = mid[k] - mult * sd[k];
    const span = up[k] - lo[k];
    if (span > 0) { pctB[k] = (seg.c[k] - lo[k]) / span; bw[k] = (span / mid[k]) * 100; }
  }
  return { up, lo, mid, pctB, bw };
}

function kelt(seg: TfArrays, p: number, emaP: number, mult: number) {
  const n = seg.n;
  const mid = emaS(seg.c, emaP);
  const atr = rmaS(trueRangeS(seg.h, seg.l, seg.c), p);
  const up = new Float64Array(n), lo = new Float64Array(n);
  for (let k = 0; k < n; k++) { up[k] = mid[k] + mult * atr[k]; lo[k] = mid[k] - mult * atr[k]; }
  return { up, lo, mid };
}

function keMidWidth(ke: { up: Float64Array; lo: Float64Array }, k: number): number {
  return ke.up[k] - ke.lo[k];
}

function heikin(seg: TfArrays) {
  const n = seg.n;
  const c = new Float64Array(n), o = new Float64Array(n).fill(nan), h = new Float64Array(n), l = new Float64Array(n);
  for (let k = 0; k < n; k++) c[k] = (seg.o[k] + seg.h[k] + seg.l[k] + seg.c[k]) / 4;
  for (let k = 0; k < n; k++) {
    if (k === 0) { o[k] = (seg.o[k] + seg.c[k]) / 2; continue; }
    o[k] = (o[k - 1] + c[k - 1]) / 2;
  }
  for (let k = 0; k < n; k++) {
    h[k] = Math.max(seg.h[k], o[k], c[k]);
    l[k] = Math.min(seg.l[k], o[k], c[k]);
  }
  return { o, h, l, c };
}

// ---------------------------------------------------------------- scalar attrs

/**
 * Non-time-based scalars: text attributes (string | ""), fundamentals and
 * index-context values (number | null). Returns undefined when the id is a
 * time-based attribute the series dispatch owns.
 */
export function attrScalar(s: Sess, name: string, period: FundPeriod | undefined): string | number | null | undefined {
  const st = s.store;
  const si = s.si;
  switch (name) {
    case "symbol": return st.symbols[si].replace(/\.NS$/, "");
    case "companyName": return st.rows[si]?.name ?? "";
    case "sector": return st.rows[si]?.sector ?? "";
    case "industry": return st.rows[si]?.industry ?? "";
    case "mcapName": return mcapClassOf(st, si);
    case "rsScore": return num(crossSection(st).rsScore[si]);
    case "rsRating": return num(crossSection(st).rsRating[si]);
    case "rsRatingChange": {
      const now = crossSection(st).rsRating[si];
      const ago = rsRatingAt(st, 5)[si];
      return Number.isFinite(now) && Number.isFinite(ago) ? now - ago : nan;
    }
    case "sectorRsRank": return num(crossSection(st).sectorRank[si]);
    case "industryRsRank": return num(crossSection(st).industryRank[si]);
    case "beta1Y": return beta1Y(st, si);
    case "outperfNifty": {
      const r = retOver(st, si, 252);
      const ir = indexRetOver(st, "nifty50", 252);
      return Number.isFinite(r) && Number.isFinite(ir) ? r - ir : nan;
    }
    case "rsVsNifty": {
      const seg = segFor(s, "daily");
      if (seg.n === 0) return nan;
      const idx = indexScalarAt(st, "nifty50", seg.d[seg.n - 1]);
      return idx > 0 ? seg.c[seg.n - 1] / idx : nan;
    }
    case "rsLineNewHigh": {
      const seg = segFor(s, "daily");
      if (seg.n < 30) return nan;
      const idx = st.indices.get("nifty50");
      if (!idx) return nan;
      let rs = nan, max = nan;
      for (let k = Math.max(0, seg.n - 252); k < seg.n; k++) {
        const ic = indexScalarAt(st, "nifty50", seg.d[k]);
        if (!(ic > 0)) continue;
        const v = seg.c[k] / ic;
        if (Number.isNaN(max) || v >= max) { max = v; }
        if (k === seg.n - 1) rs = v;
      }
      return Number.isFinite(rs) && Number.isFinite(max) && rs >= max ? 1 : 0;
    }
    case "ret1D": return num(retOver(st, si, 1));
    case "ret1W": return num(retOver(st, si, 5));
    case "ret1M": return num(retOver(st, si, 21));
    case "ret3M": return num(retOver(st, si, 63));
    case "ret6M": return num(retOver(st, si, 126));
    case "ret1Y": return num(retOver(st, si, 252));
    default: break;
  }
  // index context
  if (name.endsWith("ChangePct") || name.endsWith("Close")) {
    const indexId = name.endsWith("ChangePct") ? name.slice(0, -"ChangePct".length) : name.slice(0, -"Close".length);
    const seg = segFor(s, "daily");
    const day = seg.n > 0 ? seg.d[seg.n - 1] : Math.floor(Date.now() / 86400000);
    if (name.endsWith("Close")) return num(indexScalarAt(st, indexId, day));
    return num(indexChangePct(st, indexId, day, 1));
  }
  // fundamentals
  if (st.fund.has(name)) {
    const arr = st.fund.get(name)!;
    const p: FundPeriod = period ?? "ttm";
    if (p.startsWith("q")) {
      // TTM-flow fields don't carry quarterly slices yet — null until the
      // fundamentals table stores them
      const q = st.fundQuarterly.get(quarterFieldOf(name));
      if (!q) return null;
      const v = q[+p.slice(1)]?.[si];
      return v == null || Number.isNaN(v) ? null : v;
    }
    if (p.startsWith("fy")) {
      const q = st.fundAnnual.get(annualFieldOf(name));
      if (!q) return null;
      const v = q[+p.slice(2)]?.[si];
      return v == null || Number.isNaN(v) ? null : v;
    }
    const v = arr[si];
    return Number.isNaN(v) ? null : v;
  }
  return undefined; // not a scalar attr
}

function quarterFieldOf(name: string): string {
  switch (name) {
    case "epsQuarterly": return "epsQuarterly";
    case "salesQuarterly": return "salesQuarterly";
    case "netProfitQuarterly": return "netProfitQuarterly";
    default: return "";
  }
}
function annualFieldOf(name: string): string {
  switch (name) {
    case "annualEps": return "annualEps";
    case "revenueGrowth": case "earningsGrowth": case "epsGrowthYoY": case "epsCagr3Y": return "annualEps";
    default: return "annualEps";
  }
}

function retOver(st: Store, si: number, k: number): number {
  const start = st.off[si], len = st.dailyN[si];
  if (len <= k) return nan;
  const now = st.daily.c[start + len - 1], before = st.daily.c[start + len - 1 - k];
  return before > 0 ? ((now - before) / before) * 100 : nan;
}

function indexRetOver(st: Store, id: string, k: number): number {
  const tf = st.indices.get(id);
  if (!tf || tf.n <= k) return nan;
  const now = tf.c[tf.n - 1], before = tf.c[tf.n - 1 - k];
  return before > 0 ? ((now - before) / before) * 100 : nan;
}

function beta1Y(st: Store, si: number): number {
  const idx = st.indices.get("nifty50");
  if (!idx) return nan;
  const start = st.off[si], len = st.dailyN[si];
  const seg = { d: st.daily.d, c: st.daily.c, off: start, len };
  const rs: number[] = [], ri: number[] = [];
  for (let k = Math.max(1, len - 252); k < len; k++) {
    const d = seg.d[start + k];
    let lo = 0, hi = idx.n - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (idx.d[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (ans < 1) continue;
    const rc = seg.c[start + k], rpc = seg.c[start + k - 1];
    const ic = idx.c[ans], ipc = idx.c[ans - 1];
    if (rpc > 0 && ipc > 0) { rs.push((rc / rpc - 1) * 100); ri.push((ic / ipc - 1) * 100); }
  }
  if (rs.length < 60) return nan;
  const n = rs.length;
  const mr = rs.reduce((a, b) => a + b, 0) / n;
  const mi = ri.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varI = 0;
  for (let k = 0; k < n; k++) { cov += (rs[k] - mr) * (ri[k] - mi); varI += (ri[k] - mi) ** 2; }
  return varI > 0 ? cov / varI : nan;
}

// ---------------------------------------------------------------- expression eval

export type ExprResult = { ok: true; series: Float64Array } | { ok: false; why: string };

/**
 * Evaluate an Expr aligned to `baseTf`'s bars for this stock. Leaves carry
 * their own tf/offset; different-tf leaves are as-of joined onto the base.
 * `extraShift` moves every time-based leaf further back (cross comparators).
 */
export function exprSeries(s: Sess, expr: Expr, baseTf: Timeframe, extraShift = 0): ExprResult {
  const ast = astOf(expr);
  if (!ast) return { ok: false, why: "empty" };
  const base = segFor(s, baseTf);
  if (base.n === 0) return { ok: false, why: "no bars" };
  const ev = (node: ReturnType<typeof astOf>): MaybeS => {
    if (!node) return null;
    if (node.k === "num") return constS(node.v, base.n);
    if (node.k === "bin") {
      const a = ev(node.a), b = ev(node.b);
      if (!a || !b) return null;
      return binOp(a, b, node.op);
    }
    return leafSeries(s, node.term, baseTf, extraShift, base.n);
  };
  const out = ev(ast);
  if (!out) return { ok: false, why: "operand unavailable" };
  return { ok: true, series: out };
}

/** Scalar value of an expr at the evaluation bar (base tf latest − extraShift). */
export function exprScalar(s: Sess, expr: Expr, baseTf: Timeframe, extraShift = 0): number {
  const r = exprSeries(s, expr, baseTf, extraShift);
  if (!r.ok) return nan;
  const seg = segFor(s, baseTf);
  const i = seg.n - 1 - extraShift;
  return i >= 0 && i < r.series.length ? r.series[i] : nan;
}

function leafSeries(s: Sess, term: Term, baseTf: Timeframe, extraShift: number, baseN: number): MaybeS {
  if (term.t === "number") return constS(term.value, baseN);
  if (term.t === "text") return null;
  if (term.t === "bracket") {
    const r = exprSeries(s, term.inner, baseTf, extraShift);
    return r.ok ? r.series : null;
  }
  if (term.t === "saved") return null; // saved formulas resolve before evaluation
  const tf = term.tf ?? "daily";
  const own = segFor(s, tf);
  if (own.n === 0) return null;
  const ownShift = offsetBars(own, term.offset, own.n - 1) + extraShift;
  const series = term.t === "attr"
    ? attrSeries(s, term.name, tf, ownShift, term.period, undefined)
    : attrSeries(s, term.name, tf, ownShift, undefined, term.args);
  if (!series) return null;
  if (tf === baseTf) return series.length === baseN ? series : resizeTail(series, baseN);
  // as-of join: for each base bar, the latest own-tf value with date ≤ base date
  const base = segFor(s, baseTf);
  const out = new Float64Array(baseN).fill(nan);
  const st = s.store;
  const startOwn = tf === "weekly" ? st.weeklyOff[s.si] : tf === "monthly" ? st.monthlyOff[s.si] : st.off[s.si];
  const fromDaily = tf === "weekly" || tf === "monthly" ? own.fromDaily : null; // daily → own-tf map
  for (let b = 0; b < baseN; b++) {
    // flat daily index of this base bar (base may itself be weekly/monthly)
    let dailyIdx: number;
    if (baseTf === "daily") dailyIdx = st.off[s.si] + b;
    else if (base.fromDaily) dailyIdx = base.fromDaily[st.off[s.si] + b];
    else continue;
    if (dailyIdx < 0) continue;
    const ownIdx = fromDaily && tf !== "daily" ? fromDaily[dailyIdx] - startOwn : dailyIdx - st.off[s.si];
    const j = ownIdx - ownShift;
    if (j >= 0 && j < series.length) out[b] = series[j];
  }
  return out;
}

function resizeTail(x: Float64Array, n: number): Float64Array {
  if (x.length === n) return x;
  const out = new Float64Array(n).fill(nan);
  const take = Math.min(n, x.length);
  out.set(x.subarray(x.length - take), n - take);
  return out;
}

export { unaryOp };
