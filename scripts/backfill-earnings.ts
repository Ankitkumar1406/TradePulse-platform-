/**
 * Backfill earnings dates across the universe.
 *
 * The fetchEarningsDate parser only read the US payload shape
 * (`earningsDate[0].startDate`) while NSE ships `{ raw, fmt }` — so the
 * whole earningsDate column stayed null forever and the Earnings Gap Up /
 * Positive Earnings Reaction scans could never fire. This refetches the
 * calendar for every priced symbol with the fixed parser.
 *
 * Semantics: a transport failure leaves the stored value untouched;
 * a successful empty response clears the (stale estimate) date.
 * Run standalone in the foreground; safe to re-run.
 */
/// <reference types="bun-types" />
import { db, descNullsLast } from "../src/lib/db";
import { fetchEarningsDate } from "../src/lib/yahoo";

const CONCURRENCY = 4;

async function main() {
  const targets = await db.stock.findMany({
    where: { price: { not: null } },
    select: { symbol: true },
    orderBy: descNullsLast("marketCap"),
  });
  console.log(`[earnings] refreshing calendar for ${targets.length} names`);

  let done = 0;
  let filled = 0;
  let cleared = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      const symbol = targets[i].symbol;
      const date = await fetchEarningsDate(symbol).catch(() => undefined);
      if (date !== undefined) {
        await db.stock.update({
          where: { symbol },
          data: { earningsDate: date, earningsSynced: new Date() },
        }).catch(() => {});
        if (date) filled++;
        else cleared++;
      }
      done++;
      if (done % 200 === 0) console.log(`[earnings] ${done}/${targets.length} fetched, ${filled} dated, ${cleared} empty`);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[earnings] DONE: ${filled} dated, ${cleared} empty, of ${targets.length}`);
  await db.$disconnect();
  process.exit(0);
}

main();
