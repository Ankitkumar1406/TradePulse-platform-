/**
 * Probe 3: index-streaming vs date-cutoff for the daily feature CTE.
 * Run: bun run scripts/probe-pro-expr-3.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DAILY_FEATS = [
  `MIN("low") OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 65 PRECEDING AND CURRENT ROW) AS f0`,
  `AVG("volume") OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS f1`,
  `AVG("close") OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS f2`,
];

function dRawOnly(withCut: boolean, withIn: boolean, syms: string[]): { sql: string; params: unknown[] } {
  const inClause = withIn ? ` AND symbol IN (${syms.map(() => "?").join(",")})` : "";
  const sql = `WITH
dRaw AS (SELECT symbol, date, open, high, low, close, volume,
       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rnD,
       ${DAILY_FEATS.join(",\n       ")}
  FROM "DailyBar" WHERE 1=1${withCut ? ` AND date >= ?` : ""}${inClause}),
dLast AS (SELECT * FROM dRaw WHERE rnD = 1)
SELECT COUNT(*) AS n, AVG(f0) AS a, AVG(f1) AS b, AVG(f2) AS c FROM dLast`;
  return { sql, params: withCut ? ["2025-11-27", ...syms] : [...syms] };
}

async function timeRun(label: string, sql: string, params: unknown[]) {
  const t0 = Date.now();
  const r = (await db.$queryRawUnsafe(sql, ...params)) as Record<string, unknown>[];
  const row = Object.fromEntries(Object.entries(r[0] ?? {}).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]));
  console.log(`${label}: ${Date.now() - t0}ms →`, JSON.stringify(row).slice(0, 120));
}

async function main() {
  const cheap = await db.stock.findMany({
    where: { marketCap: { gt: 0 }, price: { gte: 1 } },
    select: { symbol: true },
    orderBy: { marketCap: "desc" },
    take: 800,
  });
  const syms = cheap.map((c) => c.symbol);

  await timeRun("E cut+IN(800) dRaw only", ...Object.values(dRawOnly(true, true, syms)) as [string, unknown[]]);
  await timeRun("E again", ...Object.values(dRawOnly(true, true, syms)) as [string, unknown[]]);
  await timeRun("F no-cut+IN(800) dRaw only", ...Object.values(dRawOnly(false, true, syms)) as [string, unknown[]]);
  await timeRun("F again", ...Object.values(dRawOnly(false, true, syms)) as [string, unknown[]]);
  await timeRun("G no-cut no-IN (full index stream)", ...Object.values(dRawOnly(false, false, [])) as [string, unknown[]]);
  await timeRun("G again", ...Object.values(dRawOnly(false, false, [])) as [string, unknown[]]);

  // EXPLAIN QUERY PLAN sanity for the IN case
  const plan = (await db.$queryRawUnsafe(
    `EXPLAIN QUERY PLAN SELECT symbol FROM "DailyBar" WHERE symbol IN ('RELIANCE.NS','TCS.NS') ORDER BY symbol, date`
  )) as Record<string, unknown>[];
  console.log("plan IN+ORDER:", plan.map((p) => p.detail));

  await db.$disconnect();
}

void main();
