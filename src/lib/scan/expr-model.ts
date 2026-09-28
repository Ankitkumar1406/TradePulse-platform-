/**
 * Scan builder — core data model (Deliverable 1, step 0).
 *
 * Every clause is `LEFT <comparator> RIGHT`; LEFT and RIGHT are Expr — flat
 * token arrays of operands and math operators. Operands nest recursively:
 * functions hold one Expr per parameter slot, brackets hold one inner Expr.
 * Standard precedence (+ − before × ÷ % before ^) is applied at evaluation
 * time (step 5), never at build time, so the token order the user typed is
 * exactly the token order we store and render.
 */

// ---------------------------------------------------------------- time & period

export type Timeframe = "daily" | "weekly" | "monthly";

/** N candles/days/weeks/months back. `null` = latest. */
export type OffsetUnit = "day" | "week" | "candle" | "month";
export type Offset = { n: number; unit: OffsetUnit } | null;

/**
 * Fundamental period selector — replaces timeframe/offset for fundamentals.
 * ttm = trailing twelve months; q0..q7 = latest quarter, 1..7 quarters ago;
 * fy0..fy4 = latest financial year, 1..4 years ago.
 */
export type FundPeriod = "ttm" | "q0" | "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7" | "fy0" | "fy1" | "fy2" | "fy3" | "fy4";

// ---------------------------------------------------------------- expressions

export type MathOp = "+" | "-" | "*" | "/" | "%" | "^";

export interface OpTerm {
  t: "op";
  op: MathOp;
}

export type Term =
  | { t: "number"; value: number }
  /** Literal on the right side of a text comparator (Sector equals "FMCG"). */
  | { t: "text"; value: string }
  /** A registry attribute — raw field or parameterless computed metric/flag. */
  | { t: "attr"; name: string; tf: Timeframe; offset: Offset; period?: FundPeriod }
  /** A registry function — one Expr per parameter slot (recursive). */
  | { t: "fn"; name: string; tf: Timeframe; offset: Offset; args: Expr[] }
  /** Explicit grouping; evaluation applies standard precedence anyway. */
  | { t: "bracket"; inner: Expr }
  /** A user-saved formula chain, addressed by id. */
  | { t: "saved"; id: string; tf: Timeframe; offset: Offset };

export type Expr = (Term | OpTerm)[];

// ---------------------------------------------------------------- clauses & groups

export type ComparatorId =
  | "gt" | "gte" | "lt" | "lte" | "eq" | "neq"
  | "crossAbove" | "crossBelow"
  | "between" | "withinPct"
  | "isTrue" | "isFalse"
  | "textEq" | "textNeq" | "contains" | "inList";

export interface Clause {
  id: string;
  kind: "clause";
  left: Expr;
  cmp: ComparatorId;
  right: Expr;
  /** `between` upper bound. */
  right2?: Expr;
  /** `withinPct` width in percent (e.g. 2 → within 2% of). */
  pct?: number;
  enabled: boolean;
  comment?: string;
}

export interface Group {
  id: string;
  kind: "group";
  mode: "all" | "any" | "none";
  /** required true-count when mode = "any" */
  anyCount?: number;
  enabled: boolean;
  collapsed?: boolean;
  comment?: string;
  children: (Clause | Group)[];
}

export interface Scan {
  segment: "cash";
  root: Group;
}

// ---------------------------------------------------------------- small utils

let seq = 0;
export function uid(prefix = "n"): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function isOp(x: Term | OpTerm | null | undefined): x is OpTerm {
  return !!x && x.t === "op";
}

export function isTerm(x: Term | OpTerm | null | undefined): x is Term {
  return !!x && x.t !== "op";
}

export function newClause(): Clause {
  return { id: uid("c"), kind: "clause", left: [], cmp: "gt", right: [], enabled: true };
}

export function newGroup(mode: Group["mode"] = "all", children: (Clause | Group)[] = []): Group {
  return { id: uid("g"), kind: "group", mode, enabled: true, children };
}

/** Last operand (non-op) token of an expr, or null. */
export function lastOperand(expr: Expr): Term | null {
  for (let i = expr.length - 1; i >= 0; i--) {
    const x = expr[i];
    if (isTerm(x)) return x;
  }
  return null;
}

/** True when the expr is complete enough to compare: non-empty, ends with an operand. */
export function exprComplete(expr: Expr): boolean {
  return expr.length > 0 && isTerm(expr[expr.length - 1]);
}
