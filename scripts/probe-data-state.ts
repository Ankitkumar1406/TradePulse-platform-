/**
 * Data-state audit for scanner/screener correctness:
 * - latest DailyBar date distribution across universe
 * - Stock.quoteTime / price freshness
 * - a couple of known-liquid names sanity check
 */
import { db } from "../src/lib/db";
import { expectedLatestBarDate } from "../src/lib/bar-sync";

async function main() {
  const expected = await expectedLatestBarDate();
  console.log("expectedLatestBarDate =", expected);

  const dist = await db.$queryRawUnsafe<{ maxDate: string; n: bigint }[]>(
    `SELECT maxDate, COUNT(*) AS n FROM (
       SELECT symbol, MAX(date) AS maxDate FROM DailyBar GROUP BY symbol
     ) GROUP BY maxDate ORDER BY maxDate DESC LIMIT 10`
  );
  console.log("per-symbol MAX(date) distribution:");
  for (const r of dist) console.log(" ", r.maxDate, Number(r.n));

  const qt = await db.$queryRawUnsafe<{ quoteTime: string; n: bigint }[]>(
    `SELECT quoteTime, COUNT(*) AS n FROM Stock WHERE price IS NOT NULL GROUP BY quoteTime ORDER BY quoteTime DESC LIMIT 8`
  );
  console.log("Stock.quoteTime distribution (top):");
  for (const r of qt) console.log(" ", r.quoteTime, Number(r.n));

  const stocks = await db.stock.findMany({
    where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK", "INFY"] } },
    select: { symbol: true, price: true, changePct: true, quoteTime: true, fromHighPct: true },
  });
  console.log("liquid names:", JSON.stringify(stocks, null, 1));

  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
