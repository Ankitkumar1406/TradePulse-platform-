/**
 * Task 47 ops sweep — repair the poisoned scan cache and the universe:
 *
 *  1. Purge NSE test instruments (011NSETEST.NS …) — they leak through the
 *     Yahoo screener payload, carry prices, and render as garbage screener
 *     rows. Bars/metrics/stock rows all removed (no FKs between them).
 *  2. Drop every cached ScanResult row — all 39 were precomputed during the
 *     PostgreSQL migration while `ORDER BY marketCap DESC` still sorted
 *     NULLS FIRST, so scanner candidate pools (TC1/TC3/TC4 cached 0 rows)
 *     and the rows themselves are wrong. They are re-precomputed in-process
 *     right after, with the fixed nulls-last ordering.
 *
 * Run standalone in the foreground; safe to re-run (idempotent).
 */
/// <reference types="bun-types" />
import { db } from "../src/lib/db";
import { precomputeAllScans } from "../src/lib/pipeline";

const JUNK = /NSETEST/i;

async function main() {
  const junkStocks = await db.stock.findMany({ where: { symbol: { contains: "NSETEST" } }, select: { symbol: true } });
  const junkSymbols = junkStocks.map((s) => s.symbol).filter((s) => JUNK.test(s));
  if (junkSymbols.length > 0) {
    const bars = await db.dailyBar.deleteMany({ where: { symbol: { in: junkSymbols } } });
    const metrics = await db.stockMetrics.deleteMany({ where: { symbol: { in: junkSymbols } } });
    const stocks = await db.stock.deleteMany({ where: { symbol: { in: junkSymbols } } });
    console.log(`[junk] removed ${stocks.count} test stocks (${bars.count} bars, ${metrics.count} metric rows)`);
  } else {
    console.log("[junk] no test symbols in universe");
  }

  // watchlist hygiene: drop entries pointing at now-absent symbols
  const wl = await db.watchlistItem.findMany({ select: { id: true, symbol: true } });
  const known = new Set(
    (await db.stock.findMany({ select: { symbol: true } })).map((s) => s.symbol)
  );
  const dead = wl.filter((w) => !known.has(w.symbol));
  for (const d of dead) await db.watchlistItem.delete({ where: { id: d.id } }).catch(() => {});
  if (dead.length) console.log(`[watchlist] dropped ${dead.length} dead entries`);

  const dropped = await db.scanResult.deleteMany({});
  console.log(`[cache] dropped ${dropped.count} cached scan results`);

  const t0 = Date.now();
  const out = await precomputeAllScans();
  console.log(
    `[cache] recomputed ${out.computed} scans (${out.failed} failed) for ${out.date} in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );

  await db.$disconnect();
  process.exit(out.failed > 0 ? 1 : 0);
}

main();
