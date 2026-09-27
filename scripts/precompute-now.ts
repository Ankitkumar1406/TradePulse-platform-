/// <reference types="bun-types" />
/**
 * Ops tool: run the post-ingest precompute pipeline right now.
 *   bun run scripts/precompute-now.ts [--force]
 *
 * --force recomputes stock_metrics for the current EOD session even if it
 * already exists (scan results are always recomputed for the session).
 */
import { runPostSyncPipeline } from "../src/lib/pipeline";
import { db } from "../src/lib/db";

const force = process.argv.includes("--force");

async function main() {
  const out = await runPostSyncPipeline({ force });
  console.log("metrics:", out.metrics);
  if (out.scans) console.log("scans:", out.scans);
  const state = await db.syncState.findUnique({ where: { id: "main" } });
  console.log("SyncState:", {
    metricsDate: state?.metricsDate,
    scansDate: state?.scansDate,
    lastIngestAt: state?.lastIngestAt,
  });
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
