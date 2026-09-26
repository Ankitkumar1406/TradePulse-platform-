/**
 * Technical indicators computed from daily close series.
 * All functions expect arrays ordered oldest -> newest.
 */

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. Returns the latest value. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD (12, 26, 9). Returns latest macd, signal and histogram. */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
  if (closes.length < slow + signalPeriod) return { macd: null, signal: null, hist: null };
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] != null && emaSlow[i] != null) {
      macdLine.push((emaFast[i] as number) - (emaSlow[i] as number));
      idx.push(i);
    }
  }
  if (macdLine.length < signalPeriod) return { macd: null, signal: null, hist: null };
  const sigSeries = emaSeries(macdLine, signalPeriod);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSig = sigSeries[sigSeries.length - 1];
  return {
    macd: lastMacd,
    signal: lastSig,
    hist: lastSig != null ? lastMacd - lastSig : null,
  };
}

/** Percent return over approximately `days` trading days ago. */
export function momentum(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const past = closes[closes.length - 1 - days];
  const now = closes[closes.length - 1];
  if (!past) return null;
  return ((now - past) / past) * 100;
}

/** ATR% proxy computed from close-to-close true range (no OHLC in spark data). */
export function closeAtrPct(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += Math.abs(closes[i] - closes[i - 1]);
  }
  const atr = sum / period;
  const last = closes[closes.length - 1];
  return last ? (atr / last) * 100 : null;
}

export interface ComputedIndicators {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr14Pct: number | null;
  mom1M: number | null;
  mom3M: number | null;
  mom6M: number | null;
  aboveSma20: boolean;
  aboveSma50: boolean;
  aboveSma200: boolean;
  goldenCross: boolean;
}

export function computeIndicators(closes: number[]): ComputedIndicators {
  const valid = closes.filter((c) => Number.isFinite(c));
  const s20 = sma(valid, 20);
  const s50 = sma(valid, 50);
  const s200 = sma(valid, 200);
  const e20 = emaSeries(valid, 20);
  const m = macd(valid);
  const price = valid[valid.length - 1] ?? null;
  return {
    sma20: s20,
    sma50: s50,
    sma200: s200,
    ema20: e20[e20.length - 1] ?? null,
    rsi14: rsi(valid),
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    atr14Pct: closeAtrPct(valid),
    mom1M: momentum(valid, 21),
    mom3M: momentum(valid, 63),
    mom6M: momentum(valid, 126),
    aboveSma20: s20 != null && price != null ? price > s20 : false,
    aboveSma50: s50 != null && price != null ? price > s50 : false,
    aboveSma200: s200 != null && price != null ? price > s200 : false,
    goldenCross: s20 != null && s50 != null ? s20 > s50 : false,
  };
}

// ---------------------------------------------------- extended indicators
// Weekly-timeframe indicators, Bollinger Bands and price-vs-MA distances —
// computed once per EOD sync and stored as columns so the condition builder
// can filter over them in pure SQL.

export interface ExtendedIndicators {
  wRsi14: number | null;
  wMacdHist: number | null;
  bbPctB: number | null;
  bbWidthPct: number | null;
  emaCross: boolean | null;
  distSma20Pct: number | null;
  distSma50Pct: number | null;
  distSma100Pct: number | null;
  distSma200Pct: number | null;
  distEma20Pct: number | null;
  distEma50Pct: number | null;
  distEma100Pct: number | null;
  distEma200Pct: number | null;
}

/**
 * Aggregate an ascending [unixTs, close] daily series to weekly closes
 * (last close per ISO week, Monday-anchored, UTC).
 */
export function weeklyCloses(series: [number, number][]): number[] {
  const byWeek = new Map<number, number>();
  for (const [ts, close] of series) {
    const d = new Date(ts * 1000);
    const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const monday = Math.floor(ts / 86400 - day) * 86400;
    byWeek.set(monday, close); // later days overwrite — keeps the week's last close
  }
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

/** Bollinger Bands (period, 2σ population). Returns %B (0-100) and width (% of mid). */
export function bollinger(closes: number[], period = 20): { pctB: number | null; widthPct: number | null } {
  if (closes.length < period) return { pctB: null, widthPct: null };
  const win = closes.slice(-period);
  const mid = win.reduce((a, c) => a + c, 0) / period;
  const variance = win.reduce((a, c) => a + (c - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + 2 * sd;
  const lower = mid - 2 * sd;
  const price = closes[closes.length - 1];
  const span = upper - lower;
  return {
    pctB: span > 0 && price != null ? Math.max(0, Math.min(100, ((price - lower) / span) * 100)) : null,
    widthPct: mid > 0 ? (span / mid) * 100 : null,
  };
}

const distPct = (price: number | null, ma: number | null): number | null =>
  price != null && ma != null && ma > 0 ? (price / ma - 1) * 100 : null;

/** Extended indicator set — needs the timestamped series (weekly buckets) plus daily closes. */
export function computeExtendedIndicators(series: [number, number][]): ExtendedIndicators {
  const valid = series.filter(([, c]) => Number.isFinite(c));
  const closes = valid.map(([, c]) => c);
  const price = closes[closes.length - 1] ?? null;
  const weekly = weeklyCloses(valid);

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s100 = sma(closes, 100);
  const s200 = sma(closes, 200);
  const lastOf = (arr: (number | null)[]) => arr[arr.length - 1] ?? null;
  const e20 = lastOf(emaSeries(closes, 20));
  const e50 = lastOf(emaSeries(closes, 50));
  const e100 = lastOf(emaSeries(closes, 100));
  const e200 = lastOf(emaSeries(closes, 200));
  const bb = bollinger(closes, 20);
  const wMacd = weekly.length >= 36 ? macd(weekly) : { hist: null };

  return {
    wRsi14: weekly.length >= 15 ? rsi(weekly) : null,
    wMacdHist: wMacd.hist,
    bbPctB: bb.pctB,
    bbWidthPct: bb.widthPct,
    emaCross: e20 != null && e50 != null ? e20 > e50 : null,
    distSma20Pct: distPct(price, s20),
    distSma50Pct: distPct(price, s50),
    distSma100Pct: distPct(price, s100),
    distSma200Pct: distPct(price, s200),
    distEma20Pct: distPct(price, e20),
    distEma50Pct: distPct(price, e50),
    distEma100Pct: distPct(price, e100),
    distEma200Pct: distPct(price, e200),
  };
}

/** Downsample a [ts, close] series to at most `maxPoints` evenly spaced points. */
export function downsample(series: [number, number][], maxPoints = 180): [number, number][] {
  if (series.length <= maxPoints) return series;
  const step = series.length / maxPoints;
  const out: [number, number][] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(series[Math.min(Math.floor(i * step), series.length - 1)]);
  }
  const last = series[series.length - 1];
  if (out[out.length - 1][0] !== last[0]) out.push(last);
  return out;
}
