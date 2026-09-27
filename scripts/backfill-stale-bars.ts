/**
 * One-off backfill: top up DailyBar for every symbol whose newest bar is
 * behind the universe's latest synced EOD date (or that has no bars at all).
 * Uses the exact production routine (syncSymbolBars) with a worker pool.
 *
 *   bun run scripts/backfill-stale-bars.ts [--limit N] [--concurrency N]
 */
import { db, toPgSql } from "../src/lib/db";
import { syncSymbolBars, expectedLatestBarDate } from "../src/lib/bar-sync";


const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) || def : def;
};
const CONCURRENCY = arg("concurrency", 8);
const LIMIT = arg("limit", 0); // 0 = no limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const expected = await expectedLatestBarDate();
  if (!expected) {
    console.error("No universe quote data — nothing to sync against.");
    process.exit(1);
  }
  console.log(`expected latest EOD date: ${expected}`);

  const stale = await db.$queryRawUnsafe<{ symbol: string }[]>(
    toPgSql(`SELECT s.symbol
       FROM "Stock" s
       LEFT JOIN (SELECT symbol, MAX(date) AS maxDate FROM "DailyBar" GROUP BY symbol) b
         ON b.symbol = s.symbol
      WHERE s.price IS NOT NULL AND (b.maxDate IS NULL OR b.maxDate < ?)
      ORDER BY s."marketCap" DESC`),
    expected
  );
  const symbols = LIMIT > 0 ? stale.slice(0, LIMIT).map((r) => r.symbol) : stale.map((r) => r.symbol);
  console.log(`stale symbols: ${symbols.length} (concurrency ${CONCURRENCY})`);
  if (symbols.length === 0) return;

  let cursor = 0;
  let ok = 0;
  let failed = 0;
  const failures: string[] = [];
  const t0 = Date.now();

  const worker = async (id: number) => {
    for (;;) {
      const i = cursor++;
      if (i >= symbols.length) return;
      const symbol = symbols[i];
      try {
        const last = await syncSymbolBars(symbol);
        ok++;
        if ((ok + failed) % 100 === 0 || ok + failed === symbols.length) {
          console.log(`  [w${id}] ${ok + failed}/${symbols.length} done (${Date.now() - t0} ms) — last: ${symbol} → ${last}`);
        }
      } catch (e) {
        failed++;
        failures.push(symbol);
        console.error(`  [w${id}] FAILED ${symbol}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      }
      await sleep(60); // gentle pacing between per-symbol fetches
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ok: ${ok}, failed: ${failed}`);
  if (failures.length > 0) console.log("failures:", failures.slice(0, 40).join(", "));

  // residual distribution after backfill
  const dist = await db.$queryRawUnsafe<{ d: string; n: number }[]>(
    `SELECT d, COUNT(*) AS n FROM (SELECT symbol, MAX(date) AS d FROM DailyBar GROUP BY symbol) GROUP BY d ORDER BY d DESC LIMIT 8`
  );
  console.log("per-symbol max date distribution (bars→symbols):");
  for (const r of dist) console.log(" ", r.d, "→", Number(r.n), "symbols");
}

main().finally(() => db.$disconnect());
