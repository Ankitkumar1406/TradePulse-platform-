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
  logic?: unknown;
}

export type ProRowWire = FieldRowWire | ExprRowWire;

export const EXPR_CMPS = ["gt", "gte", "lt", "lte", "eq", "between"] as const;
type ExprCmp = (typeof EXPR_CMPS)[number];

const CMP_SQL: Record<ExprCmp, string> = {
  gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", between: "between",
};

export class ProCompileError extends Error {}

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
      return `(${nodeSql(ctx, n.a)} ${n.op} ${nodeSql(ctx, n.b)})`;
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
    return { sql: `st."${f}" IS ${raw.v === true || raw.v === "true" ? "1" : "0"}`, params: [] };
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

/** Pro expression row → SQL comparing both sides of the row. */
function compileExprRow(ctx: FeatCtx, raw: ExprRowWire, rowIdx: number): CompiledRow {
  const cmp = typeof raw.cmp === "string" && (EXPR_CMPS as readonly string[]).includes(raw.cmp)
    ? (raw.cmp as ExprCmp)
    : null;
  if (!cmp) throw new ProCompileError(`Row ${rowIdx}: unknown operator — pick >, ≥, <, ≤, = or between`);
  const side = (x: unknown, what: string): string => {
    if (typeof x !== "string" || !x.trim()) {
      throw new ProCompileError(`Row ${rowIdx}: the ${what} expression is empty`);
    }
    const parsed = parseProExpr(x);
    if (!parsed.ok) throw new ProCompileError(`Row ${rowIdx}: ${parsed.error}`);
    return nodeSql(ctx, parsed.node);
  };
  const l = side(raw.l, "left");
  const r = side(raw.r, "right");
  if (cmp === "between") {
    const r2 = side(raw.r2, "second right");
    return {
      sql: `(${l}) BETWEEN min((${r}), (${r2})) AND max((${r}), (${r2}))`,
      params: [],
    };
  }
  return { sql: `(${l}) ${CMP_SQL[cmp]} (${r})`, params: [] };
}

export const MAX_PRO_ROWS = 50;


// ------------------------------------------------------------ query assembly

export interface ProQueryOpts {
  sector: string;
  sort: string;
  dir: "asc" | "desc";
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
 * Compile all rows into OR-groups (a row with logic:"or" starts a new
 * conjunction — same semantics as the fast path), collecting per group the
 * snapshot-only conditions for the candidate pre-filter.
 */
function groupRows(rows: ProRowWire[], ctx: FeatCtx): { groups: Group[]; condCount: number } {
  const groups: Group[] = [];
  let condCount = 0;
  rows.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const rowIdx = idx + 1;
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
      if (!cmp) throw new ProCompileError(`Row ${rowIdx}: unknown operator — pick >, ≥, <, ≤, = or between`);
      const l = nodeSql(ctx, ln);
      const rr = nodeSql(ctx, rn);
      const sql =
        cmp === "between" && r2n
          ? `(${l}) BETWEEN min((${rr}), (${nodeSql(ctx, r2n)})) AND max((${rr}), (${nodeSql(ctx, r2n)}))`
          : `(${l}) ${CMP_SQL[cmp]} (${rr})`;
      condCount++;
      const compiled: CompiledRow = { sql, params: [] };
      // Cheap pre-filter: both sides reference only snapshot columns.
      if (isScalarOnly(ln) && isScalarOnly(rn) && (r2n === null || isScalarOnly(r2n))) {
        const cheapCtx: FeatCtx = { d: new Map(), w: new Map(), needsD: false, needsW: false, aliasSeq: 0 };
        const cl = nodeSql(cheapCtx, ln);
        const cr = nodeSql(cheapCtx, rn);
        if (cheapCtx.d.size + cheapCtx.w.size === 0) {
          const cheapSql =
            cmp === "between" && r2n
              ? `(${cl}) BETWEEN min((${cr}), (${nodeSql(cheapCtx, r2n)})) AND max((${cr}), (${nodeSql(cheapCtx, r2n)}))`
              : `(${cl}) ${CMP_SQL[cmp]} (${cr})`;
          pushCompiled(groups, compiled, { sql: cheapSql, params: [] }, r.logic);
          return;
        }
      }
      pushCompiled(groups, compiled, null, r.logic);
      return;
    }

    const compiled = compileFieldRow(raw as FieldRowWire);
    if (!compiled) return;
    condCount++;
    pushCompiled(groups, compiled, { sql: compiled.sql, params: compiled.params }, (raw as FieldRowWire).logic);
  });
  return { groups, condCount };
}

function pushCompiled(groups: Group[], compiled: CompiledRow, cheap: CompiledRow | null, logic: unknown): void {
  const isOr = logic === "or" && groups.length > 0;
  if (isOr) groups.push({ all: [compiled], cheap: cheap ? [cheap] : [] });
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
  restrictSymbols: string[] | null
): CompiledProQuery {
  const ctx: FeatCtx = { d: new Map(), w: new Map(), needsD: false, needsW: false, aliasSeq: 0 };
  const { groups, condCount } = groupRows(rows, ctx);

  // WHERE assembly
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.sector && opts.sector !== "all") {
    conds.push(`st."sector" = ?`);
    params.push(opts.sector);
  }
  if (groups.length === 1) {
    for (const g of groups[0].all) {
      conds.push(g.sql);
      params.push(...g.params);
    }
  } else if (groups.length > 1) {
    const groupSql = groups.map((g) =>
      g.all.length === 1 ? g.all[0].sql : `(${g.all.map((x) => x.sql).join(" AND ")})`
    );
    for (const g of groups) for (const x of g.all) params.push(...x.params);
    conds.push(`(${groupSql.join(" OR ")})`);
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
        `\n  FROM DailyBar WHERE 1=1${cutoffs.d ? ` AND date >= ?` : ""}${inClause}),`
    );
    ctes.push(`dLast AS (SELECT * FROM dRaw WHERE rnD = 1),`);
  }
  if (ctx.needsW) {
    ctes.push(
      `wRaw AS (SELECT symbol, strftime('%Y-%W', date) AS wk, open, high, low, close, volume,\n` +
        `       ROW_NUMBER() OVER (PARTITION BY symbol, strftime('%Y-%W', date) ORDER BY date) AS rnW,\n` +
        `       COUNT(*) OVER (PARTITION BY symbol, strftime('%Y-%W', date)) AS nW\n` +
        `  FROM DailyBar WHERE 1=1${cutoffs.w ? ` AND date >= ?` : ""}${inClause}),`
    );
    ctes.push(
      `wAgg AS (SELECT symbol, wk,\n` +
        `       MAX(CASE WHEN rnW = 1 THEN open END) AS open,\n` +
        `       MAX(high) AS high, MIN(low) AS low,\n` +
        `       MAX(CASE WHEN rnW = nW THEN close END) AS close,\n` +
        `       SUM(volume) AS volume\n` +
        `  FROM wRaw GROUP BY symbol, wk),`
    );
    ctes.push(
      `wF AS (SELECT symbol, wk, open, high, low, close, volume,\n` +
        `       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY wk DESC) AS rnD${ctx.w.size ? "," : ""}\n` +
        [...ctx.w.values()].map((f) => `       ${f.def} AS ${f.alias}`).join(",\n") +
        `\n  FROM wAgg),`
    );
    ctes.push(`wLast AS (SELECT * FROM wF WHERE rnD = 1)`);
  }

  const withClause = ctes.length ? `WITH ${ctes.join("\n")}` : "";
  const joins = [
    ctx.needsD ? `JOIN dLast d ON d."symbol" = st."symbol"` : "",
    ctx.needsW ? `JOIN wLast w ON w."symbol" = st."symbol"` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const whereAll = [...conds, `st."price" IS NOT NULL`].filter(Boolean).join("\n  AND ");

  const dir = opts.dir === "asc" ? "ASC" : "DESC";
  const sort = (PRO_SORTS as readonly string[]).includes(opts.sort) ? opts.sort : "marketCap";
  const orderBy =
    sort === "marketCap"
      ? `ORDER BY st."marketCap" ${dir}`
      : `ORDER BY st."${sort}" ${dir}, st."marketCap" DESC`;

  const sql = [
    withClause,
    `SELECT st."symbol" AS symbol`,
    `FROM Stock st`,
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
    .$queryRawUnsafe(`SELECT date FROM DailyBar GROUP BY date ORDER BY date DESC LIMIT 1 OFFSET ?`, sessions)
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
  opts: ProQueryOpts
): Promise<string[]> {
  const key = JSON.stringify([rows, opts]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.symbols;
  }

  // Probe compile: validates every row (throws ProCompileError) and learns
  // which CTEs the expressions need + how deep the lookbacks run.
  const probe = compileProQuery(rows, opts, { d: null, w: null }, null);

  // Candidate pre-filter from the snapshot-only rows (union across OR-groups).
  // The active sector filter also narrows candidates — include it here so
  // sector-scoped pro screens get the indexed scan too.
  let restrict: string[] | null = null;
  const { groups } = groupRows(rows, { d: new Map(), w: new Map(), needsD: false, needsW: false, aliasSeq: 0 });
  if (groups.length > 0) {
    const sectorCond: CompiledRow | null =
      opts.sector && opts.sector !== "all"
        ? { sql: `st."sector" = ?`, params: [opts.sector] }
        : null;
    const groupConds = groups.map((g) =>
      sectorCond ? [...g.cheap, sectorCond] : g.cheap
    );
    const usable = groupConds.filter((c) => c.length > 0);
    if (usable.length === groupConds.length) {
      // Every OR-group has at least one snapshot condition → the union of
      // their matches is a safe superset of the final result.
      const unionSql = `SELECT st."symbol" AS symbol FROM Stock st WHERE ${usable
        .map((c) => (c.length === 1 ? c[0].sql : `(${c.map((x) => x.sql).join(" AND ")})`))
        .join(" OR ")}`;
      const unionParams = usable.flatMap((c) => c.flatMap((x) => x.params));
      const cand = (await client.$queryRawUnsafe(unionSql, ...unionParams)) as { symbol: unknown }[];
      const symbols = cand.map((r) => String(r.symbol));
      if (symbols.length === 0) return [];
      if (symbols.length <= RESTRICT_MAX) restrict = symbols;
    }
  }

  const cutoffs: Cutoffs = { d: null, w: null };
  if (probe.needsD && probe.sessionsD > 0) cutoffs.d = await cutoffFor(client, probe.sessionsD);
  if (probe.needsW && probe.sessionsW > 0) cutoffs.w = await cutoffFor(client, probe.sessionsW);

  const compiled = compileProQuery(rows, opts, cutoffs, restrict);
  const out = await client.$queryRawUnsafe(compiled.sql, ...compiled.params);
  const symbols = (out as { symbol: unknown }[]).map((r) => String(r.symbol));

  cache.delete(key);
  cache.set(key, { at: Date.now(), symbols });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return symbols;
}
