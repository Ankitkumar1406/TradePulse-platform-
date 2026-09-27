/**
 * Probe: how stale are DailyBar charts vs the quotes/closes sync?
 *  - global max DailyBar date
 *  - distribution of per-symbol max(date)
 *  - barsSynced distribution
 *  - Stock.closes last point date (the sparkline series syncs daily)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [globalMax, totalSymbols, symbolsWithBars] = await Promise.all([
    db.dailyBar.aggregate({ _max: { date: true } }),
    db.stock.count(),
    db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(DISTINCT symbol) AS n FROM "DailyBar"`),
  ]);
  console.log("global max bar date:", globalMax._max.date, "| stocks:", totalSymbols, "| symbols with bars:", symbolsWithBars[0]?.n);

  const dist = await db.$queryRawUnsafe<{ d: string; n: number }[]>(`
    SELECT MAX(date) AS d, COUNT(*) AS n FROM "DailyBar" GROUP BY symbol ORDER BY d ASC
  `);
  const merged = new Map<string, number>();
  for (const r of dist) merged.set(r.d, (merged.get(r.d) ?? 0) + Number(r.n));
  console.log("\nper-symbol max date distribution:");
  for (const [d, n] of [...merged.entries()].sort()) console.log(" ", d, "→", n, "symbols");

  const stale = await db.$queryRawUnsafe<{ d: string; n: number }[]>(`
    SELECT MAX(date) AS d, COUNT(*) AS n FROM "DailyBar" GROUP BY symbol HAVING MAX(date) < (SELECT MAX(date) FROM "DailyBar")
  `);
  let behind = 0;
  const byDate = new Map<string, number>();
  for (const r of stale) {
    behind += Number(r.n);
    byDate.set(r.d, (byDate.get(r.d) ?? 0) + Number(r.n));
  }
  console.log("\nsymbols behind global max:", behind);
  console.log("...by their last date:", JSON.stringify([...byDate.entries()].sort(), null, 0));

  // mainboard / liquid only view (mcap >= 100 Cr) — the names users actually open
  const liq = await db.$queryRawUnsafe<{ s: string; d: string; name: string }[]>(`
    SELECT b.symbol AS s, MAX(b.date) AS d FROM "DailyBar" b
    JOIN "Stock" st ON st.symbol = b.symbol
    WHERE st."marketCap" >= 100000000
    GROUP BY b.symbol HAVING d < (SELECT MAX(date) FROM "DailyBar") LIMIT 30
  `);
  console.log("\nsample liquid names behind max:", liq.length);
  for (const r of liq.slice(0, 12)) console.log("  ", r.s, "last bar:", r.d);

  // closes series freshness (Stock.closes JSON last timestamp) for the same view
  const barsSynced = await db.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(*) AS n FROM "Stock" WHERE barsSynced IS NULL
  `);
  console.log("\nstocks with barsSynced NULL:", barsSynced[0]?.n);

  const syn = await db.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(*) AS n FROM "Stock" s
    WHERE s."marketCap" >= 100000000
      AND s.closes IS NOT NULL
      AND json_extract(s.closes, '$[last - 1][0]') IS NOT NULL
      AND date(json_extract(s.closes, '$[last - 1][0]'), 'unixepoch') < (SELECT MAX(date) FROM "DailyBar")
  `);
  console.log("liquid stocks whose closes series ends before global max bar date:", syn[0]?.n);

  const maxClose = await db.$queryRawUnsafe<{ d: string }[]>(`
    SELECT date(MAX(json_extract(closes, '$[last - 1][0]')), 'unixepoch') AS d FROM "Stock" WHERE closes IS NOT NULL
  `);
  console.log("newest closes timestamp across stocks:", maxClose[0]?.d);
}

main().finally(() => db.$disconnect());
