/**
 * Scan builder — display layer (Deliverable 2 companion).
 *
 * Turns the stored token model into what the user sees:
 *   · merged timeframe+offset prefix   "Weekly · 2 candles ago"
 *   · readable numbers                 30000000 → "3 Cr"
 *   · plain-English sentence preview   "Daily Close is greater than Daily Sma(Daily Volume, 20) × 0.75"
 */
import type { Expr, FundPeriod, Offset, Term, Timeframe } from "./expr-model";
import { isOp } from "./expr-model";
import {
  byId,
  COMPARATOR_BY_ID,
  FUND_PERIOD_LABELS,
  MATH_OP_BY_OP,
  TF_LABELS,
  type Unit,
} from "./registry";

// ---------------------------------------------------------------- numbers

/** Indian-style readable number: 30000000 → "3 Cr", 5000000 → "50 L", 1500 → "1.5 K". */
export function fmtReadable(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const abs = Math.abs(n);
  const trim = (v: number, d: number) => {
    const s = v.toFixed(d);
    return s.replace(/\.?0+$/, "");
  };
  if (abs >= 1e7) return `${trim(n / 1e7, 2)} Cr`;
  if (abs >= 1e5) return `${trim(n / 1e5, 2)} L`;
  if (abs >= 1e3) return `${trim(n / 1e3, 1)} K`;
  if (Number.isInteger(n)) return String(n);
  return trim(n, 4);
}

/** A number chip keeps its typed form visible (3cr stays "3 Cr"). */
export function fmtNumberTerm(n: number, unit: Unit): string {
  const base = fmtReadable(n);
  if (unit === "%") return `${base}%`;
  if (unit === "Rs") return `₹${base}`;
  if (unit === "x") return `${base}×`;
  return base;
}

// ---------------------------------------------------------------- timeframe & offset

export function offsetLabel(off: Offset): string {
  if (!off) return "Latest";
  const unitWord =
    off.unit === "candle"
      ? off.n === 1 ? "candle" : "candles"
      : off.unit === "day"
        ? off.n === 1 ? "day" : "days"
        : off.unit === "week"
          ? off.n === 1 ? "week" : "weeks"
          : off.n === 1 ? "month" : "months";
  return `${off.n} ${unitWord} ago`;
}

/** Merged prefix pill — one chip, both facts, muted by design. */
export function tfOffsetLabel(tf: Timeframe, off: Offset): string {
  return `${TF_LABELS[tf]} · ${offsetLabel(off)}`;
}

export function periodLabel(p: FundPeriod): string {
  return FUND_PERIOD_LABELS[p] ?? p;
}

// ---------------------------------------------------------------- sentence rendering

/** "Daily Close" / "Weekly · 2 candles ago Sma(Daily Volume, 20)" / "3 Cr". */
export function termLabel(term: Term, opts: { prefixes?: boolean } = {}): string {
  const prefixes = opts.prefixes !== false;
  switch (term.t) {
    case "number":
      return fmtReadable(term.value);
    case "text":
      return `“${term.value}”`;
    case "attr": {
      const item = byId(term.name);
      const label = item?.label ?? term.name;
      const pre = prefixes && item?.supportsTimeframe ? `${tfOffsetLabel(term.tf, term.offset)} ` : "";
      const per = term.period && item?.periodSelector ? ` (${periodLabel(term.period)})` : "";
      return `${pre}${label}${per}`;
    }
    case "fn": {
      const item = byId(term.name);
      const label = item?.label ?? term.name;
      const args = term.args.map((a) => exprSentence(a, opts)).join(", ");
      const pre = prefixes && item?.supportsTimeframe ? `${tfOffsetLabel(term.tf, term.offset)} ` : "";
      return `${pre}${label}(${args})`;
    }
    case "bracket":
      return `( ${exprSentence(term.inner, opts)} )`;
    case "saved": {
      const item = byId(`saved:${term.id}`);
      const pre = prefixes ? `${tfOffsetLabel(term.tf, term.offset)} ` : "";
      return `${pre}${item?.label ?? term.id}`;
    }
  }
}

/** Flat expr → readable sentence with display operators (× ÷ −). */
export function exprSentence(expr: Expr, opts: { prefixes?: boolean } = {}): string {
  return expr
    .map((x) => (isOp(x) ? MATH_OP_BY_OP[x.op].disp : termLabel(x, opts)))
    .join(" ");
}

export function comparatorLabel(cmp: string): string {
  const def = COMPARATOR_BY_ID[cmp as keyof typeof COMPARATOR_BY_ID];
  return def ? def.label : cmp;
}

/** Full clause sentence: "Daily Close is greater than 1 day ago Daily Max(7, Daily High)". */
export function clauseSentence(
  clause: { left: Expr; cmp: string; right: Expr; right2?: Expr | null; pct?: number | null },
): string {
  const def = COMPARATOR_BY_ID[clause.cmp as keyof typeof COMPARATOR_BY_ID];
  const L = exprSentence(clause.left);
  const R = exprSentence(clause.right);
  if (clause.cmp === "between" && clause.right2) return `${L} is between ${R} and ${exprSentence(clause.right2)}`;
  if (clause.cmp === "withinPct") return `${L} is within ${clause.pct ?? "?"}% of ${R}`;
  if (def?.applies === "flag") return `${L} ${def.label.toLowerCase()}`;
  if (def?.applies === "text") return `${L} ${def.label.toLowerCase()} ${R}`;
  return `${L} ${def?.label.toLowerCase() ?? clause.cmp} ${R}`;
}

/** Term kind for chip styling: muted prefix / bold name / dark number. */
export function termVisual(term: Term): { kind: "number" | "text" | "name" | "op"; unit?: Unit } {
  if (term.t === "number") return { kind: "number" };
  if (term.t === "text") return { kind: "text" };
  const item = term.t === "attr" ? byId(term.name) : term.t === "fn" ? byId(term.name) : term.t === "saved" ? byId(`saved:${term.id}`) : undefined;
  return { kind: "name", unit: item?.unit };
}
