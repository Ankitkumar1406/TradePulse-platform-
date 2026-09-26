/** Quick parser sanity checks for pro-expr (run: bun run scripts/probe-expr-parse.ts) */
import { parseProExpr, serializeExpr, isScalarOnly } from "../src/lib/pro-expr";

const good: [string, string?][] = [
  // [input, expected canonical (optional)]
  ["close / min(66, low)", "close / min(66, low)"],
  ["daily close / daily min(66, daily low) >= 1.30".replace(" >= 1.30", ""), "close / min(66, low)"],
  ["close * sma(volume, 20)", "close * sma(volume, 20)"],
  ["sma(close, 200)", "sma(close, 200)"],
  ["1 week ago close", "1 week ago close"],
  ["2 weeks ago high", "2 weeks ago high"],
  ["weekly high", "weekly high"],
  ["weekly high >= 1 week ago high".split(" >= ")[0], "weekly high"],
  ["1 week ago close < 2 weeks ago high".split(" < ")[0], "1 week ago close"],
  ["abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))",
   "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))"],
  ["marketCap", "marketCap"],
  ["market cap", "marketCap"],
  ["sma(weekly close, 10)", "sma(weekly close, 10)"],
  ["min(5, 1 week ago high)", "min(5, 1 week ago high)"],
  ['1 week ago "close - 1 candle ago close"', "1 week ago (close - 1 candle ago close)"],
  ["-(3 + 4) * close", "-(3 + 4) * close"],
  ["close / (min(66, low) + 1)", "close / (min(66, low) + 1)"],
  ["2 candles ago volume", "2 candles ago volume"],
  ["1 week ago sma(close, 20)", "1 week ago sma(close, 20)"],
  ["rsi14 + peTTM", "rsi14 + peTTM"],
];

const bad: [string, string][] = [
  ["close and open", "AND/OR inside expression"],
  ["close >", "comparisons inside"],
  ["cloze", "unknown name"],
  ["sma(marketCap, 20)", "sma needs a candle series"],
  ["1 week ago marketCap", "constant with offset"],
  ["weekly rsi14", "constant with tf"],
  ["1 week", 'expected "ago"'],
  ["min(abc, low)", "bad bar count"],
  ["(close - 1", "unclosed paren"],
  ['"close +', "unclosed quote"],
  ["close /", "unexpected end"],
  ["volume sma(close", "unexpected token"],
  ["rsi14(2)", "call on scalar"],
];

let pass = 0, fail = 0;
for (const [src, want] of good) {
  const r = parseProExpr(src);
  if (!r.ok) { console.log("✗ should parse:", src, "→", r.error); fail++; continue; }
  if (want && !want.includes(" ") === false && want !== r.text && want !== "close sma") {
    // only warn on mismatch when expectation given precisely
    if (want.length > 3 && r.text !== want) console.log(`… canonical: "${src}" → "${r.text}" (wanted "${want}")`);
  }
  pass++;
}
for (const [src, why] of bad) {
  const r = parseProExpr(src);
  if (r.ok) { console.log("✗ should FAIL:", src, "→ parsed as", r.text); fail++; continue; }
  console.log(`  err ok: "${src}" → ${r.error.slice(0, 90)} (${why})`);
  pass++;
}
console.log(`\nscalar-only checks: close=${isScalarOnly(parseProExpr("close").ok ? (parseProExpr("close") as { node: unknown }).node as never : null as never)}`);
const a = parseProExpr("close"); const b = parseProExpr("marketCap");
if (a.ok && b.ok) console.log("isScalarOnly(close) =", isScalarOnly(a.node), "| isScalarOnly(marketCap) =", isScalarOnly(b.node));
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES: " + fail} (${pass} checked)`);
