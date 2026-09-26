/**
 * Client-safe sector momentum taxonomy: classification rules + display
 * metadata. Shared by the API (src/lib/sector-momentum.ts) and the UI.
 * (Keep this file free of server-only imports.)
 */

export const BULL_RSI = 60;
export const BEAR_RSI = 40;

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

export interface MomentumRow {
  name: string;
  kind: "index" | "sector";
  symbol: string | null; // Yahoo symbol (index rows)
  price: number | null;
  changePct: number | null;
  dailyRSI: number | null;
  weeklyRSI: number | null;
  monthlyRSI: number | null;
  classification: MomentumClass | null;
  constituents?: number; // sector rows
  topNames?: string[]; // sector rows — sample of largest constituents
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
    label: "High strength",
    short: "High",
    description: "Daily, weekly & monthly RSI all above 60 — momentum aligned on every timeframe.",
    badge: "bg-profit/15 text-profit border border-profit/30",
    rank: 1,
  },
  long: {
    label: "Long-term strength",
    short: "Long-term",
    description: "Monthly & weekly above 60, daily below — established uptrend taking a near-term breather.",
    badge: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
    rank: 2,
  },
  medium: {
    label: "Medium-term strength",
    short: "Medium",
    description: "Weekly above 60 while monthly is still below — intermediate trend building; watch monthly follow-through.",
    badge: "bg-teal-500/10 text-teal-300 border border-teal-500/30",
    rank: 3,
  },
  short: {
    label: "Short-term strength",
    short: "Short-term",
    description: "Only the daily RSI is above 60 — fresh bounce that higher timeframes have not confirmed yet.",
    badge: "bg-gold/12 text-gold-text border border-gold/30",
    rank: 4,
  },
  mixed: {
    label: "Neutral / mixed",
    short: "Neutral",
    description: "RSI reading is mixed across timeframes — no dominant trend signal either way.",
    badge: "bg-zinc-800/80 text-zinc-300 border border-zinc-700",
    rank: 5,
  },
  shortWeak: {
    label: "Short-term weakness",
    short: "Short-weak",
    description: "Only the daily RSI is below 40 — pullback within an otherwise intact structure.",
    badge: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
    rank: 6,
  },
  mediumWeak: {
    label: "Medium-term weakness",
    short: "Medium-weak",
    description: "Weekly below 40 while monthly holds above — intermediate trend breaking down; protect gains.",
    badge: "bg-orange-500/10 text-orange-300 border border-orange-500/30",
    rank: 7,
  },
  longWeak: {
    label: "Long-term weakness",
    short: "Long-weak",
    description: "Monthly & weekly below 40, daily above — deep downtrend with only a near-term bounce.",
    badge: "bg-red-500/10 text-red-300 border border-red-500/30",
    rank: 8,
  },
  weakAll: {
    label: "Weakness — all timeframes",
    short: "Weak",
    description: "Daily, weekly & monthly all below 40 — broad distribution, trend fully down.",
    badge: "bg-loss/15 text-loss border border-loss/30",
    rank: 9,
  },
};

/** Classify a (daily, weekly, monthly) RSI triple. Precedence: bull first. */
export function classifyMomentum(d: number, w: number, m: number): MomentumClass {
  if (d > BULL_RSI && w > BULL_RSI && m > BULL_RSI) return "high";
  if (m > BULL_RSI && w > BULL_RSI) return "long";
  if (w > BULL_RSI && m <= BULL_RSI && d >= BEAR_RSI) return "medium";
  if (d > BULL_RSI && w <= BULL_RSI && m <= BULL_RSI) return "short";
  if (d < BEAR_RSI && w < BEAR_RSI && m < BEAR_RSI) return "weakAll";
  if (m < BEAR_RSI && w < BEAR_RSI) return "longWeak";
  if (w < BEAR_RSI && m >= BEAR_RSI && d <= BULL_RSI) return "mediumWeak";
  if (d < BEAR_RSI && w >= BEAR_RSI && m >= BEAR_RSI) return "shortWeak";
  return "mixed";
}

/** Sort helper — strongest class first, then by monthly RSI descending. */
export function momentumSort(a: { classification: string | null; monthlyRSI: number | null }, b: { classification: string | null; monthlyRSI: number | null }): number {
  const ra = MOMENTUM_CLASSES[(a.classification ?? "mixed") as MomentumClass]?.rank ?? 5;
  const rb = MOMENTUM_CLASSES[(b.classification ?? "mixed") as MomentumClass]?.rank ?? 5;
  if (ra !== rb) return ra - rb;
  return (b.monthlyRSI ?? 0) - (a.monthlyRSI ?? 0);
}
