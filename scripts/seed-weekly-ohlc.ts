/**
 * Seed the weekly OHLC columns (wOpen/wHigh/wLow/wClose) for every stock from
 * DailyBar — the same computation the bars trickle performs per-symbol, done
 * in one pass so the screener builder's Weekly timeframe works immediately
 * after a recovery/migration instead of waiting for the trickle.
 *
 *   bun --smol scripts/seed-weekly-ohlc.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

interface Row { symbol: string; date: string; open: number; high: number; low: number; close: number }

async function main() {
  const rows = await db.$queryRaw<Row[]>`
    SELECT symbol, date, open, high, low, close FROM (
      SELECT symbol, date, open, high, low, close,
             ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
      FROM "DailyBar"
    )
    WHERE rn <= 10
    ORDER BY symbol, date ASC
  `;

  const bySymbol = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = bySymbol.get(r.symbol);
    if (arr) arr.push(r);
    else bySymbol.set(r.symbol, [r]);
  }

  let updated = 0;
  const entries: { symbol: string; wOpen: number; wHigh: number; wLow: number; wClose: number }[] = [];
  for (const [symbol, bars] of bySymbol) {
    const monday = mondayOf(bars[bars.length - 1].date);
    const wk = bars.filter((b) => b.date >= monday);
    if (wk.length === 0) continue;
    entries.push({
      symbol,
      wOpen: wk[0].open,
      wHigh: Math.max(...wk.map((b) => b.high)),
      wLow: Math.min(...wk.map((b) => b.low)),
      wClose: wk[wk.length - 1].close,
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await db.$transaction(entries.slice(i, i + CHUNK).map((e) => db.stock.update({ where: { symbol: e.symbol }, data: e })));
    updated += Math.min(CHUNK, entries.length - i);
  }
  console.log(`[seed-weekly-ohlc] updated ${updated} stocks`);
  await db.$disconnect();
}
main();
