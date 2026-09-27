/// <reference types="bun-types" />
import { Database } from "bun:sqlite";

const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const rows = db
  .query(`SELECT s.symbol, s.price FROM Stock s WHERE s.price IS NOT NULL ORDER BY s.marketCap DESC LIMIT 900`)
  .all() as { symbol: string; price: number }[];
const getBars = db.query(`SELECT high, close FROM DailyBar WHERE symbol = ? ORDER BY date DESC LIMIT 61`);
let hits = 0;
let checked = 0;
for (const r of rows) {
  const bars = getBars.all(r.symbol) as { high: number; close: number }[];
  if (bars.length < 61) continue;
  checked++;
  const today = bars[0];
  const prior60 = bars.slice(1, 61);
  const priorHigh = Math.max(...prior60.map((b) => b.high));
  if (today.close > priorHigh) {
    hits++;
    if (hits <= 4) console.log("hit:", r.symbol, "close", today.close, "prior60high", priorHigh);
  }
}
console.log("sqlite replicate resistance-daily: bars-complete:", checked, "hits:", hits);
db.close();
