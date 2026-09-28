export {};
import { buildStore } from "../../src/lib/scan/columns";

const t0 = Date.now();
const store = await buildStore();
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("symbols:", store.symbols.length, "bars:", store.daily.n, "maxDate:", store.maxDate);
console.log("weekly bars:", store.weekly.n, "monthly:", store.monthly.n);
console.log("indices:", [...store.indices.keys()].join(", "), "nifty bars:", store.indices.get("nifty50")?.n ?? 0);
console.log("mcap sample:", store.snap.marketCap[store.bySym.get("RELIANCE.NS") ?? 0]);
console.log("rss MB:", (process.memoryUsage.rss() / 1e6).toFixed(0));
