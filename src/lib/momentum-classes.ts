/**
 * Client-safe sector momentum taxonomy: classification rules + display
 * metadata. Shared by the API (src/lib/sector-momentum.ts) and the UI.
 * (Keep this file free of server-only imports.)
 */

export const BULL_RSI = 60;
export const BEAR_RSI = 40;

/**
 * The published rule — shown verbatim in the "How to read this" panel:
 * every RSI-14 reading is tagged per timeframe (>= 60 strong, <= 40 weak,
 * otherwise neutral) and the classification follows the precedence table
 * in classifyMomentum() exactly.
 */
export function rsiTag(v: number): "strong" | "weak" | "neutral" {
  if (v >= BULL_RSI) return "strong";
  if (v <= BEAR_RSI) return "weak";
  return "neutral";
}

export type MomentumClass =
  | "high"
  | "long"
  | "medium"
  | "short"
  | "weakAll"
  | "longWeak"
  | "mediumWeak"
  | "shortWeak"
  | "mixed";

export type MomentumSource = "live" | "composite" | "median";

export interface MoverTicker {
  symbol: string;
  change1D: number | null;
}

export interface SampleTicker {
  symbol: string;
  change1D: number | null;
  dailyRSI: number | null;
}

export interface MomentumRow {
  name: string;
  kind: "index" | "sector";
  /** Stable id for expand/sort — Yahoo symbol or sector name. */
  key: string;
  /** live = provider index history · composite = cap-weighted basket of major constituents · median = sector median RSI */
  source: MomentumSource;
  symbol: string | null;
  price: number | null;
  change1D: number | null;
  change5D: number | null;
  dailyRSI: number | null;
  weeklyRSI: number | null;
  monthlyRSI: number | null;
  /** RSI change vs 5 sessions back (daily) / last completed week / last completed month. */
  dDelta: number | null;
  wDelta: number | null;
  mDelta: number | null;
  classification: MomentumClass | null;
  /** 1 = strongest composite reading within its table. */
  rank?: number;
  constituents?: number;
  /** % of constituents above their 50-DMA (sectors & composite baskets). */
  breadthAbove50?: number | null;
  /** Strongest / weakest constituents today (sectors & composite baskets). */
  movers?: { up: MoverTicker[]; down: MoverTicker[] };
  /** Largest constituents with today's change + daily RSI (expandable rows). */
  sample?: SampleTicker[];
  /** Raw DB sector value (sector rows) — used to prefill the screener filter. */
  sectorValue?: string;
}

export interface MomentumClassMeta {
  label: string;
  short: string;
  description: string;
  badge: string; // badge classes (dark theme)
  rank: number; // sort order, strongest first
}

export const MOMENTUM_CLASSES: Record<MomentumClass, MomentumClassMeta> = {
  high: {
    label: "Strong · all TFs",
    short: "Strong · All",
    description: "Daily, weekly & monthly RSI all ≥ 60 — momentum aligned on every timeframe.",
    badge: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/40",
    rank: 1,
  },
  long: {
    label: "Strong · long",
    short: "Strong · Long",
    description: "Monthly & weekly ≥ 60, daily < 60 — established uptrend taking a near-term breather.",
    badge: "bg-emerald-500/12 text-emerald-200 border border-emerald-400/35",
    rank: 2,
  },
  medium: {
    label: "Strong · medium",
    short: "Strong · Med",
    description: "Weekly ≥ 60 while monthly < 60 — intermediate trend building; watch monthly follow-through.",
    badge: "bg-teal-500/12 text-teal-200 border border-teal-400/35",
    rank: 3,
  },
  short: {
    label: "Strong · short",
    short: "Strong · Short",
    description: "Only the daily RSI ≥ 60 — fresh bounce the higher timeframes have not confirmed yet.",
    badge: "bg-amber-500/12 text-amber-200 border border-amber-400/35",
    rank: 4,
  },
  mixed: {
    label: "Neutral / mixed",
    short: "Neutral",
    description: "RSI readings sit between 40 and 60 on the deciding timeframes — no dominant trend signal.",
    badge: "bg-zinc-800/80 text-zinc-200 border border-zinc-600",
    rank: 5,
  },
  shortWeak: {
    label: "Weak · short",
    short: "Weak · Short",
    description: "Only the daily RSI ≤ 40 — pullback within an otherwise intact structure.",
    badge: "bg-orange-500/12 text-orange-200 border border-orange-400/35",
    rank: 6,
  },
  mediumWeak: {
    label: "Weak · medium",
    short: "Weak · Med",
    description: "Weekly ≤ 40 while monthly > 40 — intermediate trend breaking down; protect gains.",
    badge: "bg-orange-600/15 text-orange-200 border border-orange-500/40",
    rank: 7,
  },
  longWeak: {
    label: "Weak · long",
    short: "Weak · Long",
    description: "Monthly & weekly ≤ 40, daily > 40 — deep downtrend with only a near-term bounce.",
    badge: "bg-red-500/12 text-red-200 border border-red-400/35",
    rank: 8,
  },
  weakAll: {
    label: "Weak · all TFs",
    short: "Weak · All",
    description: "Daily, weekly & monthly all ≤ 40 — broad distribution, trend fully down.",
    badge: "bg-red-500/15 text-red-200 border border-red-400/40",
    rank: 9,
  },
};

/**
 * Classify a (daily, weekly, monthly) RSI triple — follows the published
 * rule EXACTLY (see "How to read this"): a timeframe is STRONG when RSI ≥ 60,
 * WEAK when RSI ≤ 40, neutral in between. Precedence: bull first.
 */
export function classifyMomentum(d: number, w: number, m: number): MomentumClass {
  const dS = d >= BULL_RSI, wS = w >= BULL_RSI, mS = m >= BULL_RSI;
  const dW = d <= BEAR_RSI, wW = w <= BEAR_RSI, mW = m <= BEAR_RSI;
  if (dS && wS && mS) return "high";
  if (wS && mS) return "long";
  if (wS && !mS && !dW) return "medium";
  if (dS && !wS && !mS) return "short";
  if (dW && wW && mW) return "weakAll";
  if (mW && wW) return "longWeak";
  if (wW && !mW && !dS) return "mediumWeak";
  if (dW && !wW && !mW) return "shortWeak";
  return "mixed";
}

/** Composite strength = mean of the available timeframe RSIs (desc). */
export function compositeStrength(r: {
  dailyRSI: number | null;
  weeklyRSI: number | null;
  monthlyRSI: number | null;
}): number {
  const vals = [r.dailyRSI, r.weeklyRSI, r.monthlyRSI].filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : -1;
}

/** Sort helper — strongest class first, then by composite strength descending. */
export function momentumSort(a: { classification: string | null; dailyRSI: number | null; weeklyRSI: number | null; monthlyRSI: number | null }, b: { classification: string | null; dailyRSI: number | null; weeklyRSI: number | null; monthlyRSI: number | null }): number {
  const ra = MOMENTUM_CLASSES[(a.classification ?? "mixed") as MomentumClass]?.rank ?? 5;
  const rb = MOMENTUM_CLASSES[(b.classification ?? "mixed") as MomentumClass]?.rank ?? 5;
  if (ra !== rb) return ra - rb;
  return compositeStrength(b) - compositeStrength(a);
}
