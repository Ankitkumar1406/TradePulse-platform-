/**
 * Scan builder — legacy / v2 saved-screen → Scan conversion (best effort).
 *
 * Saved views from the previous builder (field rows and ƒx expression rows)
 * are mapped onto the new registry. Anything that has no equivalent (pattern
 * rows, unknown fields) is dropped and reported, so the user sees exactly
 * what carried over.
 */
import type { Clause, Expr, Group, Scan, Term as NewTerm } from "./expr-model";
import { newGroup, uid } from "./expr-model";
import { parseProExpr, type ExprNode, type SeriesField } from "@/lib/pro-expr";
import { parseScanText } from "./serialize";

export interface ConvertResult {
  scan: Scan;
  notes: string[]; // human-readable "dropped X" lines
}

// ---------------------------------------------------------------- old→new operand maps

const FIELD_MAP: Record<string, string> = {
  open: "open", high: "high", low: "low", close: "close", volume: "volume",
  price: "close", dayHigh: "high", dayLow: "low", prevClose: "prevClose",
  changePct: "changePct", marketCap: "mcap", peTTM: "pe", pbRatio: "pb", divYield: "divYield",
  fromHighPct: "fromHighPct", fromLowPct: "fromLowPct", rsRating: "rsRating",
  wOpen: "open", wHigh: "high", wLow: "low", wClose: "close",
};

const SCALAR_FN_MAP: Record<string, { id: string; tf?: "weekly" }> = {
  rsi14: { id: "rsi" },
  wRsi14: { id: "rsi", tf: "weekly" },
  macdHist: { id: "macdHist" },
  wMacdHist: { id: "macdHist", tf: "weekly" },
  bbPctB: { id: "bbPctB" },
  bbWidthPct: { id: "bbBandwidth" },
  atr14Pct: { id: "natr" },
  mom1M: { id: "ret1M" },
  mom3M: { id: "ret3M" },
  mom6M: { id: "ret6M" },
  epsQuarterlyGrowth: { id: "epsGrowthYoY" },
};

const attrT = (name: string, tf: "daily" | "weekly" = "daily"): NewTerm => ({ t: "attr", name, tf, offset: null });
const numT = (v: number): NewTerm => ({ t: "number", value: v });
const op = (o: "+" | "-" | "*" | "/" | "%" | "^") => ({ t: "op" as const, op: o });

function pctChangeOf(src: Expr, n: number): Expr {
  // winPctChange(n, src) — % change vs n bars ago
  return [{ t: "fn", name: "winPctChange", tf: "daily", offset: null, args: [[numT(n)], src] }];
}

// ---------------------------------------------------------------- expr-node conversion

function nodeToExpr(node: ExprNode, notes: string[], tfHint: "daily" | "weekly" = "daily"): Expr | null {
  switch (node.k) {
    case "num":
      return [numT(node.v)];
    case "neg": {
      const a = nodeToExpr(node.a, notes, tfHint);
      return a ? [numT(0), op("-"), ...a] : null;
    }
    case "bin": {
      const a = nodeToExpr(node.a, notes, tfHint);
      const b = nodeToExpr(node.b, notes, tfHint);
      if (!a || !b) return null;
      return [...a, op(node.op as "+" | "-" | "*" | "/"), ...b];
    }
    case "abs": {
      const a = nodeToExpr(node.a, notes, tfHint);
      if (!a) return null;
      return [{ t: "fn", name: "abs", tf: tfHint, offset: null, args: [a] }];
    }
    case "ser": {
      const name = FIELD_MAP[node.f];
      if (!name) { notes.push(`Series ${node.f} has no equivalent`); return null; }
      const tf = node.s === "w" ? "weekly" : "daily";
      const term: NewTerm = { t: "attr", name, tf, offset: node.shift > 0 ? { n: node.shift, unit: "candle" } : null };
      return [term];
    }
    case "win": {
      const inner = nodeToExpr({ k: "ser", s: node.ser.s, f: node.ser.f, shift: node.ser.shift }, notes, tfHint);
      if (!inner) return null;
      const id = node.fn === "sma" ? "sma" : node.fn === "min" ? "winMin" : "winMax";
      const args: Expr[] = id === "sma"
        ? [inner, [numT(node.n)]]
        : [[numT(node.n)], inner];
      // winMin/Max take (n, x); sma takes (source, period)
      return [{ t: "fn", name: id, tf: node.ser.s === "w" ? "weekly" : "daily", offset: null, args }];
    }
    case "scalar": {
      const fn = SCALAR_FN_MAP[node.f];
      if (fn) {
        if (fn.id === "rsi" || fn.id === "natr") {
          return [{ t: "fn", name: fn.id, tf: fn.tf ?? tfHint, offset: null, args: [[numT(14)]] }];
        }
        if (fn.id === "macdHist") {
          return [{ t: "fn", name: "macdHist", tf: fn.tf ?? tfHint, offset: null, args: [[numT(12)], [numT(26)], [numT(9)]] }];
        }
        if (fn.id === "bbPctB") {
          return [{ t: "fn", name: "bbPctB", tf: "daily", offset: null, args: [[numT(20)], [numT(2)]] }];
        }
        if (fn.id === "bbBandwidth") {
          return [{ t: "fn", name: "bbBandwidth", tf: "daily", offset: null, args: [[numT(20)], [numT(2)]] }];
        }
        return [attrT(fn.id, fn.tf ?? tfHint)];
      }
      if (FIELD_MAP[node.f]) return [attrT(FIELD_MAP[node.f], tfHint)];
      notes.push(`Field ${node.f} has no equivalent in the new builder`);
      return null;
    }
  }
}

// ---------------------------------------------------------------- row conversion

const OP_MAP: Record<string, Clause["cmp"]> = {
  gt: "gt", gte: "gte", lt: "lt", lte: "lte", eq: "eq",
  crossAbove: "crossAbove", crossBelow: "crossBelow", withinPct: "withinPct",
};

function oldTermToExpr(t: unknown, notes: string[]): Expr | null {
  const r = t as { mode?: string; v?: string; src?: string; f?: string; tf?: "d" | "w"; off?: number; p?: number };
  if (!r?.mode) return null;
  if (r.mode === "num") {
    const parsed = parseProExpr(r.v?.trim() ?? "0");
    if (parsed.ok && parsed.node.k === "num") return [numT(parsed.node.v)];
    if (parsed.ok) return nodeToExpr(parsed.node, notes);
    return [numT(parseFloat(r.v ?? "0") || 0)];
  }
  if (r.mode === "expr") {
    const parsed = parseProExpr(r.src ?? "");
    if (!parsed.ok) {
      notes.push(`Expression "${r.src}" could not be converted`);
      return null;
    }
    return nodeToExpr(parsed.node, notes);
  }
  // field
  if (r.f === "marketCap") return [attrT("mcap")];
  const specSeries = ["open", "high", "low", "close", "volume"].includes(r.f ?? "");
  if (specSeries) {
    const term: NewTerm = {
      t: "attr", name: r.f!, tf: r.tf === "w" ? "weekly" : "daily",
      offset: (r.off ?? 0) > 0 ? { n: r.off!, unit: r.tf === "w" ? "candle" : "candle" } : null,
    };
    return [term];
  }
  // window catalog ids (smaClose, maxHigh, minLow, smaVolume)
  const winMap: Record<string, { id: string; src: string; p: number }> = {
    smaClose: { id: "sma", src: "close", p: 50 },
    smaVolume: { id: "sma", src: "volume", p: 20 },
    maxHigh: { id: "winMax", src: "high", p: 20 },
    minLow: { id: "winMin", src: "low", p: 66 },
  };
  const w = winMap[r.f ?? ""];
  if (w) {
    const src: Expr = [{ t: "attr", name: w.src, tf: r.tf === "w" ? "weekly" : "daily", offset: (r.off ?? 0) > 0 ? { n: r.off!, unit: "candle" } : null }];
    const args: Expr[] = w.id === "sma" ? [src, [numT(r.p ?? w.p)]] : [[numT(r.p ?? w.p)], src];
    return [{ t: "fn", name: w.id, tf: r.tf === "w" ? "weekly" : "daily", offset: null, args }];
  }
  const fn = SCALAR_FN_MAP[r.f ?? ""];
  if (fn) {
    if (fn.id === "rsi" || fn.id === "natr") {
      return [{ t: "fn", name: fn.id, tf: fn.tf ?? "daily", offset: (r.off ?? 0) > 0 ? { n: r.off!, unit: "candle" } : null, args: [[numT(14)]] }];
    }
    if (fn.id === "macdHist") {
      return [{ t: "fn", name: "macdHist", tf: fn.tf ?? "daily", offset: null, args: [[numT(12)], [numT(26)], [numT(9)]] }];
    }
    if (fn.id === "bbPctB") return [{ t: "fn", name: "bbPctB", tf: "daily", offset: null, args: [[numT(20)], [numT(2)]] }];
    if (fn.id === "bbBandwidth") return [{ t: "fn", name: "bbBandwidth", tf: "daily", offset: null, args: [[numT(20)], [numT(2)]] }];
    return [attrT(fn.id, fn.tf ?? "daily")];
  }
  const mapped = FIELD_MAP[r.f ?? ""];
  if (mapped) return [attrT(mapped, r.tf === "w" ? "weekly" : "daily")];
  notes.push(`Field ${r.f} has no equivalent in the new builder`);
  return null;
}

function patternToClause(pat: { pattern: string; tf: "d" | "w"; n: number }): Clause | null {
  // N consecutive higher highs / lower lows — expressed with Count()
  const tf = pat.tf === "w" ? "weekly" : "daily";
  const attrHigh = (candlesAgo = 0): NewTerm => ({
    t: "attr", name: "high", tf, offset: candlesAgo ? { n: candlesAgo, unit: "candle" } : null,
  });
  const attrLow = (candlesAgo = 0): NewTerm => ({
    t: "attr", name: "low", tf, offset: candlesAgo ? { n: candlesAgo, unit: "candle" } : null,
  });
  const winFn = (name: string, n: number, src: NewTerm): NewTerm => ({
    t: "fn", name, tf, offset: null, args: [[numT(n)], [src]],
  });
  const winCount = (n: number, cond: Expr): NewTerm => ({ t: "fn", name: "winCount", tf, offset: null, args: [[numT(n)], cond] });

  if (pat.pattern === "higherHighs") {
    // Count(n, High − Max(n, 1 candle ago High)) >= n−1
    const cond: Expr = [{ t: "bracket", inner: [attrHigh(), op("-"), winFn("winMax", pat.n, attrHigh(1))] }];
    return { id: uid("c"), kind: "clause", left: [winCount(pat.n, cond)], cmp: "gte", right: [numT(pat.n - 1)], enabled: true };
  }
  if (pat.pattern === "lowerLows") {
    // Count(n, Min(n, 1 candle ago Low) − Low) >= n−1
    const cond: Expr = [{ t: "bracket", inner: [winFn("winMin", pat.n, attrLow(1)), op("-"), attrLow()] }];
    return { id: uid("c"), kind: "clause", left: [winCount(pat.n, cond)], cmp: "gte", right: [numT(pat.n - 1)], enabled: true };
  }
  return null;
}

/** Convert a saved definition (v3 / v2 / legacy / text) into a Scan. */
export function defToScan(def: unknown): ConvertResult | null {
  const notes: string[] = [];
  if (!def || typeof def !== "object") return null;
  const d = def as Record<string, unknown>;

  // already v3
  if (d.v === 3 && d.scan) {
    return { scan: d.scan as Scan, notes };
  }

  // Chartink-style text
  if (typeof def === "string") {
    const parsed = parseScanText(def);
    return parsed.ok ? { scan: parsed.scan, notes } : null;
  }

  // v2 rows
  if (d.v === 2 && Array.isArray(d.rows)) {
    return rowsToScan(d.rows as unknown[], (d.uni as Record<string, string> | undefined) ?? undefined, notes);
  }

  // legacy bare array
  if (Array.isArray(d)) return rowsToScan(d, undefined, notes);

  return null;
}

function rowsToScan(rows: unknown[], uni: Record<string, string> | undefined, notes: string[]): ConvertResult {
  const clauses: { clause: Clause; logic: "and" | "or" }[] = [];
  for (const raw of rows) {
    const r = raw as { logic?: "and" | "or"; op?: string; left?: unknown; right?: unknown; right2?: unknown; pct?: string; pat?: { pattern: string; tf: "d" | "w"; n: number } };
    if (r.pat) {
      const c = patternToClause(r.pat);
      if (c) clauses.push({ clause: c, logic: r.logic ?? "and" });
      else notes.push(`Pattern ${r.pat.pattern} was dropped`);
      continue;
    }
    const cmp = OP_MAP[r.op ?? "gt"] ?? (r.op === "between" ? "between" : null);
    if (!cmp) { notes.push(`Operator ${r.op} was dropped`); continue; }
    const left = oldTermToExpr(r.left, notes);
    if (!left) continue;
    const right = cmp === "isTrue" || cmp === "isFalse" ? [] : oldTermToExpr(r.right, notes);
    if (!right) continue;
    const clause: Clause = { id: uid("c"), kind: "clause", left, cmp, right, enabled: true };
    if (cmp === "between") {
      const r2 = oldTermToExpr(r.right2, notes);
      if (!r2) continue;
      clause.right2 = r2;
    }
    if (cmp === "withinPct") clause.pct = parseFloat(r.pct ?? "2") || 2;
    clauses.push({ clause, logic: r.logic ?? "and" });
  }

  // consecutive or-rows become an "any" group
  const root = newGroup("all");
  let current: Group | null = null;
  for (const { clause, logic } of clauses) {
    if (logic === "or") {
      if (!current) {
        const prev = root.children.pop() as Clause | undefined;
        current = newGroup("any");
        current.anyCount = 1;
        if (prev) current.children.push(prev);
        root.children.push(current);
      }
      current.children.push(clause);
    } else {
      current = null;
      root.children.push(clause);
    }
  }

  const scan: Scan = { segment: "cash", root };
  if (uni) {
    (scan as Scan & { uni?: unknown }).uni = uni;
  }
  return { scan, notes };
}

/** Universe-bar state saved with v2 definitions. */
export function uniFromDef(def: unknown): Record<string, string> | undefined {
  if (def && typeof def === "object") {
    const uni = (def as { uni?: Record<string, string> }).uni;
    if (uni && typeof uni === "object") return uni;
    const scan = (def as { scan?: { uni?: Record<string, string> } }).scan;
    if (scan?.uni) return scan.uni;
  }
  return undefined;
}
