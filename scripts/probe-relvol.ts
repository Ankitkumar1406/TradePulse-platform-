/** Probe: 20-session avg volume (excluding latest stored session) for a few symbols. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const symbols = ["RELIANCE.NS", "TATAMOTORS.NS", "SHANTIGOLD.NS", "GNA.NS"];

async function main() {
  const t0 = Date.now();
  const rows: { symbol: string; avgVol: unknown; n: unknown }[] = await db.$queryRawUnsafe(
    `SELECT symbol, AVG(volume) AS avgVol, COUNT(*) AS n
       FROM (SELECT symbol, date, volume,
                    ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
               FROM "DailyBar" WHERE symbol IN (${symbols.map(() => "?").join(",")}))
      WHERE rn BETWEEN 2 AND 21
      GROUP BY symbol`,
    ...symbols
  );
  console.log("query ms:", Date.now() - t0);
  for (const r of rows) {
    console.log(r.symbol, "avgVol:", Number(r.avgVol).toFixed(0), "sessions:", Number(r.n));
  }

  const latest: { symbol: string; d: string }[] = await db.$queryRawUnsafe(
    `SELECT symbol, MAX(date) AS d FROM "DailyBar" WHERE symbol IN (${symbols.map(() => "?").join(",")}) GROUP BY symbol`,
    ...symbols
  );
  console.log("latest stored session per symbol:", latest);
  await db.$disconnect();
}

void main();
