export {};
import { getStore } from "../../src/lib/scan/columns";
import { segFor, attrSeries, crossSection } from "../../src/lib/scan/attr-series";

const store = await getStore();
const sectors = new Map<string, number>();
for (const r of store.rows) if (r.sector) sectors.set(r.sector, (sectors.get(r.sector) ?? 0) + 1);
console.log("top sectors:", [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => `${s}(${n})`).join(" "));

for (const sym of ["TCS.NS", "INFY.NS", "RELIANCE.NS"]) {
  const si = store.bySym.get(sym);
  if (si == null) { console.log(sym, "not found"); continue; }
  const s = { store, si };
  const wRsi = attrSeries(s, "rsi", "weekly", 0, undefined, [[{ t: "number", value: 14 }]]);
  const dRsi = attrSeries(s, "rsi", "daily", 0, undefined, [[{ t: "number", value: 14 }]]);
  const pick = (a: Float64Array | null) => (a ? a[a.length - 1].toFixed(1) : "null");
  console.log(sym, "sector:", JSON.stringify(store.rows[si].sector), "weekly RSI:", pick(wRsi), "daily RSI:", pick(dRsi));
}

// rsRating distribution
const cs = crossSection(store);
const buckets = { ge80: 0, ge60: 0, mid: 0, lt20: 0 };
for (let si = 0; si < store.symbols.length; si++) {
  const v = cs.rsRating[si];
  if (Number.isNaN(v)) continue;
  if (v >= 80) buckets.ge80++;
  else if (v >= 60) buckets.ge60++;
  else if (v < 20) buckets.lt20++;
  else buckets.mid++;
}
console.log("rsRating buckets:", buckets, "large-cap ge80:", [...Array(store.symbols.length)].filter((_, si) => cs.rsRating[si] >= 80 && store.snap.marketCap[si] > 0).length);
