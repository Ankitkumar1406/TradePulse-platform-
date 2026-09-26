/**
 * One-off closes/indicators backfill — runs the production closes phase
 * (Yahoo spark 2y → all indicator columns + closes series) as a STANDALONE
 * process, so the dev server never holds the memory pressure that OOM-killed
 * it during the in-process sync (next-server 2.3GB RSS incident).
 *
 *   bun scripts/backfill-closes.ts          # stale/missing only (20h cutoff)
 *   bun scripts/backfill-closes.ts --all    # force every priced stock
 */
import { PrismaClient } from "@prisma/client";

// The lib imports "@/lib/db" — map it through a tiny inline loader.
process.env.TP_STANDALONE = "1";

const { runClosesPhase } = await import("../src/lib/sync");

const db = new PrismaClient();

const all = process.argv.includes("--all");

async function main() {
  const pending = await db.stock.count({
    where: all
      ? { price: { not: null } }
      : { price: { not: null }, OR: [{ closesSynced: null }] },
  });
  console.log(`[backfill-closes] target stocks: ${pending}${all ? " (forced all)" : ""}`);
  const t0 = Date.now();
  await runClosesPhase(all ? { staleCutoff: new Date() } : undefined);
  console.log(`[backfill-closes] done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const [have, total] = await Promise.all([
    db.stock.count({ where: { price: { not: null }, closesSynced: { not: null } } }),
    db.stock.count({ where: { price: { not: null } } }),
  ]);
  console.log(`[backfill-closes] closesSynced coverage: ${have}/${total}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
