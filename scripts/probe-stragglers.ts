/** Verify: for stragglers, does Yahoo itself have a newer bar than stored? */
import { PrismaClient } from "@prisma/client";
import { fetchChart } from "../src/lib/yahoo";
import { chartToRows } from "../src/lib/bar-sync";

const db = new PrismaClient();

async function main() {
  const stragglers = await db.$queryRawUnsafe<{ symbol: string; d: string }[]>(
    `SELECT b.symbol, MAX(b.date) AS d FROM DailyBar b GROUP BY b.symbol HAVING d < '2026-09-25' ORDER BY d ASC LIMIT 12`
  );
  for (const { symbol, d } of stragglers) {
    try {
      const chart = await fetchChart(symbol, "5d");
      const rows = chartToRows(symbol, chart);
      const yahooLast = rows.length ? rows[rows.length - 1].date : "none";
      const ok = yahooLast === d ? "OK (yahoo has no newer bar)" : "MISMATCH — should refetch";
      console.log(`${symbol.padEnd(16)} stored: ${d}  yahoo-last: ${yahooLast}  ${ok}`);
    } catch (e) {
      console.log(`${symbol.padEnd(16)} stored: ${d}  fetch failed: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

main().finally(() => db.$disconnect());
