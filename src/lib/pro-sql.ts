/**
 * Server-side compiler: pro condition rows → one SQLite query over
 * Stock ⋈ latest daily bar ⋈ latest weekly candle.
 *
 * Each distinct (series, field, window, shift) referenced by the pro
 * expressions becomes a window-function column in a CTE; the row
 * comparisons then evaluate over those columns for the latest bar of each
 * series. NULL semantics double as "not enough history" — a stock without
 * 200 bars simply never satisfies sma(close, 200) comparisons.
 *
 * Window specs used:
 *   lag  — LAG(field, shift)
 *   sma  — AVG(field) OVER (ROWS BETWEEN n-1+shift PRECEDING AND shift PRECEDING)
 *   min/max — MIN/MAX with the same frame (all trailing, so one sort pass each)
 *
 * The heavy part only scans the trailing sessions actually needed
 * (date >= cutoff, derived from the deepest lookback), and results are
 * cached briefly so paging doesn't re-run the CTE chain.
 */

import {
  ExprNode,
  SCALAR_FIELDS,
  SeriesAtom,
  isScalarOnly,
  parseProExpr,
} from "./pro-expr";
import { toPgSql } from "./db";

// ------------------------------------------------------------ field catalogs

/** Stock-table numeric columns usable by simple field rows (pro path). */
export const PRO_NUMERIC_FIELDS = [
  "price", "open", "dayHigh", "dayLow", "changePct", "volume", "avgVol3M", "marketCap",
  "wOpen", "wHigh", "wLow", "wClose",
  "peTTM", "pbRatio", "divYield",
  "rsi14", "wRsi14", "macdHist", "wMacdHist", "mom1M", "mom3M", "mom6M",
  "fromHighPct", "fromLowPct", "atr14Pct",
  "bbPctB", "bbWidthPct",
  "distSma20Pct", "distSma50Pct", "distSma100Pct", "distSma200Pct",
  "distEma20Pct", "distEma50Pct", "distEma100Pct", "distEma200Pct",
  "rsRating", "epsScore",
] as const;

export const PRO_BOOLEAN_FIELDS = [
  "aboveSma20", "aboveSma50", "aboveSma200", "goldenCross", "volSpike", "emaCross",
] as const;

/** Snapshot columns referenced inside pro expressions (subset — OHLC/volume
 *  belong to the candle series, not the snapshot). Currently informational:
 *  simple field rows are compiled over the full PRO_NUMERIC whitelist. */
const EXPR_SCALAR_COLS: ReadonlySet<string> = new Set(SCALAR_FIELDS.map((x) => x.f));
void EXPR_SCALAR_COLS;

export const PRO_SORTS = [
  "marketCap", "changePct", "rsi14", "price", "mom1M", "mom3M", "mom6M", "volume",
  "peTTM", "fromHighPct", "fromLowPct", "pbRatio", "divYield", "atr14Pct",
] as const;

// ------------------------------------------------------------ wire rows

export interface FieldRowWire {
  f?: unknown;
  op?: unknown;
  v?: unknown;
  v2?: unknown;
  logic?: unknown;
}

export interface ExprRowWire {
  kind?: unknown; // "expr"
  cmp?: unknown;
  l?: unknown;
  r?: unknown;
  r2?: unknown;
  pct?: unknown; // withinPct — percent width
  logic?: unknown;
}

/** Pattern row — one wire row that compiles to a cross-bar boolean the
 *  expression grammar can't reach (streaks). Replaces the repeated
 *  "weekly high >= N weeks ago high" rows users had to stack by hand. */
export interface PatternRowWire {
  kind?: unknown; // "pattern"
  pattern?: unknown; // "higherHighs" | "lowerLows"
  tf?: unknown; // "d" | "w"
  n?: unknown; // streak length 1–20
  logic?: unknown;
}

export type ProRowWire = FieldRowWire | ExprRowWire | PatternRowWire;

export const EXPR_CMPS = [
  "gt", "gte", "lt", "lte", "eq", "between", "crossAbove", "crossBelow", "withinPct",
] as const;
type ExprCmp = (typeof EXPR_CMPS)[number];

const DIRECT_CMP_SQL: Record<"gt" | "gte" | "lt" | "lte" | "eq", string> = {
  gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=",
};

export class ProCompileError extends Error {}

// ------------------------------------------------------------ v2 payload

/** Versioned condition payload from the rebuilt visual builder. Row semantics:
 *  the `logic` chip joins a row to the previous one; AND chips split the chain
 *  into OR-groups (the amber boxes in the UI) and the groups AND-combine —
 *  i.e. A AND (B OR C), exactly as the boxes read. */
export interface V2CondPayload {
  v: 2;
  rows: ProRowWire[];
}

export function isV2Payload(x: unknown): x is V2CondPayload {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { v?: unknown }).v === 2 &&
    Array.isArray((x as { rows?: unknown }).rows)
  );
}

export type CondSemantics = "legacy" | "v2";

// ------------------------------------------------------------ feature collection

interface Feature {
  alias: string;
  def: string; // SQL for the window column
}

interface FeatCtx {
  d: Map<string, Feature>;
  w: Map<string, Feature>;
  needsD: boolean;
  needsW: boolean;
  aliasSeq: number;
}

const featKey = (f: string, kind: string, n: number, shift: number) => `${f}|${kind}|${n}|${shift}`;

function windowDef(kind: "lag" | "sma" | "min" | "max", f: string, n: number, shift: number, orderCol: string): string {
  const agg = kind === "sma" ? "AVG" : kind === "min" ? "MIN" : kind === "max" ? "MAX" : null;
  if (agg === null) return `LAG("${f}", ${shift}) OVER (PARTITION BY symbol ORDER BY ${orderCol})`;
  const frame =
    shift === 0
      ? `ROWS BETWEEN ${n - 1} PRECEDING AND CURRENT ROW`
      : `ROWS BETWEEN ${n - 1 + shift} PRECEDING AND ${shift} PRECEDING`;
  return `${agg}("${f}") OVER (PARTITION BY symbol ORDER BY ${orderCol} ${frame})`;
}

function featFor(ctx: FeatCtx, s: "d" | "w", f: string, kind: "lag" | "sma" | "min" | "max", n: number, shift: number): Feature {
  const map = s === "d" ? ctx.d : ctx.w;
  const key = featKey(f, kind, n, shift);
  const found = map.get(key);
  if (found) return found;
  const alias = `f${ctx.aliasSeq++}`;
  const def = windowDef(kind, f, kind === "lag" ? 0 : n, shift, s === "d" ? "date" : "wk");
  const feat: Feature = { alias, def };
  map.set(key, feat);
  return feat;
}

function serRef(ctx: FeatCtx, ser: SeriesAtom): string {
  if (ser.s === "d") {
    ctx.needsD = true;
    if (ser.shift === 0) return `d."${ser.f}"`;
    return `d."${featFor(ctx, "d", ser.f, "lag", 0, ser.shift).alias}"`;
  }
  ctx.needsW = true;
  if (ser.shift === 0) return `w."${ser.f}"`;
  return `w."${featFor(ctx, "w", ser.f, "lag", 0, ser.shift).alias}"`;
}

function nodeSql(ctx: FeatCtx, n: ExprNode): string {
  switch (n.k) {
    case "num": {
      // Keep a decimal point so SQLite never does integer division.
      const s = String(n.v);
      return /[.eE]/.test(s) ? s : `${s}.0`;
    }
    case "bin":
      // Division by zero → NULL (no match), never a query failure: a stock
      // with a 0-volume base (SME pairs, suspended bars) would otherwise 500
      // the whole screen. NULL propagates into the comparison and excludes.
      return n.op === "/"
        ? `(${nodeSql(ctx, n.a)}) / NULLIF(${nodeSql(ctx, n.b)}, 0.0)`
        : `(${nodeSql(ctx, n.a)} ${n.op} ${nodeSql(ctx, n.b)})`;
    case "neg":
      return `(-${nodeSql(ctx, n.a)})`;
    case "abs":
      return `ABS(${nodeSql(ctx, n.a)})`;
    case "ser":
      return serRef(ctx, { s: n.s, f: n.f, shift: n.shift });
    case "win": {
      // The shift folds into the window frame (BETWEEN n-1+s PRECEDING AND s
      // PRECEDING) — the feature is computed directly over the base column.
      const kind = n.fn === "sma" ? "sma" : n.fn;
      if (n.ser.s === "d") ctx.needsD = true;
      else ctx.needsW = true;
      const map = n.ser.s === "d" ? ctx.d : ctx.w;
      const key = featKey(n.ser.f, kind, n.n, n.ser.shift);
      const existing = map.get(key);
      const p = n.ser.s === "d" ? "d" : "w";
      if (existing) return `${p}."${existing.alias}"`;
      const alias = `f${ctx.aliasSeq++}`;
      map.set(key, {
        alias,
        def: windowDef(kind, n.ser.f, n.n, n.ser.shift, n.ser.s === "d" ? "date" : "wk"),
      });
      return `${p}."${alias}"`;
    }
    case "scalar":
      return `st."${n.f}"`;
  }
}

// ------------------------------------------------------------ pattern rows

const PATTERN_MAX_N = 20;

/** A pattern row → boolean SQL over the same CTE features. NULL lags (stocks
 *  with too little history) quietly fail the comparison — exclusion, not error. */
function compilePatternRow(ctx: FeatCtx, raw: PatternRowWire, rowIdx: number): CompiledRow | null {
  const pat = typeof raw.pattern === "string" ? raw.pattern : "";
  if (pat !== "higherHighs" && pat !== "lowerLows") return null;
  const tf = raw.tf === "w" ? "w" : "d";
  const n = Number(raw.n);
  if (!Number.isInteger(n) || n < 1 || n > PATTERN_MAX_N) {
    throw new ProCompileError(`Row ${rowIdx}: pattern streak length must be 1–${PATTERN_MAX_N}`);
  }
  // higherHighs: current high ≥ each of the previous n highs (lowerLows: low ≤ …)
  const f = pat === "higherHighs" ? "high" : "low";
  const op = pat === "higherHighs" ? ">=" : "<=";
  const p = tf === "d" ? "d" : "w";
  if (tf === "d") ctx.needsD = true; else ctx.needsW = true;
  const parts: string[] = [];
  for (let k = 1; k <= n; k++) {
    const lag = featFor(ctx, tf, f, "lag", 0, k);
    parts.push(`(${p}."${f}" ${op} ${p}."${lag.alias}")`);
  }
  return { sql: `(${parts.join(" AND ")})`, params: [] };
}

// ------------------------------------------------------------ row compilation

interface CompiledRow {
  sql: string;
  params: unknown[];
}

/** Simple field row → SQL over st.* (mirrors the fast path's buildCondition). */
function compileFieldRow(raw: FieldRowWire): CompiledRow | null {
  const f = typeof raw.f === "string" ? raw.f : "";
  const op = typeof raw.op === "string" ? raw.op : "";
  const isBool = (PRO_BOOLEAN_FIELDS as readonly string[]).includes(f);
  const isNum = (PRO_NUMERIC_FIELDS as readonly string[]).includes(f);
  if (!isBool && !isNum) return null;

  if (isBool) {
    if (op !== "eq") return null;
    // IS TRUE / IS FALSE works on both PostgreSQL booleans and SQLite 0/1 ints.
    return { sql: `st."${f}" IS ${raw.v === true || raw.v === "true" ? "TRUE" : "FALSE"}`, params: [] };
  }

  const v = Number(raw.v);
  if (!Number.isFinite(v)) return null;
  switch (op) {
    case "gt": return { sql: `st."${f}" > ?`, params: [v] };
    case "gte": return { sql: `st."${f}" >= ?`, params: [v] };
    case "lt": return { sql: `st."${f}" < ?`, params: [v] };
    case "lte": return { sql: `st."${f}" <= ?`, params: [v] };
    case "between": {
      const v2 = Number(raw.v2);
      if (!Number.isFinite(v2)) return null;
      return { sql: `st."${f}" BETWEEN ? AND ?`, params: [Math.min(v, v2), Math.max(v, v2)] };
    }
    default:
      return null;
  }
}

/** A copy of the AST with every candle series advanced `bars` bars back —
 *  daily series shift in daily bars, weekly series in weekly candles. This is
 *  "the previous value of this expression", the backbone of the crosses
 *  pattern: close crosses above 50 ⇔ close > 50 AND prev(close) <= 50. */
function shiftNode(n: ExprNode, bars: number): ExprNode {
  switch (n.k) {
    case "ser":
      return { ...n, shift: n.shift + bars };
    case "win":
      return { ...n, ser: { ...n.ser, shift: n.ser.shift + bars } };
    case "neg":
      return { k: "neg", a: shiftNode(n.a, bars) };
    case "abs":
      return { k: "abs", a: shiftNode(n.a, bars) };
    case "bin":
      return { k: "bin", op: n.op, a: shiftNode(n.a, bars), b: shiftNode(n.b, bars) };
    default:
      return n; // num / scalar — constants have no previous bar
  }
}

function hasSeries(n: ExprNode): boolean {
  switch (n.k) {
    case "ser":
    case "win":
      return true;
    case "neg":
    case "abs":
      return hasSeries(n.a);
    case "bin":
      return hasSeries(n.a) || hasSeries(n.b);
    default:
      return false;
  }
}

/** One pro row → SQL. `ctx` collects the window features both for the full
 *  query and (with a throwaway ctx) for the cheap pre-filter. */
function rowSql(
  ctx: FeatCtx,
  cmp: ExprCmp,
  rowIdx: number,
  ln: ExprNode,
  rn: ExprNode,
  r2n: ExprNode | null,
  pct: number | null
): string {
  const l = nodeSql(ctx, ln);
  const r = nodeSql(ctx, rn);
  if (cmp === "crossAbove" || cmp === "crossBelow") {
    if (!hasSeries(ln) && !hasSeries(rn)) {
      throw new ProCompileError(
        `Row ${rowIdx}: crosses needs candle fields (price, volume, sma…) — snapshot values have no previous bar`
      );
    }
    const lPrev = nodeSql(ctx, shiftNode(ln, 1));
    const rPrev = nodeSql(ctx, shiftNode(rn, 1));
    const main = cmp === "crossAbove" ? ">" : "<";
    const prev = cmp === "crossAbove" ? "<=" : ">=";
    return `(${l}) ${main} (${r}) AND (${lPrev}) ${prev} (${rPrev})`;
  }
  if (cmp === "withinPct") {
    return `(ABS((${l}) - (${r})) / NULLIF(ABS((${r})), 0.0)) * 100.0 <= ${pct}`;
  }
  if (cmp === "between" && r2n) {
    const r2 = nodeSql(ctx, r2n);
    // LEAST/GREATEST (PostgreSQL) — SQLite's scalar min/max don't exist there.
    return `(${l}) BETWEEN LEAST((${r}), (${r2})) AND GREATEST((${r}), (${r2}))`;
  }
  return `(${l}) ${DIRECT_CMP_SQL[cmp]} (${r})`;
}

export const MAX_PRO_ROWS = 50;


// ------------------------------------------------------------ query assembly

export interface ProQueryOpts {
  sector: string;
  sort: string;
  dir: "asc" | "desc";
  /** Universe-bar extras — always AND-combined, never consume row slots.
   *  `cheap` fragments reference only st.* columns and join the candidate
   *  pre-filter; others (symbol lists, subqueries) go to the main WHERE. */
  extra?: { sql: string; params: unknown[]; cheap?: boolean }[];
  /** Expression sources to surface as computed-value columns ("c0", "c1"…)
   *  alongside the symbol — the results-table "show values" feature. */
  selectColExprs?: string[];
  /** Fixed membership list (Nifty 50 / F&O) — restricts CTE scans directly. */
  restrictCandidates?: string[] | null;
}

export interface Cutoffs {
  d: string | null;
  w: string | null;
}

export interface CompiledProQuery {
  sql: string;
  params: unknown[];
  sessionsD: number; // trailing sessions the daily lookbacks require
  sessionsW: number; // trailing sessions the weekly lookbacks require
  needsD: boolean;
  needsW: boolean;
  condCount: number;
}

/** Restrict the CTE scans to candidate symbols when the cheap rows narrow
 *  the universe enough — measured ~4× faster on this dataset. */
const RESTRICT_MAX = 1200;

interface Group {
  all: CompiledRow[];                      // every compiled row in the conjunction
  cheap: CompiledRow[];                    // st.*-only conditions usable as a candidate pre-filter
}

/**
 * Compile all rows into groups, collecting per group the snapshot-only
 * conditions for the candidate pre-filter.
 *
 * Two semantics, chosen by the payload version:
 *   legacy — a row with logic:"or" starts a new AND-group; groups OR-combine
 *            ((A∧B) ∨ C).
 *   v2     — a row with logic:"and" starts a new group; within a group rows
 *            OR-combine and groups AND-combine (A ∧ (B∨C)) — the visual amber
 *            boxes of the rebuilt builder.
 */
function groupRows(
  rows: ProRowWire[],
  ctx: FeatCtx,
  semantics: CondSemantics,
  base: ProRowWire[] = []
): { groups: Group[]; condCount: number } {
  const splitOn: "and" | "or" = semantics === "v2" ? "and" : "or";
  const groups: Group[] = [];
  let condCount = 0;

  // Universe-bar base rows — each becomes its own top-level group (v2 groups
  // AND-combine), so baseline filters AND into the screen without consuming
  // any of the user's condition slots. Only ever sent by the v2 builder.
  base.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const rowIdx = idx + 1;
    const isExpr = (raw as ExprRowWire).kind === "expr";
    if (isExpr) {
      const r = raw as ExprRowWire;
      const parseSide = (x: unknown, what: string) => {
        if (typeof x !== "string" || !x.trim()) {
          throw new ProCompileError(`Universe filter ${rowIdx}: the ${what} expression is empty`);
        }
        const parsed = parseProExpr(x);
        if (!parsed.ok) throw new ProCompileError(`Universe filter ${rowIdx}: ${parsed.error}`);
        return parsed.node;
      };
      const ln = parseSide(r.l, "left");
      const rn = parseSide(r.r, "right");
      const cmp = typeof r.cmp === "string" && (EXPR_CMPS as readonly string[]).includes(r.cmp)
        ? (r.cmp as ExprCmp)
        : null;
      if (!cmp) throw new ProCompileError(`Universe filter ${rowIdx}: unknown operator`);
      condCount++;
      groups.push({ all: [{ sql: rowSql(ctx, cmp, 0, ln, rn, null, null), params: [] }], cheap: [] });
      return;
    }
    const compiled = compileFieldRow(raw as FieldRowWire);
    if (!compiled) return;
    condCount++;
    groups.push({ all: [compiled], cheap: [{ sql: compiled.sql, params: compiled.params }] });
  });

  rows.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const rowIdx = idx + 1;
    // Pattern rows — one wire row compiles to a cross-bar streak boolean.
    if ((raw as PatternRowWire).kind === "pattern") {
      const compiled = compilePatternRow(ctx, raw as PatternRowWire, rowIdx);
      if (!compiled) return;
      condCount++;
      pushCompiled(groups, compiled, null, (raw as PatternRowWire).logic, splitOn);
      return;
    }
    const isExpr = (raw as ExprRowWire).kind === "expr";
    if (isExpr) {
      const r = raw as ExprRowWire;
      // Parse both sides once; reuse for the full SQL and the cheap check.
      const parseSide = (x: unknown, what: string) => {
        if (typeof x !== "string" || !x.trim()) {
          throw new ProCompileError(`Row ${rowIdx}: the ${what} expression is empty`);
        }
        const parsed = parseProExpr(x);
        if (!parsed.ok) throw new ProCompileError(`Row ${rowIdx}: ${parsed.error}`);
        return parsed.node;
      };
      const ln = parseSide(r.l, "left");
      const rn = parseSide(r.r, "right");
      const r2n = r.cmp === "between" ? parseSide(r.r2, "second right") : null;
      const cmp = typeof r.cmp === "string" && (EXPR_CMPS as readonly string[]).includes(r.cmp)
        ? (r.cmp as ExprCmp)
        : null;
      if (!cmp) throw new ProCompileError(`Row ${rowIdx}: unknown operator — pick >, ≥, <, ≤, =, between, crosses or within-%`);
      let pct: number | null = null;
      if (cmp === "withinPct") {
        pct = Number(r.pct);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 10000) {
          throw new ProCompileError(`Row ${rowIdx}: "within % of" needs a percent between 0 and 10000`);
        }
      }
      condCount++;
      const compiled: CompiledRow = { sql: rowSql(ctx, cmp, rowIdx, ln, rn, r2n, pct), params: [] };
      // Cheap pre-filter: both sides reference only snapshot columns (never
      // for crosses — they always drag in previous-bar series).
      if (
        cmp !== "crossAbove" &&
        cmp !== "crossBelow" &&
        isScalarOnly(ln) &&
        isScalarOnly(rn) &&
        (r2n === null || isScalarOnly(r2n))
      ) {
        const cheapCtx: FeatCtx = { d: new Map(), w: new Map(), needsD: false, needsW: false, aliasSeq: 0 };
        const cl = nodeSql(cheapCtx, ln);
        const cr = nodeSql(cheapCtx, rn);
        if (cheapCtx.d.size + cheapCtx.w.size === 0) {
          const cr2 = r2n ? nodeSql(cheapCtx, r2n) : null;
          const cheapSql =
            cmp === "withinPct" && pct != null
              ? `(ABS((${cl}) - (${cr})) / NULLIF(ABS((${cr})), 0.0)) * 100.0 <= ${pct}`
              : cmp === "between" && r2n && cr2 != null
                ? `(${cl}) BETWEEN LEAST((${cr}), (${cr2})) AND GREATEST((${cr}), (${cr2}))`
                : `(${cl}) ${DIRECT_CMP_SQL[cmp]} (${cr})`;
          pushCompiled(groups, compiled, { sql: cheapSql, params: [] }, r.logic, splitOn);
          return;
        }
      }
      pushCompiled(groups, compiled, null, r.logic, splitOn);
      return;
    }

    const compiled = compileFieldRow(raw as FieldRowWire);
    if (!compiled) return;
    condCount++;
    pushCompiled(groups, compiled, { sql: compiled.sql, params: compiled.params }, (raw as FieldRowWire).logic, splitOn);
  });
  return { groups, condCount };
}

function pushCompiled(
  groups: Group[],
  compiled: CompiledRow,
  cheap: CompiledRow | null,
  logic: unknown,
  splitOn: "and" | "or"
): void {
  const isSplit = logic === splitOn && groups.length > 0;
  if (isSplit) groups.push({ all: [compiled], cheap: cheap ? [cheap] : [] });
  else {
    if (groups.length === 0) groups.push({ all: [], cheap: [] });
    groups[groups.length - 1].all.push(compiled);
    if (cheap) groups[groups.length - 1].cheap.push(cheap);
  }
}

/** Pure compile — no DB access. Called twice (probe for cutoffs, then final). */
export function compileProQuery(
  rows: ProRowWire[],
  opts: ProQueryOpts,
  cutoffs: Cutoffs,
  restrictSymbols: string[] | null,
  semantics: CondSemantics = "legacy",
  base: ProRowWire[] = []
): CompiledProQuery {
  const ctx: FeatCtx = { d: new Map(), w: new Map(), needsD: false, needsW: false, aliasSeq: 0 };
  const { groups, condCount } = groupRows(rows, ctx, semantics, base);

  // Computed-value columns — compiled through the SAME ctx so any window a
  // column references joins the CTE collection.
  const selectCols: string[] = [];
  for (const src of opts.selectColExprs ?? []) {
    const parsed = parseProExpr(src);
    if (!parsed.ok) throw new ProCompileError(`Computed column: ${parsed.error}`);
    selectCols.push(`(${nodeSql(ctx, parsed.node)})`);
  }

  // WHERE assembly
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.sector && opts.sector !== "all") {
    conds.push(`st."sector" = ?`);
    params.push(opts.sector);
  }
  // Universe extras — AND-combined, in SQL text order right after sector.
  for (const ex of opts.extra ?? []) {
    conds.push(ex.sql);
    params.push(...ex.params);
  }
  // Symbol restriction (fixed universe or candidate pre-filter) must hold in
  // the main WHERE too — CTE-only restriction silently leaks when no CTE is
  // needed (snapshot-only screens would scan the whole market).
  if (restrictSymbols && restrictSymbols.length > 0) {
    conds.push(`st."symbol" IN (${restrictSymbols.map(() => "?").join(",")})`);
    params.push(...restrictSymbols);
  }
  if (groups.length > 0) {
    // Within a group: legacy rows AND together; v2 rows are the OR-box contents.
    // Across groups: legacy OR-combines (branch union), v2 AND-combines (boxes).
    const groupJoin = semantics === "v2" ? " OR " : " AND ";
    const topJoin = semantics === "v2" ? " AND " : " OR ";
    const groupSql = groups.map((g) =>
      g.all.length === 1 ? g.all[0].sql : `(${g.all.map((x) => x.sql).join(groupJoin)})`
    );
    for (const g of groups) for (const x of g.all) params.push(...x.params);
    conds.push(groupSql.length === 1 ? groupSql[0] : `(${groupSql.join(topJoin)})`);
  }

  // Deepest lookback per series → trailing sessions each CTE must scan.
  const depthOf = (map: Map<string, Feature>, weekly: boolean): number => {
    let deep = 0;
    for (const key of map.keys()) {
      const [, kind, nStr, sStr] = key.split("|");
      const n = Number(nStr), s = Number(sStr);
      const d = kind === "lag" ? s : n - 1 + s;
      deep = Math.max(deep, weekly ? d * 7 + 5 : d);
    }
    return deep === 0 ? 0 : Math.min(510, deep + 10);
  };
  const sessionsD = ctx.needsD ? depthOf(ctx.d, false) : 0;
  const sessionsW = ctx.needsW ? depthOf(ctx.w, true) : 0;

  const inClause = restrictSymbols && restrictSymbols.length > 0
    ? ` AND symbol IN (${restrictSymbols.map(() => "?").join(",")})`
    : "";

  // CTE chain — only what the expressions reference.
  const ctes: string[] = [];
  if (ctx.needsD) {
    ctes.push(
      `dRaw AS (SELECT symbol, date, open, high, low, close, volume,\n` +
        `       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rnD${ctx.d.size ? "," : ""}\n` +
        [...ctx.d.values()].map((f) => `       ${f.def} AS ${f.alias}`).join(",\n") +
        `\n  FROM "DailyBar" WHERE 1=1${cutoffs.d ? ` AND date >= ?` : ""}${inClause})`
    );
    ctes.push(`dLast AS (SELECT * FROM dRaw WHERE rnD = 1)`);
  }
  if (ctx.needsW) {
    ctes.push(
      // Weekly bucket = ISO week (Monday-anchored, year-aware) — matches the
      // app's mondayOf() weekly candles. to_char is the PostgreSQL equivalent
      // of SQLite's strftime('%Y-%W').
      `wRaw AS (SELECT symbol, to_char(date::date, 'IYYY-IW') AS wk, open, high, low, close, volume,\n` +
        `       ROW_NUMBER() OVER (PARTITION BY symbol, to_char(date::date, 'IYYY-IW') ORDER BY date) AS rnW,\n` +
        `       COUNT(*) OVER (PARTITION BY symbol, to_char(date::date, 'IYYY-IW')) AS nW\n` +
        `  FROM "DailyBar" WHERE 1=1${cutoffs.w ? ` AND date >= ?` : ""}${inClause})`
    );
    ctes.push(
      `wAgg AS (SELECT symbol, wk,\n` +
        `       MAX(CASE WHEN rnW = 1 THEN open END) AS open,\n` +
        `       MAX(high) AS high, MIN(low) AS low,\n` +
        `       MAX(CASE WHEN rnW = nW THEN close END) AS close,\n` +
        `       SUM(volume) AS volume\n` +
        `  FROM wRaw GROUP BY symbol, wk)`
    );
    ctes.push(
      `wF AS (SELECT symbol, wk, open, high, low, close, volume,\n` +
        `       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY wk DESC) AS rnD${ctx.w.size ? "," : ""}\n` +
        [...ctx.w.values()].map((f) => `       ${f.def} AS ${f.alias}`).join(",\n") +
        `\n  FROM wAgg)`
    );
    ctes.push(`wLast AS (SELECT * FROM wF WHERE rnD = 1)`);
  }

  const withClause = ctes.length ? `WITH ${ctes.join(",\n")}` : "";
  const joins = [
    ctx.needsD ? `JOIN dLast d ON d."symbol" = st."symbol"` : "",
    ctx.needsW ? `JOIN wLast w ON w."symbol" = st."symbol"` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const whereAll = [...conds, `st."price" IS NOT NULL`].filter(Boolean).join("\n  AND ");

  const dir = opts.dir === "asc" ? "ASC" : "DESC";
  const sort = (PRO_SORTS as readonly string[]).includes(opts.sort) ? opts.sort : "marketCap";
  // PostgreSQL sorts NULLS FIRST on DESC — without NULLS LAST the pro screener's
  // first page would be the ~1,000 rows Yahoo carries no market cap/PE for.
  const nl = dir === "DESC" ? " NULLS LAST" : "";
  const orderBy =
    sort === "marketCap"
      ? `ORDER BY st."marketCap" ${dir}${nl}`
      : `ORDER BY st."${sort}" ${dir}${nl}, st."marketCap" DESC NULLS LAST`;

  const sql = [
    withClause,
    `SELECT st."symbol" AS symbol`,
    ...selectCols.map((c, i) => `  , ${c} AS "c${i}"`),
    `FROM "Stock" st`,
    joins,
    `WHERE ${whereAll}`,
    orderBy,
  ]
    .filter(Boolean)
    .join("\n");

  // Param order follows placeholder order in the SQL text: dRaw (cutoff, IN),
  // wRaw (cutoff, IN), then WHERE (sector, row params).
  const head: unknown[] = [];
  if (ctx.needsD) {
    if (cutoffs.d) head.push(cutoffs.d);
    if (restrictSymbols) head.push(...restrictSymbols);
  }
  if (ctx.needsW) {
    if (cutoffs.w) head.push(cutoffs.w);
    if (restrictSymbols) head.push(...restrictSymbols);
  }
  return {
    sql,
    params: [...head, ...params],
    sessionsD,
    sessionsW,
    needsD: ctx.needsD,
    needsW: ctx.needsW,
    condCount,
  };
}

// ------------------------------------------------------------ cached runner

type QueryClient = { $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown[]> };

interface CacheEntry {
  at: number;
  symbols: string[];
}

const CACHE_TTL_MS = 300_000; // EOD data — a five-minute memo is invisible
const CACHE_MAX = 16;
const cache = new Map<string, CacheEntry>();

export function clearProCache(): void {
  cache.clear();
}

function cutoffFor(client: QueryClient, sessions: number): Promise<string | null> {
  return client
    .$queryRawUnsafe(toPgSql(`SELECT date FROM "DailyBar" GROUP BY date ORDER BY date DESC LIMIT 1 OFFSET ?`), sessions)
    .then((cut) => {
      const row = (cut as { date?: unknown }[])[0];
      return row && typeof row.date === "string" ? row.date : null;
    });
}

/**
 * Matching symbols for a pro screen, sorted as asked, with a short-TTL memo
 * so flipping result pages never re-runs the CTE chain. Snapshot-only rows
 * pre-filter candidate symbols; when they narrow the universe enough, the
 * heavy window CTEs scan only those symbols' bars.
 */
export async function proSymbolList(
  client: QueryClient,
  rows: ProRowWire[],
  opts: ProQueryOpts,
  semantics: CondSemantics = "legacy",
  base: ProRowWire[] = []
): Promise<string[]> {
  const key = JSON.stringify([rows, base, opts, semantics]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.symbols;
  }

  // Probe compile: validates every row (throws ProCompileError) and learns
  // which CTEs the expressions need + how deep the lookbacks run.
  const probe = compileProQuery(rows, opts, { d: null, w: null }, null, semantics, base);

  // Candidate pre-filter from the snapshot-only rows. The active sector filter
  // also narrows candidates — include it here so sector-scoped pro screens
  // get the indexed scan too.
  let restrict: string[] | null = null;
  // A fixed universe (Nifty 50 / F&O) restricts directly — no query needed.
  if (opts.restrictCandidates && opts.restrictCandidates.length > 0 && opts.restrictCandidates.length <= RESTRICT_MAX) {
    restrict = opts.restrictCandidates;
  }
  const { groups } = groupRows(
    rows,
    { d: new Map(), w: new Map(), needsD: false, needsW: false, aliasSeq: 0 },
    semantics,
    base
  );
  if (restrict === null && groups.length > 0) {
    const sectorCond: CompiledRow | null =
      opts.sector && opts.sector !== "all"
        ? { sql: `st."sector" = ?`, params: [opts.sector] }
        : null;
    const groupConds = groups.map((g) =>
      sectorCond ? [...g.cheap, sectorCond] : g.cheap
    );
    const usable = groupConds.filter((c) => c.length > 0);
    if (semantics === "v2") {
      // Groups AND-combine: every group is required, so intersecting the
      // group constraints that ARE available stays a safe superset — groups
      // without snapshot conditions simply don't constrain the pre-filter.
      // Universe-bar cheap extras (min price / mcap) are required too.
      const cheapExtras = (opts.extra ?? [])
        .filter((e) => e.cheap)
        .map((e) => [{ sql: e.sql, params: e.params }] as CompiledRow[]);
      const usableAll = [...usable, ...cheapExtras];
      if (usableAll.length > 0) {
        const andSql = `SELECT st."symbol" AS symbol FROM "Stock" st WHERE ${usableAll
          .map((c) => (c.length === 1 ? c[0].sql : `(${c.map((x) => x.sql).join(" OR ")})`))
          .join(" AND ")}`;
        const andParams = usableAll.flatMap((c) => c.flatMap((x) => x.params));
        const cand = (await client.$queryRawUnsafe(toPgSql(andSql), ...andParams)) as { symbol: unknown }[];
        const symbols = cand.map((r) => String(r.symbol));
        if (symbols.length === 0) return [];
        if (symbols.length <= RESTRICT_MAX) restrict = symbols;
      }
    } else if (usable.length === groupConds.length) {
      // Legacy union: every OR-group must contribute its snapshot condition,
      // else its members can't be enumerated and no restriction is safe.
      const unionSql = `SELECT st."symbol" AS symbol FROM "Stock" st WHERE ${usable
        .map((c) => (c.length === 1 ? c[0].sql : `(${c.map((x) => x.sql).join(" AND ")})`))
        .join(" OR ")}`;
      const unionParams = usable.flatMap((c) => c.flatMap((x) => x.params));
      const cand = (await client.$queryRawUnsafe(toPgSql(unionSql), ...unionParams)) as { symbol: unknown }[];
      const symbols = cand.map((r) => String(r.symbol));
      if (symbols.length === 0) return [];
      if (symbols.length <= RESTRICT_MAX) restrict = symbols;
    }
  }

  const cutoffs: Cutoffs = { d: null, w: null };
  if (probe.needsD && probe.sessionsD > 0) cutoffs.d = await cutoffFor(client, probe.sessionsD);
  if (probe.needsW && probe.sessionsW > 0) cutoffs.w = await cutoffFor(client, probe.sessionsW);

  const compiled = compileProQuery(rows, opts, cutoffs, restrict, semantics, base);
  const out = await client.$queryRawUnsafe(toPgSql(compiled.sql), ...compiled.params);
  const symbols = (out as { symbol: unknown }[]).map((r) => String(r.symbol));

  cache.delete(key);
  cache.set(key, { at: Date.now(), symbols });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return symbols;
}

// ------------------------------------------------------------ computed values

export interface ComputedVals {
  symbol: string;
  vals: (number | null)[]; // one entry per requested column
}

/**
 * Computed-value columns for one page of an already-matched screen — the
 * "show computed value" results column. Compiles the SAME rows (so the CTE
 * feature set matches) but selects the requested expressions, restricted to
 * the page's symbols. Not cached: it runs for a handful of symbols only.
 */
export async function proComputedFor(
  client: QueryClient,
  rows: ProRowWire[],
  opts: ProQueryOpts,
  symbols: string[],
  colExprs: string[],
  base: ProRowWire[] = []
): Promise<Map<string, (number | null)[]>> {
  const out = new Map<string, (number | null)[]>();
  if (colExprs.length === 0 || symbols.length === 0) return out;
  if (symbols.length > RESTRICT_MAX) return out;

  const probe = compileProQuery(
    rows,
    { ...opts, selectColExprs: colExprs },
    { d: null, w: null },
    symbols,
    "v2",
    base
  );
  const cutoffs: Cutoffs = { d: null, w: null };
  if (probe.needsD && probe.sessionsD > 0) cutoffs.d = await cutoffFor(client, probe.sessionsD);
  if (probe.needsW && probe.sessionsW > 0) cutoffs.w = await cutoffFor(client, probe.sessionsW);

  const compiled = compileProQuery(
    rows,
    { ...opts, selectColExprs: colExprs },
    cutoffs,
    symbols,
    "v2",
    base
  );
  const res = (await client.$queryRawUnsafe(toPgSql(compiled.sql), ...compiled.params)) as Record<string, unknown>[];
  for (const r of res) {
    const sym = String(r.symbol);
    const vals: (number | null)[] = [];
    for (let i = 0; i < colExprs.length; i++) {
      const v = r[`c${i}`];
      vals.push(v == null ? null : Number(v));
    }
    out.set(sym, vals);
  }
  return out;
}
