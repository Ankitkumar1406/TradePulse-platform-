/**
 * Rebuild the scan cache after removing the 60-row output cap (and the
 * Trader Choice 5 cap:200 / multi-scan confluence cap:300).
 *
 * Every cached ScanResult row was precomputed while the caps were in place,
 * so its payload tops out at the old limit even though the live code now
 * returns every match. Drop them all and re-precompute the 39 scanners for
 * the current session in the foreground.
 *
 * Run standalone: bun scripts/recompute-scan-cache.ts  (idempotent)
 */
/// <reference types="bun-types" />
import { db } from "../src/lib/db";
import { precomputeAllScans } from "../src/lib/pipeline";
import { SCANS } from "../src/lib/scanners";

async function main() {
  const dropped = await db.scanResult.deleteMany({});
  console.log(`[cache] dropped ${dropped.count} capped scan-result rows`);

  const t0 = Date.now();
  const out = await precomputeAllScans();
  console.log(
    `[cache] recomputed ${out.computed} scans (${out.failed} failed) for ${out.date} in ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );

  // report the new row counts so the uncapped output is visible
  const rows = await db.scanResult.findMany({
    where: { date: out.date ?? undefined },
    select: { scannerId: true, rowCount: true },
    orderBy: { rowCount: "desc" },
  });
  console.log(`[cache] row counts (${rows.length} scans):`);
  for (const r of rows) {
    const name = SCANS.find((s) => s.id === r.scannerId)?.name ?? r.scannerId;
    console.log(`  ${String(r.rowCount ?? 0).padStart(5)}  ${name}`);
  }

  await db.$disconnect();
  process.exit(out.failed > 0 ? 1 : 0);
}

main();
