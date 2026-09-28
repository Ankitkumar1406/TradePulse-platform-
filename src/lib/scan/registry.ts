/**
 * Scan builder — item registry (Deliverable 1).
 *
 * The registry is the single source of truth for the picker, slot-filling and
 * validation. Every operand the builder can produce MUST exist here; the
 * evaluator (step 5) whitelists on this exact list, so nothing unknown ever
 * reaches evaluation.
 *
 * `data` is honest about provenance:
 *   - computed           → our engine, from stored Yahoo daily OHLCV (precomputed
 *                          in stock_metrics or vectorised from DailyBar at eval)
 *   - yahoo-price        → Yahoo index symbols (^NSEI …) resampled like stocks
 *   - yahoo-fundamentals → stock_fundamentals (Yahoo info/statements, weekly
 *                          refresh); null value ⇒ stock does not match
 */
import type { ComparatorId, Expr, FundPeriod, MathOp, Offset, OffsetUnit, Term, Timeframe } from "./expr-model";

export type { FundPeriod, Offset, OffsetUnit, Timeframe } from "./expr-model";

// ---------------------------------------------------------------- kinds & categories

/**
 * Picker item kinds. `attr` / `fn` / `flag` / `text` are real operands;
 * `group` / `number` / `bracket` / `saved` are picker pseudo-items that drive
 * SlotInput behaviour (insert a nested group, open the number pad, open a
 * bracket, or reference a saved formula) — flagged as an extension of the
 * spec's kind union because the picker itself needs to render them.
 */
export type RegistryKind = "attr" | "fn" | "flag" | "text" | "group" | "number" | "bracket" | "saved";

/** Picker order (searchable; Recent/starred pinned above all of these). */
export const CATEGORY_ORDER = [
  "measures",
  "stock-attrs",
  "price-volume",
  "moving-averages",
  "momentum",
  "trend",
  "volatility",
  "volume-ind",
  "window-pivots",
  "candlestick",
  "relative-strength",
  "fundamentals",
  "index-context",
  "saved",
  "math-fns",
] as const;
export type CategoryId = (typeof CATEGORY_ORDER)[number];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  measures: "Measures",
  "stock-attrs": "Stock attributes",
  "price-volume": "Price and volume",
  "moving-averages": "Moving averages",
  momentum: "Momentum",
  trend: "Trend",
  volatility: "Volatility",
  "volume-ind": "Volume indicators",
  "window-pivots": "Window functions and pivots",
  candlestick: "Candlestick patterns",
  "relative-strength": "Relative strength",
  fundamentals: "Fundamentals",
  "index-context": "Index context",
  saved: "Saved formulas",
  "math-fns": "Math functions",
};

export type DataSource = "computed" | "yahoo-price" | "yahoo-fundamentals";

export type Unit = "Rs" | "%" | "x" | "ratio" | "shares" | "days" | "points" | "bool" | "text" | "none";

export interface RegistryParam {
  name: string;
  type: "expr" | "number";
  /** number param → numeric default; expr param → registry id of default operand. */
  default: number | string;
  label?: string;
  int?: boolean;
  min?: number;
  max?: number;
}

export interface RegistryItem {
  id: string;
  label: string;
  category: CategoryId;
  kind: RegistryKind;
  tier: "P0" | "P1" | "P2";
  params?: RegistryParam[];
  supportsTimeframe: boolean;
  supportsOffset: boolean;
  /** Fundamentals only — allowed period options (replaces timeframe/offset). */
  periodSelector?: FundPeriod[];
  returns: "number" | "boolean" | "text";
  unit: Unit;
  data: DataSource;
  /** One-line example shown in the picker. */
  hint?: string;
}

// ---------------------------------------------------------------- comparators

export interface ComparatorDef {
  id: ComparatorId;
  label: string;
  sym: string;
  tier: "P0" | "P1";
  applies: "number" | "flag" | "text";
  /** extra inputs needed: between → upper bound; withinPct → % width. */
  extra: "none" | "right2" | "pct";
}

export const COMPARATORS: ComparatorDef[] = [
  { id: "gt", label: "Greater than", sym: ">", tier: "P0", applies: "number", extra: "none" },
  { id: "gte", label: "Greater than equal to", sym: "≥", tier: "P0", applies: "number", extra: "none" },
  { id: "lt", label: "Less than", sym: "<", tier: "P0", applies: "number", extra: "none" },
  { id: "lte", label: "Less than equal to", sym: "≤", tier: "P0", applies: "number", extra: "none" },
  { id: "eq", label: "Equal to", sym: "=", tier: "P0", applies: "number", extra: "none" },
  { id: "neq", label: "Not equal to", sym: "≠", tier: "P0", applies: "number", extra: "none" },
  { id: "crossAbove", label: "Crossed above", sym: "×↑", tier: "P0", applies: "number", extra: "none" },
  { id: "crossBelow", label: "Crossed below", sym: "×↓", tier: "P0", applies: "number", extra: "none" },
  { id: "between", label: "Between", sym: "∈", tier: "P1", applies: "number", extra: "right2" },
  { id: "withinPct", label: "Within % of", sym: "≈", tier: "P1", applies: "number", extra: "pct" },
  { id: "isTrue", label: "Is true", sym: "✓", tier: "P0", applies: "flag", extra: "none" },
  { id: "isFalse", label: "Is false", sym: "✗", tier: "P0", applies: "flag", extra: "none" },
  { id: "textEq", label: "Equals", sym: "=", tier: "P0", applies: "text", extra: "none" },
  { id: "textNeq", label: "Not equals", sym: "≠", tier: "P0", applies: "text", extra: "none" },
  { id: "contains", label: "Contains", sym: "⊃", tier: "P1", applies: "text", extra: "none" },
  { id: "inList", label: "In list", sym: "∈ list", tier: "P1", applies: "text", extra: "none" },
];

export const COMPARATOR_BY_ID: Record<ComparatorId, ComparatorDef> = Object.fromEntries(
  COMPARATORS.map((c) => [c.id, c]),
) as Record<ComparatorId, ComparatorDef>;

// ---------------------------------------------------------------- math operators

export interface MathOpDef {
  op: MathOp;
  disp: string;
  label: string;
  tier: "P0" | "P1";
}

export const MATH_OPS: MathOpDef[] = [
  { op: "+", disp: "+", label: "Plus", tier: "P0" },
  { op: "-", disp: "−", label: "Minus", tier: "P0" },
  { op: "*", disp: "×", label: "Multiplied by", tier: "P0" },
  { op: "/", disp: "÷", label: "Divided by", tier: "P0" },
  { op: "%", disp: "mod", label: "Modulo", tier: "P1" },
  { op: "^", disp: "^", label: "To the power of", tier: "P1" },
];

export const MATH_OP_BY_OP: Record<MathOp, MathOpDef> = Object.fromEntries(
  MATH_OPS.map((m) => [m.op, m]),
) as Record<MathOp, MathOpDef>;

// ---------------------------------------------------------------- registry helpers

const REG_MAP = new Map<string, RegistryItem>();
export function registerItems(items: RegistryItem[]) {
  for (const it of items) REG_MAP.set(it.id, it);
}
export function byId(id: string): RegistryItem | undefined {
  return REG_MAP.get(id);
}
export function allItems(): RegistryItem[] {
  return [...REG_MAP.values()];
}

export const FUND_PERIOD_LABELS: Record<FundPeriod, string> = {
  ttm: "TTM",
  q0: "latest Q",
  q1: "1Q ago",
  q2: "2Q ago",
  q3: "3Q ago",
  q4: "4Q ago",
  q5: "5Q ago",
  q6: "6Q ago",
  q7: "7Q ago",
  fy0: "latest FY",
  fy1: "1Y ago",
  fy2: "2Y ago",
  fy3: "3Y ago",
  fy4: "4Y ago",
};

/** Offset units valid per timeframe — the merged prefix pill only offers these. */
export const OFFSET_UNITS_BY_TF: Record<Timeframe, OffsetUnit[]> = {
  daily: ["candle", "day"],
  weekly: ["candle", "week"],
  monthly: ["candle", "month"],
};

export const TF_LABELS: Record<Timeframe, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

/**
 * Build a default operand term for a registry item:
 * attr/flag/text → attr term (daily latest); fn → fn term with every
 * parameter slot pre-filled from the param defaults (expr params become a
 * Close-attr term by default); saved → saved term.
 */
export function termFromItem(item: RegistryItem, period?: FundPeriod): Term {
  const tf: Timeframe = "daily";
  const offset: Offset = null;
  if (item.kind === "fn") {
    const args: Expr[] = (item.params ?? []).map((p) =>
      p.type === "number"
        ? [{ t: "number", value: p.default as number }]
        : [{ t: "attr", name: String(p.default), tf, offset }],
    );
    return { t: "fn", name: item.id, tf, offset, args };
  }
  if (item.kind === "saved") return { t: "saved", id: item.id, tf, offset };
  if (item.kind === "text") return { t: "attr", name: item.id, tf, offset };
  return { t: "attr", name: item.id, tf, offset, ...(period ? { period } : {}) };
}

/** Comparators valid after a given operand kind. */
export function comparatorsFor(returns: RegistryItem["returns"]): ComparatorDef[] {
  if (returns === "boolean") return COMPARATORS.filter((c) => c.applies === "flag");
  if (returns === "text") return COMPARATORS.filter((c) => c.applies === "text");
  return COMPARATORS.filter((c) => c.applies === "number");
}

/**
 * Unit compatibility — warn when comparing incompatible units (Rs vs %).
 * Number literals and unitless items never warn.
 */
const STRICT_UNITS: Unit[] = ["Rs", "%", "x", "ratio", "shares", "days", "points"];
export function unitsCompatible(a: Unit, b: Unit): boolean {
  if (a === "none" || b === "none" || a === "bool" || b === "bool" || a === "text" || b === "text") return true;
  if (!STRICT_UNITS.includes(a) || !STRICT_UNITS.includes(b)) return true;
  return a === b;
}

export function unitSuffix(unit: Unit): string {
  switch (unit) {
    case "Rs": return "₹";
    case "%": return "%";
    case "x": return "×";
    case "ratio": return "ratio";
    case "shares": return "sh";
    case "days": return "d";
    case "points": return "pts";
    default: return "";
  }
}
