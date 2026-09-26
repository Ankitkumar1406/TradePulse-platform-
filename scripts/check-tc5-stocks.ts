/**
 * Manually evaluate Trader Choice 5 conditions for specific stocks against
 * DailyBar — mirrors src/lib/scanners.ts TC5 hit() so a non-match can be
 * traced to a condition.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

function weeklyBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let cur: { key: string; bar: Bar } | null = null;
  for (const b of bars) {
    const ts = Date.parse(`${b.date}T00:00:00Z`);
    const d = new Date(ts);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    const key = monday.toISOString().slice(0, 10);
    if (!cur || cur.key !== key) {
      if (cur) out.push(cur.bar);
      cur = { key, bar: { ...b } };
    } else {
      const c = cur.bar;
      c.high = Math.max(c.high, b.high);
      c.low = Math.min(c.low, b.low);
      c.close = b.close;
      c.volume += b.volume;
    }
  }
  if (cur) out.push(cur.bar);
  return out;
}

function volAvg(bars: Bar[], from: number, to: number): number {
  const slice = bars.slice(from, to);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b.volume, 0) / slice.length;
}

async function check(symbol: string) {
  const rows = await db.dailyBar.findMany({ where: { symbol }, orderBy: { date: "asc" } });
  const bars: Bar[] = rows.map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const stock = await db.stock.findUnique({ where: { symbol }, select: { price: true, marketCap: true } });
  console.log(`\n=== ${symbol} — bars ${bars.length}, price ${stock?.price}, mcap ${stock?.marketCap} ===`);
  if (bars.length < 210) { console.log("SKIP: <210 bars"); return; }
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const close = closes[n - 1];

  const avgVol = volAvg(bars, n - 20, n);
  const turnover = close * avgVol;
  console.log(`turnover ₹${(turnover / 1e7).toFixed(1)} Cr (need > 3.0) → ${turnover > 3e7 ? "PASS" : "FAIL"}`);

  const sma200 = closes.slice(-200).reduce((a, c) => a + c, 0) / 200;
  console.log(`close ${close.toFixed(1)} vs 200SMA ${sma200.toFixed(1)} → ${close > sma200 ? "PASS" : "FAIL"}`);

  let low66 = Infinity;
  for (let i = n - 66; i < n; i++) low66 = Math.min(low66, bars[i].low);
  const aboveLow = close / low66;
  console.log(`close/66d-low = ${aboveLow.toFixed(2)} (need ≥ 1.30) → ${aboveLow >= 1.3 ? "PASS" : "FAIL"}`);

  const wk = weeklyBars(bars);
  let prior4High = -Infinity;
  for (let i = wk.length - 5; i < wk.length - 1; i++) prior4High = Math.max(prior4High, wk[i].high);
  const broke = wk[wk.length - 1].high > prior4High;
  console.log(`week high ${wk[wk.length - 1].high.toFixed(1)} vs prior-4W high ${prior4High.toFixed(1)} → ${broke ? "PASS" : "FAIL"}`);

  for (let k = 1; k <= 3; k++) {
    const w = wk[wk.length - 1 - k], wp = wk[wk.length - 2 - k];
    const chg = (w.close / wp.close - 1) * 100;
    console.log(`  ${k}w ago gain ${chg.toFixed(1)}% (need ≤ 6) → ${chg <= 6 ? "PASS" : "FAIL"}`);
  }
}

async function main() {
  for (const s of ["SHANTIGOLD.NS", "ARTEMISMED.NS", "GNA.NS"]) await check(s);
  await db.$disconnect();
}
main();
