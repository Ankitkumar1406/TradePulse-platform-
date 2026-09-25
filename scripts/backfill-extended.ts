/**
 * Backfill — compute the Task 25 extended indicator columns (weekly RSI/MACD,
 * Bollinger %B & width, EMA cross, price-vs-MA distances) for every stock that
 * already has a stored close series. The daily sync covers new data going
 * forward; this one-off fills the existing rows.
 *
 * Run: bun scripts/backfill-extended.ts
 */
import { PrismaClient } from "@prisma/client";
import { computeExtendedIndicators } from "../src/lib/indicators";

const db = new PrismaClient();

async function main() {
  const stocks = await db.stock.findMany({
    where: { closes: { not: null } },
    select: { symbol: true, closes: true },
    orderBy: { marketCap: "desc" },
  });
  console.log(`Backfilling extended indicators for ${stocks.length} stocks…`);

  let done = 0;
  const batch: Promise<unknown>[] = [];
  const flush = async () => {
    await Promise.all(batch.splice(0, batch.length));
  };

  for (const s of stocks) {
    let series: [number, number][];
    try {
      series = JSON.parse(s.closes as string);
    } catch {
      continue;
    }
    if (!Array.isArray(series) || series.length < 30) continue;
    const ext = computeExtendedIndicators(series);
    batch.push(db.stock.update({ where: { symbol: s.symbol }, data: ext }));
    done++;
    if (batch.length >= 100) await flush();
  }
  await flush();
  console.log(`Done — updated ${done} stocks.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
