/**
 * One-shot backfill of quarterly financials (EPS growth YoY, revenue QoQ,
 * 3Y net-income CAGR) for every stock missing them — uses the same
 * fetchFinancials helper as the runtime trickle but with modest concurrency
 * so the first pass finishes in minutes instead of hours.
 *
 *   bun scripts/backfill-financials.ts
 */
import { PrismaClient } from "@prisma/client";
import { fetchFinancials } from "../src/lib/yahoo";

const db = new PrismaClient();

async function main() {
  const pending = await db.stock.findMany({
    where: { financialsSynced: null },
    select: { symbol: true },
    orderBy: { marketCap: "desc" },
  });
  console.log(`[backfill-financials] ${pending.length} stocks to fetch`);
  const CONCURRENCY = 5;
  let done = 0, got = 0;
  const t0 = Date.now();

  async function worker(queue: string[]) {
    for (;;) {
      const sym = queue.shift();
      if (!sym) return;
      const f = await fetchFinancials(sym).catch(() => null);
      const data: Record<string, unknown> = { financialsSynced: new Date() };
      if (f?.epsQuarterlyGrowth != null) { data.epsQuarterlyGrowth = f.epsQuarterlyGrowth; }
      if (f?.revenueQoQGrowth != null) { data.revenueQoQGrowth = f.revenueQoQGrowth; }
      if (f?.netIncome3YCagr != null) { data.netIncome3YCagr = f.netIncome3YCagr; }
      if (f?.epsQuarterlyGrowth != null || f?.revenueQoQGrowth != null || f?.netIncome3YCagr != null) got++;
      try {
        await db.stock.update({ where: { symbol: sym }, data });
      } catch (e) {
        console.error(`  update failed for ${sym}:`, e instanceof Error ? e.message.split("\n")[0] : e);
      }
      done++;
      if (done % 100 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done}/${pending.length} (got data for ${got}) — ${rate.toFixed(1)}/s`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const queue = pending.map((p) => p.symbol);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log(`[backfill-financials] done — ${done} processed, ${got} with data in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await db.$disconnect();
}

main();
