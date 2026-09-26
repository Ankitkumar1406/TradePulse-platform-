/** v2 compile checks for the rebuilt condition builder (run: bun run scripts/probe-v2.ts) */
import {
  compileProQuery,
  isV2Payload,
  ProCompileError,
  type ProRowWire,
} from "../src/lib/pro-sql";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const OPTS = { sector: "all", sort: "marketCap", dir: "desc" as const };
const compile = (rows: ProRowWire[], semantics: "legacy" | "v2") =>
  compileProQuery(rows, OPTS, { d: null, w: null }, null, semantics);

console.log("— payload detection");
ok("isV2Payload true", isV2Payload({ v: 2, rows: [] }));
ok("isV2Payload false for array", !isV2Payload([]));
ok("isV2Payload false for junk", !isV2Payload({ v: 3, rows: [] }));

console.log("— AND-of-OR vs OR-of-AND semantics (A AND B OR C)");
// Chips: A —AND— B —OR— C  (chip stored on the later row)
const rowsABC: ProRowWire[] = [
  { kind: "expr", cmp: "gt", l: "close", r: "50", logic: "and" },
  { kind: "expr", cmp: "gt", l: "rsi14", r: "60", logic: "and" },
  { kind: "expr", cmp: "gt", l: "volume", r: "1000", logic: "or" },
];
const legacySql = compile(rowsABC, "legacy").sql;
const v2Sql = compile(rowsABC, "v2").sql;
// legacy: a row with logic:"or" starts a new AND-branch → (A∧B) ∨ C
ok(
  "legacy = (A∧B) ∨ C",
  legacySql.includes('((d."close") > (50.0) AND (st."rsi14") > (60.0)) OR (d."volume") > (1000.0)'),
  legacySql
);
// v2: AND chips split OR-boxes → A ∧ (B∨C) — exactly what the amber boxes read
ok(
  "v2 = A ∧ (B∨C)",
  v2Sql.includes('(d."close") > (50.0) AND ((st."rsi14") > (60.0) OR (d."volume") > (1000.0))'),
  v2Sql
);

console.log("— single group v2 (all-OR chain)");
const allOr = compile(
  [
    { kind: "expr", cmp: "gt", l: "close", r: "10", logic: "and" },
    { kind: "expr", cmp: "gt", l: "close", r: "20", logic: "or" },
  ],
  "v2"
).sql;
ok("all-OR stays one group joined by OR", allOr.includes('(d."close") > (10.0) OR (d."close") > (20.0)'), allOr);

console.log("— crosses desugar");
const cross = compile(
  [{ kind: "expr", cmp: "crossAbove", l: "close", r: "sma(close, 50)", logic: "and" }],
  "v2"
);
ok("cross emits main + prev comparison", /"close"\) > .+ AND .+ <= /.test(cross.sql.replace(/\s+/g, " ")), cross.sql);
ok("prev sma window ends one bar back", cross.sql.includes("50 PRECEDING AND 1 PRECEDING"), cross.sql);
ok("prev close via LAG", cross.sql.includes('LAG("close", 1)'), cross.sql);
ok("daily CTE engaged", cross.needsD && !cross.needsW);

console.log("— crosses on weekly series shift weekly candles");
const crossW = compile(
  [{ kind: "expr", cmp: "crossBelow", l: "weekly close", r: "10", logic: "and" }],
  "v2"
);
ok("weekly cross engages weekly CTE", crossW.needsW && crossW.sql.includes("wRaw"), crossW.sql);

console.log("— withinPct desugar");
const within = compile(
  [{ kind: "expr", cmp: "withinPct", l: "close", r: "1 week ago high", pct: "2", logic: "and" }],
  "v2"
);
ok("withinPct emits ABS ratio", within.sql.includes("ABS((") && within.sql.includes("* 100.0 <= 2"), within.sql);
ok("weekly ref works inside withinPct", within.needsW, within.sql);

console.log("— validation errors");
const throws = (rows: ProRowWire[], re: RegExp) => {
  try {
    compile(rows, "v2");
    return false;
  } catch (e) {
    return e instanceof ProCompileError && re.test(e.message);
  }
};
ok("cross on snapshot constants rejected", throws([{ kind: "expr", cmp: "crossAbove", l: "rsi14", r: "30", logic: "and" }], /no previous bar/));
ok("withinPct with pct=0 rejected", throws([{ kind: "expr", cmp: "withinPct", l: "close", r: "50", pct: "0", logic: "and" }], /percent between/));
ok("empty side rejected", throws([{ kind: "expr", cmp: "gt", l: "  ", r: "5", logic: "and" }], /left expression is empty/));

console.log("— user's 66-day breakout screen compiles");
const breakout: ProRowWire[] = [
  { kind: "expr", cmp: "gte", l: "close / min(66, low)", r: "1.30", logic: "and" },
  { kind: "expr", cmp: "gt", l: "marketCap / 10000000", r: "0", logic: "and" },
  { kind: "expr", cmp: "gte", l: "close", r: "1", logic: "and" },
  { kind: "expr", cmp: "gt", l: "close * sma(volume, 20)", r: "30000000", logic: "and" },
  { kind: "expr", cmp: "gt", l: "close", r: "sma(close, 200)", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(2 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(3 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lt", l: "1 week ago close", r: "2 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "1 week ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "2 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "3 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "4 weeks ago high", logic: "and" },
];
const bq = compile(breakout, "v2");
ok("compiles without throwing", true);
ok("needs daily + weekly CTEs", bq.needsD && bq.needsW);
ok("condCount 13", bq.condCount === 13, String(bq.condCount));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
