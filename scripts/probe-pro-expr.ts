/**
 * Probe: the user's Chartink-style 66-day-breakout screen, end to end.
 * Compiles the exact pro-row payload through pro-sql, runs it against the
 * real DB, times it, and spot-checks one matching symbol's semantics.
 *
 * Run: bun run scripts/probe-pro-expr.ts
 */
import { PrismaClient } from "@prisma/client";
import { proSymbolList, compileProQuery, ProCompileError, ProRowWire } from "../src/lib/pro-sql";

const db = new PrismaClient();

/** The user's requested logic, translated 1:1 into builder rows. */
const CHARTINK_BREAKOUT: ProRowWire[] = [
  // (daily close / daily min(66, daily low) >= 1.30)
  { kind: "expr", cmp: "gte", l: "close / min(66, low)", r: "1.30", logic: "and" },
  // market cap > 0
  { f: "marketCap", op: "gt", v: 0, logic: "and" },
  // daily close >= 1
  { f: "price", op: "gte", v: 1, logic: "and" },
  // daily close * daily sma(daily volume, 20) > 30000000
  { kind: "expr", cmp: "gt", l: "close * sma(volume, 20)", r: "30000000", logic: "and" },
  // daily close > daily sma(daily close, 200)
  { kind: "expr", cmp: "gt", l: "close", r: "sma(close, 200)", logic: "and" },
  // abs(1 week ago "close - 1 candle ago close / 1 candle ago close * 100") <= 6  (weekly calm, weeks 1-3 back)
  { kind: "expr", cmp: "lte", l: "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(2 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(3 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  // 1 week ago close < 2 weeks ago high
  { kind: "expr", cmp: "lt", l: "1 week ago close", r: "2 weeks ago high", logic: "and" },
  // weekly high >= 1..4 weeks ago high
  { kind: "expr", cmp: "gte", l: "weekly high", r: "1 week ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "2 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "3 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "4 weeks ago high", logic: "and" },
];

async function main() {
  console.log("=== compiled SQL (no cutoff, first 60 lines) ===");
  const compiled = compileProQuery(CHARTINK_BREAKOUT, { sector: "all", sort: "marketCap", dir: "desc" }, { d: null, w: null }, null);
  console.log(compiled.sql.split("\n").slice(0, 60).join("\n"));
  console.log("sessionsD:", compiled.sessionsD, "sessionsW:", compiled.sessionsW, "condCount:", compiled.condCount, "needsD/W:", compiled.needsD, compiled.needsW);

  console.log("\n=== run via proSymbolList (cold) ===");
  const t0 = Date.now();
  const symbols = await proSymbolList(db, CHARTINK_BREAKOUT, { sector: "all", sort: "marketCap", dir: "desc" });
  console.log("cold ms:", Date.now() - t0, "matches:", symbols.length);
  console.log("top:", symbols.slice(0, 12).join(", "));

  const t1 = Date.now();
  const again = await proSymbolList(db, CHARTINK_BREAKOUT, { sector: "all", sort: "marketCap", dir: "desc" });
  console.log("cached ms:", Date.now() - t1, "matches:", again.length);

  // ---- semantic spot-check on the top match
  if (symbols.length > 0) {
    const sym = symbols[0];
    const daily = await db.$queryRawUnsafe<{ d: unknown; c: unknown }[]>(
      `SELECT date AS d, close AS c FROM "DailyBar" WHERE symbol = ? ORDER BY date DESC LIMIT 1`,
      sym
    );
    const minLow66 = await db.$queryRawUnsafe<{ m: unknown }[]>(
      `SELECT MIN(low) AS m FROM (SELECT low FROM "DailyBar" WHERE symbol = ? ORDER BY date DESC LIMIT 66)`,
      sym
    );
    const smaVol20 = await db.$queryRawUnsafe<{ m: unknown }[]>(
      `SELECT AVG(volume) AS m FROM (SELECT volume FROM "DailyBar" WHERE symbol = ? ORDER BY date DESC LIMIT 20)`,
      sym
    );
    const weeks = await db.$queryRawUnsafe<{ wk: string; o: unknown; h: unknown; l: unknown; c: unknown }[]>(
      `SELECT wk, MAX(CASE WHEN rnW = 1 THEN open END) AS o, MAX(high) AS h, MIN(low) AS l,
              MAX(CASE WHEN rnW = nW THEN close END) AS c
         FROM (SELECT symbol, strftime('%Y-%W', date) AS wk, date, open, high, low, close, volume,
                      ROW_NUMBER() OVER (PARTITION BY symbol, strftime('%Y-%W', date) ORDER BY date) AS rnW,
                      COUNT(*) OVER (PARTITION BY symbol, strftime('%Y-%W', date)) AS nW
                 FROM "DailyBar" WHERE symbol = ?)
        GROUP BY wk ORDER BY wk DESC LIMIT 6`,
      sym
    );
    const close = Number(daily[0]?.c);
    const m66 = Number(minLow66[0]?.m);
    const sv20 = Number(smaVol20[0]?.m);
    console.log(`\n=== spot-check ${sym} (latest ${daily[0]?.d}) ===`);
    console.log(`close=${close.toFixed(2)} min66Low=${m66.toFixed(2)} ratio=${(close / m66).toFixed(3)} (need >= 1.30)`);
    console.log(`close*smaVol20=${(close * sv20).toFixed(0)} (need > 30000000)`);
    const wArr = weeks.map((w) => ({ wk: w.wk, c: Number(w.c), h: Number(w.h) }));
    console.log("weekly candles (newest first):", wArr.map((w) => `${w.wk}: c=${w.c.toFixed(2)} h=${w.h.toFixed(2)}`).join(" | "));
    for (let i = 1; i <= 3 && i < wArr.length; i++) {
      const chg = ((wArr[i].c - wArr[i + 1].c) / wArr[i + 1].c) * 100;
      console.log(`week -${i}: change% = ${chg.toFixed(2)} (need |chg| <= 6)`);
    }
    for (let i = 1; i <= 4 && i < wArr.length; i++) {
      console.log(`week -0 high ${wArr[0].h.toFixed(2)} >= week -${i} high ${wArr[i].h.toFixed(2)}: ${wArr[0].h >= wArr[i].h}`);
    }
  }

  // ---- error paths
  console.log("\n=== error paths ===");
  try {
    await proSymbolList(db, [{ kind: "expr", cmp: "gte", l: "cloze", r: "1" }], { sector: "all", sort: "marketCap", dir: "desc" });
    console.log("✗ unknown field did not throw");
  } catch (e) {
    console.log("ok throw:", e instanceof ProCompileError ? "[ProCompileError]" : "[other]", (e as Error).message);
  }
  try {
    await proSymbolList(db, [{ kind: "expr", cmp: "gte", l: "close >", r: "1" }], { sector: "all", sort: "marketCap", dir: "desc" });
    console.log("✗ bad syntax did not throw");
  } catch (e) {
    console.log("ok throw:", e instanceof ProCompileError ? "[ProCompileError]" : "[other]", (e as Error).message);
  }

  // ---- boolean IS 1 parity check
  const rawCnt = await db.$queryRawUnsafe<{ n: unknown }[]>(`SELECT COUNT(*) AS n FROM "Stock" WHERE aboveSma50 IS 1`);
  const prmCnt = await db.stock.count({ where: { aboveSma50: true } });
  console.log(`\nboolean parity: raw IS 1 = ${Number(rawCnt[0].n)} vs prisma equals true = ${prmCnt}`);

  // ---- weekly-only screen (no daily join)
  const weeklyOnly: ProRowWire[] = [
    { kind: "expr", cmp: "gte", l: "weekly high", r: "max(10, high)", logic: "and" },
    { kind: "expr", cmp: "gt", l: "weekly close", r: "sma(weekly close, 10)", logic: "and" },
  ];
  const t2 = Date.now();
  const wOnly = await proSymbolList(db, weeklyOnly, { sector: "all", sort: "marketCap", dir: "desc" });
  console.log(`\nweekly-only screen: ${wOnly.length} matches in ${Date.now() - t2}ms — sample: ${wOnly.slice(0, 6).join(", ")}`);

  // ---- scalar-only expression screen (no CTEs at all)
  const scalarOnly: ProRowWire[] = [
    { kind: "expr", cmp: "gte", l: "marketCap", r: "5000000000", logic: "and" },
    { kind: "expr", cmp: "gte", l: "rsRating", r: "80", logic: "and" },
  ];
  const t3 = Date.now();
  const sOnly = await proSymbolList(db, scalarOnly, { sector: "all", sort: "marketCap", dir: "desc" });
  console.log(`scalar-only screen: ${sOnly.length} matches in ${Date.now() - t3}ms — sample: ${sOnly.slice(0, 6).join(", ")}`);

  await db.$disconnect();
}

void main();
