/**
 * One-time backfill: populate Stock.indGrp / Stock.subGrp for the whole
 * universe from src/lib/taxonomy.ts (symbol overrides -> Yahoo industry map
 * -> sector fallback), matching bananapatterns.com/market/rotation's
 * industry / subgroup hierarchy.
 */
import { PrismaClient } from "@prisma/client";
import { resolveTaxonomy } from "../src/lib/taxonomy";

const db = new PrismaClient();

async function main() {
  const stocks = await db.stock.findMany({
    select: { symbol: true, sector: true, industry: true },
  });
  let n = 0;
  const grps = new Set<string>();
  const subs = new Set<string>();
  for (const s of stocks) {
    const t = resolveTaxonomy(s.symbol, s.sector, s.industry);
    await db.stock.update({
      where: { symbol: s.symbol },
      data: { indGrp: t.grp, subGrp: t.sub },
    });
    grps.add(t.grp);
    subs.add(t.sub);
    n++;
    if (n % 500 === 0) console.log(`  ${n}/${stocks.length}`);
  }
  console.log(`backfilled ${n} stocks · ${grps.size} industries · ${subs.size} subgroups`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
