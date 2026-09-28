/**
 * Scan builder — pure indicator math on Float64Array segments.
 *
 * Every function maps a full series to a full series of the same length
 * (NaN where undefined), so the evaluator can pick any bar via shift
 * without special-casing "latest". Warm-up regions are NaN, which the
 * comparison layer treats as "insufficient data" (no match + skip count).
 */

export const nan = Number.NaN;

export function constS(v: number, n: number): Float64Array {
  const out = new Float64Array(n).fill(v);
  if (Number.isNaN(v)) out.fill(nan);
  return out;
}

export function binOp(a: Float64Array, b: Float64Array, op: MathOp2): Float64Array {
  const n = Math.min(a.length, b.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    switch (op) {
      case "+": out[i] = x + y; break;
      case "-": out[i] = x - y; break;
      case "*": out[i] = x * y; break;
      case "/": out[i] = x / y; break;
      case "%": out[i] = x % y; break;
      case "^": out[i] = Math.pow(x, y); break;
    }
  }
  return out;
}
type MathOp2 = "+" | "-" | "*" | "/" | "%" | "^";

export function unaryOp(a: Float64Array, f: (x: number) => number): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f(a[i]);
  return out;
}

export function smaS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  if (p <= 0) return out;
  let sum = 0, have = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (!Number.isNaN(v)) { sum += v; have++; }
    if (i >= p) {
      const old = x[i - p];
      if (!Number.isNaN(old)) { sum -= old; have--; }
    }
    if (have === p) out[i] = sum / p;
  }
  return out;
}

export function emaS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  const k = 2 / (p + 1);
  let prev = nan;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      // seed with the first value; stabilises over the warm-up
      prev = v;
    } else {
      prev = v * k + prev * (1 - k);
    }
    if (i >= p - 1) out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (RMA). */
export function rmaS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  let prev = nan, seed = 0, seedN = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seed += v; seedN++;
      if (seedN === p) { prev = seed / p; out[i] = prev; }
    } else {
      prev = (prev * (p - 1) + v) / p;
      out[i] = prev;
    }
  }
  return out;
}

export function wmaS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  const denom = (p * (p + 1)) / 2;
  for (let i = p - 1; i < n; i++) {
    let s = 0, bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - p + 1 + k];
      if (Number.isNaN(v)) { bad = true; break; }
      s += v * (k + 1);
    }
    if (!bad) out[i] = s / denom;
  }
  return out;
}

function shiftNeg(x: Float64Array, k: number): Float64Array {
  const out = new Float64Array(x.length).fill(nan);
  for (let i = k; i < x.length; i++) out[i] = x[i - k];
  return out;
}

export function demaS(x: Float64Array, p: number): Float64Array {
  const e1 = emaS(x, p), e2 = emaS(e1, p);
  const n = x.length, out = new Float64Array(n).fill(nan);
  for (let i = 0; i < n; i++) out[i] = 2 * e1[i] - e2[i];
  return out;
}

export function temaS(x: Float64Array, p: number): Float64Array {
  const e1 = emaS(x, p), e2 = emaS(e1, p), e3 = emaS(e2, p);
  const n = x.length, out = new Float64Array(n).fill(nan);
  for (let i = 0; i < n; i++) out[i] = 3 * e1[i] - 3 * e2[i] + e3[i];
  return out;
}

export function hmaS(x: Float64Array, p: number): Float64Array {
  const half = Math.max(1, Math.round(p / 2));
  const sq = Math.max(1, Math.round(Math.sqrt(p)));
  const w1 = wmaS(x, half), w2 = wmaS(x, p);
  const diff = new Float64Array(x.length).fill(nan);
  for (let i = 0; i < x.length; i++) diff[i] = 2 * w1[i] - w2[i];
  return wmaS(diff, sq);
}

export function vwmaS(x: Float64Array, v: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  const xv = new Float64Array(n);
  for (let i = 0; i < n; i++) xv[i] = x[i] * v[i];
  const sx = smaS(xv, p), sv = smaS(v, p);
  for (let i = 0; i < n; i++) out[i] = sv[i] > 0 ? sx[i] / sv[i] : nan;
  return out;
}

/** Linear regression endpoint value / slope over a p-window. */
export function linregS(x: Float64Array, p: number, mode: "value" | "slope"): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  const sx = (p * (p - 1)) / 2;
  const sxx = ((p - 1) * p * (2 * p - 1)) / 6;
  const denom = p * sxx - sx * sx;
  for (let i = p - 1; i < n; i++) {
    let sy = 0, sxy = 0, bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - p + 1 + k];
      if (Number.isNaN(v)) { bad = true; break; }
      sy += v; sxy += k * v;
    }
    if (bad) continue;
    const slope = (p * sxy - sx * sy) / denom;
    if (mode === "slope") out[i] = slope;
    else out[i] = (sy - slope * sx) / p + slope * (p - 1);
  }
  return out;
}

export function stddevS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  for (let i = p - 1; i < n; i++) {
    let s = 0, bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - k];
      if (Number.isNaN(v)) { bad = true; break; }
      s += v;
    }
    if (bad) continue;
    const m = s / p;
    let ss = 0;
    for (let k = 0; k < p; k++) ss += (x[i - k] - m) ** 2;
    out[i] = Math.sqrt(ss / p);
  }
  return out;
}

export function highestS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  for (let i = p - 1; i < n; i++) {
    let m = -Infinity, bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - k];
      if (Number.isNaN(v)) { bad = true; break; }
      if (v > m) m = v;
    }
    if (!bad) out[i] = m;
  }
  return out;
}

export function lowestS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  for (let i = p - 1; i < n; i++) {
    let m = Infinity, bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - k];
      if (Number.isNaN(v)) { bad = true; break; }
      if (v < m) m = v;
    }
    if (!bad) out[i] = m;
  }
  return out;
}

export function medianS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  const buf = new Float64Array(p);
  for (let i = p - 1; i < n; i++) {
    let bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - k];
      if (Number.isNaN(v)) { bad = true; break; }
      buf[k] = v;
    }
    if (bad) continue;
    const arr = Array.from(buf).sort((a, b) => a - b);
    out[i] = p % 2 ? arr[(p - 1) / 2] : (arr[p / 2 - 1] + arr[p / 2]) / 2;
  }
  return out;
}

/** Bars since the window max (0 = current bar is the max). */
export function daysSinceHighestS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  for (let i = p - 1; i < n; i++) {
    let m = -Infinity, idx = -1, bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - k];
      if (Number.isNaN(v)) { bad = true; break; }
      if (v >= m) { m = v; idx = k; }
    }
    if (!bad) out[i] = idx;
  }
  return out;
}

export function daysSinceLowestS(x: Float64Array, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(nan);
  for (let i = p - 1; i < n; i++) {
    let m = Infinity, idx = -1, bad = false;
    for (let k = 0; k < p; k++) {
      const v = x[i - k];
      if (Number.isNaN(v)) { bad = true; break; }
      if (v <= m) { m = v; idx = k; }
    }
    if (!bad) out[i] = idx;
  }
  return out;
}

export function rsiS(x: Float64Array, p: number): Float64Array {
  const n = x.length;
  const gains = new Float64Array(n), losses = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = x[i] - x[i - 1];
    gains[i] = Number.isNaN(d) ? nan : Math.max(0, d);
    losses[i] = Number.isNaN(d) ? nan : Math.max(0, -d);
  }
  const ag = rmaS(gains, p), al = rmaS(losses, p);
  const out = new Float64Array(n).fill(nan);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(ag[i]) || Number.isNaN(al[i])) continue;
    out[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

export interface MacdOut { line: Float64Array; signal: Float64Array; hist: Float64Array }
export function macdS(x: Float64Array, fast: number, slow: number, signal: number): MacdOut {
  const ef = emaS(x, fast), es = emaS(x, slow);
  const line = new Float64Array(x.length).fill(nan);
  for (let i = 0; i < x.length; i++) line[i] = ef[i] - es[i];
  const sig = emaS(line, signal);
  const hist = new Float64Array(x.length).fill(nan);
  for (let i = 0; i < x.length; i++) hist[i] = line[i] - sig[i];
  return { line, signal: sig, hist };
}

export function trueRangeS(h: Float64Array, l: Float64Array, c: Float64Array): Float64Array {
  const n = h.length, out = new Float64Array(n).fill(nan);
  for (let i = 0; i < n; i++) {
    const pc = i > 0 ? c[i - 1] : nan;
    const a = Number.isNaN(pc) ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
    out[i] = a;
  }
  return out;
}

export function stochKs(h: Float64Array, l: Float64Array, c: Float64Array, p: number, kSmooth: number, dPeriod: number) {
  const n = h.length;
  const raw = new Float64Array(n).fill(nan);
  const hh = highestS(h, p), ll = lowestS(l, p);
  for (let i = 0; i < n; i++) {
    const span = hh[i] - ll[i];
    if (!Number.isNaN(span) && span > 0) raw[i] = ((c[i] - ll[i]) / span) * 100;
  }
  const k = smaS(raw, kSmooth);
  const d = smaS(k, dPeriod);
  return { k, d };
}

export function cciS(h: Float64Array, l: Float64Array, c: Float64Array, p: number): Float64Array {
  const n = h.length;
  const tp = new Float64Array(n);
  for (let i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3;
  const ma = smaS(tp, p);
  const out = new Float64Array(n).fill(nan);
  for (let i = p - 1; i < n; i++) {
    let md = 0, bad = false;
    for (let k = 0; k < p; k++) {
      const v = tp[i - k];
      if (Number.isNaN(v) || Number.isNaN(ma[i])) { bad = true; break; }
      md += Math.abs(v - ma[i]);
    }
    if (bad || md === 0) continue;
    out[i] = (tp[i] - ma[i]) / (0.015 * (md / p));
  }
  return out;
}

export function mfiS(h: Float64Array, l: Float64Array, c: Float64Array, v: Float64Array, p: number): Float64Array {
  const n = h.length, out = new Float64Array(n).fill(nan);
  const tp = new Float64Array(n);
  for (let i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3;
  for (let i = p; i < n; i++) {
    let pos = 0, neg = 0, bad = false;
    for (let k = 0; k < p; k++) {
      const j = i - k;
      if (Number.isNaN(tp[j]) || Number.isNaN(tp[j - 1])) { bad = true; break; }
      const flow = tp[j] * v[j];
      if (tp[j] > tp[j - 1]) pos += flow; else if (tp[j] < tp[j - 1]) neg += flow;
    }
    if (bad) continue;
    out[i] = pos + neg === 0 ? nan : (100 * pos) / (pos + neg);
  }
  return out;
}

export function adxS(h: Float64Array, l: Float64Array, c: Float64Array, p: number) {
  const n = h.length;
  const tr = trueRangeS(h, l, c);
  const plusDM = new Float64Array(n), minusDM = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
  }
  const atr = rmaS(tr, p), pdi = rmaS(plusDM, p), mdi = rmaS(minusDM, p);
  const dx = new Float64Array(n).fill(nan);
  const pdiV = new Float64Array(n).fill(nan), mdiV = new Float64Array(n).fill(nan);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(atr[i]) || atr[i] === 0) continue;
    pdiV[i] = (100 * pdi[i]) / atr[i];
    mdiV[i] = (100 * mdi[i]) / atr[i];
    const sum = pdiV[i] + mdiV[i];
    dx[i] = sum === 0 ? nan : (100 * Math.abs(pdiV[i] - mdiV[i])) / sum;
  }
  return { adx: rmaS(dx, p), plusDI: pdiV, minusDI: mdiV };
}

export function supertrendS(h: Float64Array, l: Float64Array, c: Float64Array, p: number, mult: number) {
  const n = h.length;
  const atr = rmaS(trueRangeS(h, l, c), p);
  const value = new Float64Array(n).fill(nan);
  const dir = new Float64Array(n).fill(nan); // 1 = uptrend
  let prevUpper = nan, prevLower = nan, prevDir = 1, prevLine = nan;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(atr[i])) continue;
    const mid = (h[i] + l[i]) / 2;
    let upper = mid + mult * atr[i];
    let lower = mid - mult * atr[i];
    if (!Number.isNaN(prevUpper)) {
      upper = c[i - 1] > prevUpper ? upper : Math.min(upper, prevUpper);
      lower = c[i - 1] < prevLower ? lower : Math.max(lower, prevLower);
    }
    const d = !Number.isNaN(prevLine) && c[i] < prevLine ? -1 : !Number.isNaN(prevLine) && c[i] > prevLine ? 1 : prevDir;
    const line = d === 1 ? lower : upper;
    value[i] = line;
    dir[i] = d;
    prevUpper = upper; prevLower = lower; prevDir = d; prevLine = line;
  }
  return { value, dir };
}

export function psarS(h: Float64Array, l: Float64Array, step: number, max: number): Float64Array {
  const n = h.length, out = new Float64Array(n).fill(nan);
  if (n < 2) return out;
  let bull = true, af = step, ep = h[0], sar = l[0];
  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (bull) {
      if (l[i] < sar) { bull = false; sar = ep; ep = l[i]; af = step; }
      else if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, max); }
    } else {
      if (h[i] > sar) { bull = true; sar = ep; ep = h[i]; af = step; }
      else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, max); }
    }
    out[i] = sar;
  }
  return out;
}

export function aroonS(h: Float64Array, l: Float64Array, p: number) {
  const n = h.length;
  const up = new Float64Array(n).fill(nan), down = new Float64Array(n).fill(nan);
  const sinceH = daysSinceHighestS(h, p + 1), sinceL = daysSinceLowestS(l, p + 1);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(sinceH[i])) continue;
    up[i] = (100 * (p - sinceH[i])) / p;
    down[i] = (100 * (p - sinceL[i])) / p;
  }
  const osc = new Float64Array(n).fill(nan);
  for (let i = 0; i < n; i++) osc[i] = up[i] - down[i];
  return { up, down, osc };
}

export function vortexS(h: Float64Array, l: Float64Array, c: Float64Array, p: number) {
  const n = h.length;
  const tr = trueRangeS(h, l, c);
  const vPlus = new Float64Array(n), vMinus = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    vPlus[i] = Math.abs(h[i] - l[i - 1]);
    vMinus[i] = Math.abs(l[i] - h[i - 1]);
  }
  const sTR = smaS(tr, p), sP = smaS(vPlus, p), sM = smaS(vMinus, p);
  const plus = new Float64Array(n).fill(nan), minus = new Float64Array(n).fill(nan);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(sTR[i]) && sTR[i] > 0) { plus[i] = sP[i] / sTR[i]; minus[i] = sM[i] / sTR[i]; }
  }
  return { plus, minus };
}

export function obvS(c: Float64Array, v: Float64Array): Float64Array {
  const n = c.length, out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && !Number.isNaN(c[i - 1])) acc += c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0;
    out[i] = acc;
  }
  return out;
}

export function adLineS(h: Float64Array, l: Float64Array, c: Float64Array, v: Float64Array): Float64Array {
  const n = c.length, out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const span = h[i] - l[i];
    const clv = span > 0 ? ((c[i] - l[i]) - (h[i] - c[i])) / span : 0;
    acc += clv * v[i];
    out[i] = acc;
  }
  return out;
}

export function pvtS(c: Float64Array, v: Float64Array): Float64Array {
  const n = c.length, out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && !Number.isNaN(c[i - 1]) && c[i - 1] !== 0) acc += ((c[i] - c[i - 1]) / c[i - 1]) * v[i];
    out[i] = acc;
  }
  return out;
}

export { shiftNeg };
