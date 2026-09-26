/**
 * Probe 2: optimize the pro-query hot path.
 * Variants: (A) current shared cutoff · (B) split daily/weekly cutoffs ·
 * (C) B + symbol IN candidate restriction · (D) C + pragmas in a transaction.
 * Run: bun run scripts/probe-pro-expr-2.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DAILY_FEATS = [
  `MIN("low") OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 65 PRECEDING AND CURRENT ROW) AS f0`,
  `AVG("volume") OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS f1`,
  `AVG("close") OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS f2`,
];
const WEEKLY_FEATS = [
  `LAG("close", 1) OVER (PARTITION BY symbol ORDER BY wk) AS f3`,
  `LAG("close", 2) OVER (PARTITION BY symbol ORDER BY wk) AS f4`,
  `LAG("close", 3) OVER (PARTITION BY symbol ORDER BY wk) AS f5`,
  `LAG("close", 4) OVER (PARTITION BY symbol ORDER BY wk) AS f6`,
  `LAG("high", 2) OVER (PARTITION BY symbol ORDER BY wk) AS f7`,
  `LAG("high", 1) OVER (PARTITION BY symbol ORDER BY wk) AS f8`,
  `LAG("high", 3) OVER (PARTITION BY symbol ORDER BY wk) AS f9`,
  `LAG("high", 4) OVER (PARTITION BY symbol ORDER BY wk) AS f10`,
];

function buildSql(dCut: string | null, wCut: string | null, symParams: number): { sql: string; nParams: number } {
  const symIn = symParams > 0 ? ` AND symbol IN (${Array.from({ length: symParams }, () => "?").join(",")})` : "";
  const dWhere = dCut ? ` WHERE date >= ?${symIn}` : symIn ? ` WHERE symbol IN (${symIn.slice(6)})` : "";
  const wWhere = wCut ? ` WHERE date >= ?${symIn}` : dWhere ? ` WHERE ${dWhere.slice(7)}` : "";
  void wWhere;
  const sql = `WITH
dRaw AS (SELECT symbol, date, open, high, low, close, volume,
       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rnD,
       ${DAILY_FEATS.join(",\n       ")}
  FROM DailyBar${dCut ? ` WHERE date >= ?` : ""}${symParams ? ` AND symbol IN (${Array.from({ length: symParams }, () => "?").join(",")})` : ""}),
dLast AS (SELECT * FROM dRaw WHERE rnD = 1),
wRaw AS (SELECT symbol, strftime('%Y-%W', date) AS wk, open, high, low, close, volume,
       ROW_NUMBER() OVER (PARTITION BY symbol, strftime('%Y-%W', date) ORDER BY date) AS rnW,
       COUNT(*) OVER (PARTITION BY symbol, strftime('%Y-%W', date)) AS nW
  FROM DailyBar${wCut ? ` WHERE date >= ?` : ""}${symParams ? ` AND symbol IN (${Array.from({ length: symParams }, () => "?").join(",")})` : ""}),
wAgg AS (SELECT symbol, wk,
       MAX(CASE WHEN rnW = 1 THEN open END) AS open,
       MAX(high) AS high, MIN(low) AS low,
       MAX(CASE WHEN rnW = nW THEN close END) AS close,
       SUM(volume) AS volume
  FROM wRaw GROUP BY symbol, wk),
wF AS (SELECT symbol, wk, open, high, low, close, volume,
       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY wk DESC) AS rnD,
       ${WEEKLY_FEATS.join(",\n       ")}
  FROM wAgg),
wLast AS (SELECT * FROM wF WHERE rnD = 1)
SELECT st."symbol" AS symbol
FROM Stock st
JOIN dLast d ON d."symbol" = st."symbol"
JOIN wLast w ON w."symbol" = st."symbol"
WHERE ((d."close" / d."f0")) >= (1.3)
  AND ((d."close" * d."f1")) > (30000000.0)
  AND (d."close") > (d."f2")
  AND (ABS((((w."f3" - w."f4") / w."f4") * 100.0))) <= (6.0)
  AND (ABS((((w."f4" - w."f5") / w."f5") * 100.0))) <= (6.0)
  AND (ABS((((w."f5" - w."f6") / w."f6") * 100.0))) <= (6.0)
  AND (w."f3") < (w."f7")
  AND (w."high") >= (w."f8")
  AND (w."high") >= (w."f7")
  AND (w."high") >= (w."f9")
  AND (w."high") >= (w."f10")
  AND st."price" IS NOT NULL
ORDER BY st."marketCap" DESC`;
  return { sql, nParams: (dCut ? 1 : 0) + (wCut ? 1 : 0) + symParams * 2 };
}

async function timeRun(label: string, sql: string, params: unknown[], pragmas = false) {
  const t0 = Date.now();
  let rows: unknown[];
  if (pragmas) {
    await db.$transaction([
      db.$queryRawUnsafe(`PRAGMA temp_store = MEMORY`),
      db.$queryRawUnsafe(`PRAGMA cache_size = -131072`),
      db.$queryRawUnsafe(sql, ...params),
    ]);
    rows = [];
  } else {
    rows = (await db.$queryRawUnsafe(sql, ...params)) as unknown[];
  }
  console.log(`${label}: ${Date.now() - t0}ms → ${rows.length || "?"} rows`);
  return Date.now() - t0;
}

async function cutoffFor(sessions: number): Promise<string | null> {
  const r = await db.$queryRawUnsafe<{ date: string }[]>(
    `SELECT date FROM DailyBar GROUP BY date ORDER BY date DESC LIMIT 1 OFFSET ?`,
    sessions
  );
  return r[0]?.date ?? null;
}

async function main() {
  // candidate symbols for the cheap part (mcap > 0, price >= 1) — simulate a realistic candidate set
  const cheap = await db.stock.findMany({
    where: { marketCap: { gt: 0 }, price: { gte: 1 } },
    select: { symbol: true },
    orderBy: { marketCap: "desc" },
    take: 800,
  });
  const syms = cheap.map((c) => c.symbol);
  console.log("candidate symbols:", syms.length);

  const dCut = await cutoffFor(209);
  const wCut = await cutoffFor(45);
  console.log("cutoffs:", dCut, wCut);

  const a = buildSql(dCut, dCut, 0);           // A: shared cutoff (current impl)
  const b = buildSql(dCut, wCut, 0);           // B: split cutoffs
  const c = buildSql(dCut, wCut, syms.length); // C: split + candidate IN

  const paramsA = [dCut, dCut];
  const paramsB = [dCut, wCut];
  const paramsC = [dCut, ...syms, wCut, ...syms];

  await timeRun("A shared-cutoff (warm-up)", a.sql, paramsA);
  await timeRun("A shared-cutoff", a.sql, paramsA);
  await timeRun("B split-cutoffs", b.sql, paramsB);
  await timeRun("B again", b.sql, paramsB);
  await timeRun("C split + IN(800)", c.sql, paramsC);
  await timeRun("C again", c.sql, paramsC);
  await timeRun("D C + pragmas(tx)", c.sql, paramsC, true);
  await timeRun("D again", c.sql, paramsC, true);

  // IN-list sanity: does the result set match the unrestricted run?
  const rA = (await db.$queryRawUnsafe(a.sql, ...paramsA)) as { symbol: string }[];
  const rC = (await db.$queryRawUnsafe(c.sql, ...paramsC)) as { symbol: string }[];
  console.log("A rows:", rA.length, "C rows:", rC.length, "C ⊆ top800:", rC.every((r) => syms.includes(r.symbol)));

  await db.$disconnect();
}

void main();
