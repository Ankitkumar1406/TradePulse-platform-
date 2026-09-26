/**
 * Recompute the MarketSmith-style ratings (RS rating, EPS score, A/D rating)
 * for the whole universe and store them on Stock rows.
 *
 *   bun scripts/compute-ratings.ts
 */
import { PrismaClient } from "@prisma/client";

// Run the app's ratings module against a standalone Prisma client. The lib
// imports "@/lib/db", so map it through a tiny inline loader instead.
import { recomputeRatings } from "../src/lib/ratings";

const db = new PrismaClient();

async function main() {
  const n = await recomputeRatings();
  console.log(`[compute-ratings] updated ${n} stocks`);
  await db.$disconnect();
}

main();
