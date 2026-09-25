/**
 * Inspect sector distribution + closes coverage for the sector momentum feature.
 * Run: bun scripts/inspect-sectors.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const groups = await db.stock.groupBy({
    by: ["sector"],
    where: { sector: { not: null, notIn: ["Unknown"] } },
    _count: { symbol: true },
    _max: { marketCap: true },
  });
  console.log("sector | stocks | maxMcap(Cr)");
  for (const g of groups.sort((a, b) => b._count.symbol - a._count.symbol)) {
    console.log(`${g.sector} | ${g._count.symbol} | ${Math.round((g._max.marketCap ?? 0) / 1e7)}`);
  }

  // closes coverage among top-mcap stocks of each sector
  const sectors = groups.map((g) => g.sector as string);
  let withCloses = 0;
  let without = 0;
  for (const s of sectors) {
    const top = await db.stock.findMany({
      where: { sector: s, marketCap: { not: null } },
      orderBy: { marketCap: "desc" },
      take: 15,
      select: { symbol: true, closes: true },
    });
    for (const t of top) {
      if (t.closes && t.closes.length > 500) withCloses++;
      else without++;
    }
  }
  console.log(`\ntop-15 per sector: ${withCloses} with 2y closes, ${without} without`);
}
main().finally(() => process.exit(0));
