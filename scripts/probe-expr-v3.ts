/** Probe: pro-expr v3 additions — unit suffixes, pct_change, highest/lowest, pattern rows, base rows. */
import { parseProExpr, expandUnitSuffixes } from "../src/lib/pro-expr";
import { compileProQuery, type ProRowWire } from "../src/lib/pro-sql";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else { fail++; console.error(`FAIL ${name} ${extra}`); }
}

// ---- unit suffixes
ok("3cr", expandUnitSuffixes("3cr") === "30000000", expandUnitSuffixes("3cr"));
ok("50L", expandUnitSuffixes("50L") === "5000000", expandUnitSuffixes("50L"));
ok("1.5k", expandUnitSuffixes("1.5k") === "1500");
ok("2 weeks untouched", expandUnitSuffixes("2 weeks ago close") === "2 weeks ago close");
ok("3cr in expr", parseProExpr("volume - 3cr").ok);
ok("5lac literal", parseProExpr("close * 5lac").ok);

// ---- pct_change desugar
const pc = parseProExpr("pct_change(close, 5)");
ok("pct_change parses", pc.ok);
if (pc.ok) ok("pct_change text", pc.text.includes("candles ago close"), pc.text);
const pcw = parseProExpr("weekly pct_change(close, 1)");
ok("weekly pct_change parses", pcw.ok, pcw.ok ? pcw.text : pcw.error);

// ---- highest / lowest
const hi = parseProExpr("highest(high, 20)");
ok("highest parses", hi.ok, hi.ok ? hi.text : hi.error);
if (hi.ok) ok("highest → max(20, high)", hi.text === "max(20, high)", hi.text);
const lo = parseProExpr("lowest(low, 66)");
ok("lowest parses", lo.ok, lo.ok ? lo.text : lo.error);
if (lo.ok) ok("lowest → min(66, low)", lo.text === "min(66, low)", lo.text);

// ---- pattern rows compile
const rows: ProRowWire[] = [
  { kind: "pattern", pattern: "higherHighs", tf: "w", n: 4, logic: "and" },
  { kind: "expr", cmp: "gt", l: "close", r: "sma(close, 200)", logic: "and" },
];
const compiled = compileProQuery(rows, { sector: "all", sort: "marketCap", dir: "desc" }, { d: null, w: null }, null, "v2");
ok("pattern compiles weekly CTE", compiled.needsW && compiled.needsD); // row 2 needs daily sma
ok("pattern SQL has 4 lags", (compiled.sql.match(/w\."high" >= w\."f/g) ?? []).length === 4, compiled.sql.match(/w\."high"[^()]*>=/g)?.join("|") ?? "");
ok("sessionsW sane", compiled.sessionsW > 20 && compiled.sessionsW <= 510, String(compiled.sessionsW));

// lowerLows daily
const rows2: ProRowWire[] = [{ kind: "pattern", pattern: "lowerLows", tf: "d", n: 3, logic: "and" }];
const c2 = compileProQuery(rows2, { sector: "all", sort: "marketCap", dir: "desc" }, { d: null, w: null }, null, "v2");
ok("lowerLows daily CTE", c2.needsD && !c2.needsW);
ok("lowerLows SQL", c2.sql.includes(`d."low" <= d."f`), "");

// ---- base rows as extra AND groups
const rows3: ProRowWire[] = [{ kind: "expr", cmp: "gt", l: "rsi14", r: "60", logic: "and" }];
const base: ProRowWire[] = [
  { f: "price", op: "gte", v: 20, logic: "and" },
  { f: "marketCap", op: "gte", v: 5e9, logic: "and" },
];
const c3 = compileProQuery(rows3, { sector: "all", sort: "marketCap", dir: "desc" }, { d: null, w: null }, null, "v2", base);
ok("base condCount", c3.condCount === 3, String(c3.condCount));
ok("base in WHERE", c3.sql.includes(`st."price" >=`) && c3.sql.includes(`st."marketCap" >=`));

// ---- division safety
const c4 = compileProQuery([{ kind: "expr", cmp: "gt", l: "(close - 1 candle ago close) / volume", r: "1" }], { sector: "all", sort: "marketCap", dir: "desc" }, { d: null, w: null }, null, "v2");
ok("NULLIF division", c4.sql.includes("NULLIF"), c4.sql.slice(0, 200));

// ---- computed cols
const c5 = compileProQuery(rows3, { sector: "all", sort: "marketCap", dir: "desc", selectColExprs: ["rsi14", "close"] }, { d: null, w: null }, null, "v2");
ok("select cols", c5.sql.includes(`AS "c0"`) && c5.sql.includes(`AS "c1"`));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
