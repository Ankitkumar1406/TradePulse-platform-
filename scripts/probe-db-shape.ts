/** Probe: DailyBar data volume + history depth for pro-expression lookbacks. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const t0 = Date.now();
  const [cnt]: { n: unknown }[] = await db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "DailyBar"`);
  console.log("DailyBar rows:", Number(cnt.n), "(count ms:", Date.now() - t0, ")");

  const range = await db.$queryRawUnsafe<{ mn: string; mx: string }[]>(
    `SELECT MIN(date) AS mn, MAX(date) AS mx FROM "DailyBar"`
  );
  console.log("date range:", range[0]?.mn, "→", range[0]?.mx);

  const dist = await db.$queryRawUnsafe<{ bars: unknown; n: unknown }[]>(
    `SELECT bars, COUNT(*) AS n FROM (
       SELECT symbol, COUNT(*) AS bars FROM "DailyBar" GROUP BY symbol
     ) GROUP BY bars ORDER BY bars`
  );
  const buckets = new Map<number, number>();
  for (const r of dist) {
    const b = Number(r.bars);
    const key = b < 50 ? 50 : b < 100 ? 100 : b < 150 ? 150 : b < 200 ? 200 : b < 250 ? 250 : 500;
    buckets.set(key, (buckets.get(key) ?? 0) + Number(r.n));
  }
  console.log("bars-per-symbol buckets:", Object.fromEntries([...buckets.entries()].sort((a, b) => a[0] - b[0])));

  const [st] = await db.$queryRawUnsafe<{ n: unknown }[]>(`SELECT COUNT(*) AS n FROM "Stock" WHERE price IS NOT NULL`);
  console.log("Stock with price:", Number(st.n));

  // Boolean column raw representation check
  const bools = await db.$queryRawUnsafe<{ aboveSma50: unknown }[]>(
    `SELECT DISTINCT aboveSma50 FROM "Stock" LIMIT 5`
  );
  console.log("distinct aboveSma50 raw values:", bools.map((b) => `${typeof b.aboveSma50}:${String(b.aboveSma50)}`));

  // window timing over whole table
  const t1 = Date.now();
  const w = await db.$queryRawUnsafe<{ symbol: string }[]>(
    `SELECT symbol FROM (
       SELECT symbol, AVG(close) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS s200,
              ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
       FROM "DailyBar"
     ) WHERE rn = 1 AND s200 IS NOT NULL LIMIT 5`
  );
  console.log("full-table 200-SMA window query ms:", Date.now() - t1, "sample:", w.length);
  await db.$disconnect();
}

void main();
