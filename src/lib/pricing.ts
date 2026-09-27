// Single source of truth for TradePulse plans & pricing.
// Shared by the landing page, the upgrade dialog and the payments API —
// never trust a client-sent amount: the server prices every order here.
//
// Billing model: Pro is a RECURRING SUBSCRIPTION, not a one-off top-up.
// Every cycle auto-renews through an autopay mandate (UPI Autopay for UPI,
// e-mandate for cards) collected via Cashfree; the user can cancel anytime
// and keeps access until the end of the paid period.
//
// Commitment ladder (per-month falls as commitment grows):
//   Monthly ₹499 · 3 Months ₹400/mo · 6 Months ₹333/mo · Annual ₹250/mo.

export const TRIAL_DAYS = 15;

export type Cycle = "monthly" | "quarterly" | "halfyearly" | "annual";

export interface CycleOption {
  id: Cycle;
  label: string;
  note?: string;
}

export const CYCLES: CycleOption[] = [
  { id: "monthly", label: "Monthly", note: "Save 50%" },
  { id: "quarterly", label: "3 Months", note: "Save 60%" },
  { id: "halfyearly", label: "6 Months", note: "Save 67%" },
  { id: "annual", label: "Annual", note: "Save 75%" },
];

export interface ProPlan {
  price: number; // INR charged per cycle
  was: number; // list price for the cycle (pre-introductory-offer)
  per: string; // billing period label, e.g. "month"
  months: number; // plan validity granted per renewal
  billed: string;
  effective: string;
  savePct: number;
}

// Introductory launch pricing (list price: ₹999/month).
// Effective per-month: ₹499 monthly · ₹400 quarterly · ₹333 6-monthly · ₹250 annually.
export const PRO_PLANS: Record<Cycle, ProPlan> = {
  monthly: {
    price: 499, was: 999, per: "month", months: 1,
    billed: "Auto-renews monthly · cancel anytime",
    effective: "₹499 per month", savePct: 50,
  },
  quarterly: {
    price: 1199, was: 2997, per: "3 months", months: 3,
    billed: "Auto-debited every 3 months · cancel anytime",
    effective: "₹400 per month", savePct: 60,
  },
  halfyearly: {
    price: 1999, was: 5994, per: "6 months", months: 6,
    billed: "Auto-debited every 6 months · cancel anytime",
    effective: "₹333 per month", savePct: 67,
  },
  annual: {
    price: 2999, was: 11988, per: "year", months: 12,
    billed: "Auto-debited yearly · cancel anytime",
    effective: "₹250 per month", savePct: 75,
  },
};

export const TOTAL_SCANS = 39;
export const TOTAL_CATEGORIES = 8;
export const BASIC_SCANS = 9;

export const BASIC_FEATURES = [
  "Market breadth dashboard — advances, declines & 52-week stats",
  "9 basic scanners — gaps, breakouts, 52-week highs, volume spikes & more",
  "List view with universal RS rating — sort results by RS, change %, market cap or 1M/3M/6M performance",
  "Full scan results — every matching stock returned, never a truncated top-N list",
  "End-of-day market data",
  "1 watchlist (up to 10 stocks) & 3 price alerts",
  "Email support",
];

export const PRO_FEATURES = [
  `All ${TOTAL_SCANS} scanners across ${TOTAL_CATEGORIES} categories — incl. all 7 Trader Choice templates`,
  "MarketSmith-style ratings on every result — universal RS rating, EPS score, EPS change % & Accumulation/Distribution rating",
  "Charts view for any scan — timeframe, EMA length, base overlay & RS-strength filters",
  "Base overlay with base-formation duration on every chart",
  "Sector rotation quadrant & sector strength (RS vs RS momentum)",
  "Sector momentum — daily / weekly / monthly RSI per index",
  "Advanced screener — Chartink-style visual builder, up to 50 rows with AND/OR groups: daily & weekly series, RSI/MACD, SMA/EMA at any length, Bollinger Bands, bars-ago offsets, crosses, momentum, volume & valuation",
  "Multi-scan confluence — run up to 8 scans together · saved screens & CSV export",
  "Unlimited watchlists & smart price alerts",
  "Trading journal & market calendar",
  "Priority support",
];

// ---------------------------------------------------------------- feature matrix
// The same Basic-vs-Pro split the pricing cards show, spelled out row by row.

export type PlanValue = boolean | string;

export interface FeatureMatrixGroup {
  group: string;
  rows: { feature: string; basic: PlanValue; pro: PlanValue }[];
}

export const FEATURE_MATRIX: FeatureMatrixGroup[] = [
  {
    group: "Scanners & screener",
    rows: [
      { feature: "One-click scanners", basic: `${BASIC_SCANS} basic scans`, pro: `All ${TOTAL_SCANS} scans · ${TOTAL_CATEGORIES} categories` },
      { feature: "Trader Choice scans — 7 multi-condition trader templates (momentum breakout, price action, RS breakout, volume trend, low-base, 6-signal confluence, fundamental-momentum stack)", basic: false, pro: true },
      { feature: "Multi-timeframe RSI scans (TradePulse extra)", basic: false, pro: true },
      { feature: "Scan result view", basic: "List", pro: "List + Charts grid" },
      { feature: "Universal RS rating on every result", basic: true, pro: true },
      { feature: "Sortable scan output — RS, change %, market cap, 1M/3M/6M return (list + charts)", basic: true, pro: true },
      { feature: "Full scan output — every matching stock returned, no top-N result caps", basic: true, pro: true },
      { feature: "Add to watchlist from any result table or chart tile", basic: true, pro: true },
      { feature: "Screener — search, sector & sort across all 3,500+ NSE stocks", basic: false, pro: true },
      { feature: "Condition builder — Chartink-style visual logic, up to 50 rows with AND/OR groups: daily & weekly series, RSI & MACD, SMA/EMA at any length, Bollinger Bands, bars-ago offsets, crosses & percent windows, momentum, volume, valuation", basic: false, pro: true },
      { feature: "Multi-scan confluence — run up to 8 scans together with a min-match threshold", basic: false, pro: true },
      { feature: "Saved screens & CSV export", basic: false, pro: true },
    ],
  },
  {
    group: "Charts & overlays",
    rows: [
      { feature: "Technical chart (MA/VOL/MACD/RSI panes, D/W/M, zoom & pan)", basic: true, pro: true },
      { feature: "Global stock search — jump to any NSE symbol straight from the header", basic: true, pro: true },
      { feature: "Chart filters — timeframe, EMA length, base overlay, RS strength", basic: false, pro: true },
      { feature: "Base overlay with base-formation duration", basic: false, pro: true },
      { feature: "Crosshair OHLCV readout", basic: true, pro: true },
    ],
  },
  {
    group: "Market analytics",
    rows: [
      { feature: "Market breadth dashboard", basic: true, pro: true },
      { feature: "Sector rotation — RS × momentum quadrant map", basic: false, pro: true },
      { feature: "Sector strength — strongest now & fastest changing", basic: false, pro: true },
      { feature: "Sector momentum — daily/weekly/monthly RSI per index", basic: false, pro: true },
    ],
  },
  {
    group: "Tools & support",
    rows: [
      { feature: "Watchlists — star stocks from any scan or screener result", basic: "1 · up to 10 stocks", pro: "Unlimited" },
      { feature: "Price alerts", basic: "3", pro: "Unlimited" },
      { feature: "Trading journal with P&L / R stats", basic: false, pro: true },
      { feature: "Market calendar (holidays, expiries, results)", basic: true, pro: true },
      { feature: "Support", basic: "Email", pro: "Priority" },
    ],
  },
];

export function isCycle(value: unknown): value is Cycle {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRO_PLANS, value);
}

export function formatINR(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}
