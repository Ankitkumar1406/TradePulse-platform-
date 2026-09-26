/**
 * Base detection — finds the sideways consolidation ("base") a stock is
 * currently trading in, drawn from the recent daily bars. Pure function,
 * safe on client and server.
 *
 * Definition (deterministic, explainable):
 *  - A base STARTS at the most recent confirmed pivot high whose level price
 *    has not decisively broken above since (close never > level + 3%).
 *  - The base CEILING is that pivot level; the FLOOR is the lowest low since
 *    it formed. A healthy base is no more than 35% deep.
 *  - The base must span at least 8 sessions to count.
 *  - If price has already closed above the ceiling, the most recent base is
 *    reported with status "breakout" (duration = how long it took).
 */

export interface BaseRange {
  /** Index of the pivot-high bar that opens the base (0-based over `bars`). */
  startIdx: number;
  /** ISO date of the pivot-high bar. */
  startDate: string;
  /** ISO date of the latest bar inside the base. */
  endDate: string;
  /** Base ceiling (pivot high). */
  high: number;
  /** Base floor (lowest low since the pivot). */
  low: number;
  /** Sessions from the pivot high through the latest bar. */
  days: number;
  /** (high - low) / high, in percent. */
  depthPct: number;
  /** "in-base" = still range-bound · "breakout" = cleared the ceiling. */
  status: "in-base" | "breakout";
}

export interface BaseBarLike {
  date: string;
  high: number;
  low: number;
  close: number;
}

const PIVOT_HALF = 5; // bars either side of a pivot high
const MAX_DEPTH_PCT = 35;
const MIN_DAYS = 8;
const BREAK_TOLERANCE = 1.03; // close 3% over the pivot level ends the base

export function detectBase(bars: BaseBarLike[]): BaseRange | null {
  const n = bars.length;
  if (n < MIN_DAYS + PIVOT_HALF + 2) return null;

  const scanFrom = Math.max(PIVOT_HALF, n - 130);
  // candidate pivot highs, most recent first
  for (let t = n - 1 - PIVOT_HALF; t >= scanFrom; t--) {
    const level = bars[t].high;
    let isPivot = true;
    for (let k = t - PIVOT_HALF; k <= t + PIVOT_HALF && isPivot; k++) {
      if (k < 0 || k >= n || k === t) continue;
      if (bars[k].high > level) isPivot = false;
    }
    if (!isPivot) continue;

    // level must not have been decisively broken since the pivot
    let broke = false;
    for (let k = t + 1; k < n; k++) {
      if (bars[k].close > level * BREAK_TOLERANCE) { broke = true; break; }
    }

    if (broke) continue; // this pivot was already cleared — look for an earlier one

    let floor = Infinity;
    for (let k = t + 1; k < n; k++) if (bars[k].low < floor) floor = bars[k].low;
    if (!Number.isFinite(floor) || floor >= level) continue;

    const days = n - 1 - t;
    if (days < MIN_DAYS) continue;

    const depthPct = ((level - floor) / level) * 100;
    if (depthPct > MAX_DEPTH_PCT) continue;

    const lastClose = bars[n - 1].close;
    return {
      startIdx: t,
      startDate: bars[t].date,
      endDate: bars[n - 1].date,
      high: level,
      low: floor,
      days,
      depthPct: Number(depthPct.toFixed(1)),
      status: lastClose > level ? "breakout" : "in-base",
    };
  }

  // fall back: the most recent pivot whose base has since broken out upward —
  // still useful ("breakout came after an N-session base")
  for (let t = n - 1 - PIVOT_HALF; t >= scanFrom; t--) {
    const level = bars[t].high;
    let isPivot = true;
    for (let k = t - PIVOT_HALF; k <= t + PIVOT_HALF && isPivot; k++) {
      if (k < 0 || k >= n || k === t) continue;
      if (bars[k].high > level) isPivot = false;
    }
    if (!isPivot) continue;

    let floor = Infinity;
    let brokeIdx = -1;
    for (let k = t + 1; k < n; k++) {
      if (bars[k].low < floor) floor = bars[k].low;
      if (bars[k].close > level * BREAK_TOLERANCE && brokeIdx < 0) brokeIdx = k;
    }
    if (brokeIdx < 0 || !Number.isFinite(floor) || floor >= level) continue;

    const days = brokeIdx - t;
    if (days < MIN_DAYS) continue;

    const depthPct = ((level - floor) / level) * 100;
    if (depthPct > MAX_DEPTH_PCT) continue;

    return {
      startIdx: t,
      startDate: bars[t].date,
      endDate: bars[brokeIdx].date,
      high: level,
      low: floor,
      days,
      depthPct: Number(depthPct.toFixed(1)),
      status: "breakout",
    };
  }

  return null;
}
