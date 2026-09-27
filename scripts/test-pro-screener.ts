/// <reference types="bun-types" />
/**
 * Verification harness for the pro screener SQL (runs proSymbolList directly
 * against PostgreSQL — bypasses HTTP/auth so the compiled SQL is exercised
 * exactly as /api/stocks would).
 *
 *   bun run scripts/test-pro-screener.ts
 */
import { db } from "../src/lib/db";
import { proSymbolList, type ProRowWire } from "../src/lib/pro-sql";

// The exact payload captured from the failing /api/stocks request in dev.log
// (weekly-lookback confluence: gap-fill style conditions).
const rows: ProRowWire[] = [
  { kind: "expr", cmp: "gte", l: "close / min(66, low)", r: "1.30", logic: "and" },
  { kind: "expr", cmp: "gt", l: "marketCap / 10000000", r: "0", logic: "and" },
  { kind: "expr", cmp: "gte", l: "close", r: "1", logic: "and" },
  { kind: "expr", cmp: "gt", l: "close * sma(volume, 20)", r: "30000000", logic: "and" },
  { kind: "expr", cmp: "gt", l: "close", r: "sma(close, 200)", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(2 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lte", l: "abs(3 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", r: "6", logic: "and" },
  { kind: "expr", cmp: "lt", l: "1 week ago close", r: "2 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "1 week ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "2 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "3 weeks ago high", logic: "and" },
  { kind: "expr", cmp: "gte", l: "weekly high", r: "4 weeks ago high", logic: "and" },
] as unknown as ProRowWire[];

async function main() {
  const t0 = Date.now();
  const symbols = await proSymbolList(db, rows, { sector: "all", sort: "marketCap", dir: "desc" }, "v2");
  console.log(`OK: ${symbols.length} matches in ${Date.now() - t0}ms`);
  console.log("first 10:", symbols.slice(0, 10).join(", "));
  await db.$disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
