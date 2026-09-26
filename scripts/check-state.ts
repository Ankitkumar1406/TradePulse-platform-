import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const [barMax, stockCount, syncs] = await Promise.all([
    db.dailyBar.aggregate({ _max: { date: true } }),
    db.stock.count(),
    db.syncState.findMany(),
  ]);
  console.log("latest bar date:", barMax._max.date);
  console.log("stocks:", stockCount);
  console.log("syncState:", JSON.stringify(syncs, null, 1).slice(0, 800));
  const picks = ["SHANTIGOLD.NS", "ARTEMISMED.NS", "GNA.NS"];
  const rows = await db.stock.findMany({
    where: { symbol: { in: picks } },
    select: { symbol: true, name: true, price: true, marketCap: true },
  });
  console.log("key stocks:", JSON.stringify(rows));
  const price30 = await db.stock.count({ where: { price: { gte: 30 } } });
  const mcapNull = await db.stock.count({ where: { marketCap: null } });
  console.log("stocks price>=30:", price30, "| marketCap null:", mcapNull);
  await db.$disconnect();
}
main();
