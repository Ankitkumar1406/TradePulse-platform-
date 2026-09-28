export {};
const num = (v: number) => ({ t: "number", value: v });
const attr = (name: string) => ({ t: "attr", name, tf: "daily", offset: null });

async function run(label: string, scan: unknown) {
  const res = await fetch("http://localhost:3000/api/stocks?cond=" + encodeURIComponent(JSON.stringify({ v: 3, scan })) + "&perPage=5&page=1");
  const d = await res.json();
  if (!res.ok) { console.log(label, "FAILED:", d.error); return; }
  console.log(`${label}: ${d.total} matches | top: ${(d.stocks ?? []).slice(0, 3).map((s: { symbol: string }) => s.symbol.replace(".NS", "")).join(", ")}`);
}

// ANY 2 of (RSI>60, vol>2×avg, close within 2% of 52w high)
await run("any-2-of", { segment: "cash", root: { id: "r", kind: "group", mode: "any", anyCount: 2, enabled: true, children: [
  { id: "a", kind: "clause", enabled: true, left: [{ t: "fn", name: "rsi", tf: "daily", offset: null, args: [[num(14)]] }], cmp: "gt", right: [num(60)] },
  { id: "b", kind: "clause", enabled: true, left: [attr("volume")], cmp: "gt", right: [{ t: "fn", name: "sma", tf: "daily", offset: null, args: [[attr("volume")], [num(20)]] }, { t: "op", op: "*" }, num(2)] },
  { id: "c", kind: "clause", enabled: true, left: [attr("close")], cmp: "withinPct", right: [attr("high52")], pct: 2 },
] } });

// NONE of (close > sma200)
await run("none-above-200sma", { segment: "cash", root: { id: "r", kind: "group", mode: "none", enabled: true, children: [
  { id: "a", kind: "clause", enabled: true, left: [attr("close")], cmp: "gt", right: [{ t: "fn", name: "sma", tf: "daily", offset: null, args: [[attr("close")], [num(200)]] }] },
] } });

// weekly RSI + sector text + flag
await run("weekly-rsi+sector", { segment: "cash", root: { id: "r", kind: "group", mode: "all", enabled: true, children: [
  { id: "a", kind: "clause", enabled: true, left: [{ t: "fn", name: "rsi", tf: "weekly", offset: null, args: [[num(14)]] }], cmp: "gt", right: [num(55)] },
  { id: "b", kind: "clause", enabled: true, left: [attr("sector")], cmp: "textEq", right: [{ t: "text", value: "Information Technology" }] },
] } });

// cross above + NR7 flag
await run("cross+flag", { segment: "cash", root: { id: "r", kind: "group", mode: "all", enabled: true, children: [
  { id: "a", kind: "clause", enabled: true, left: [attr("close")], cmp: "crossAbove", right: [{ t: "fn", name: "sma", tf: "daily", offset: null, args: [[attr("close")], [num(50)]] }] },
  { id: "b", kind: "clause", enabled: true, left: [attr("nr7")], cmp: "isTrue", right: [] },
] } });

// market cap name (text) + Large only
await run("large-caps-rs", { segment: "cash", root: { id: "r", kind: "group", mode: "all", enabled: true, children: [
  { id: "a", kind: "clause", enabled: true, left: [attr("mcapName")], cmp: "textEq", right: [{ t: "text", value: "Large" }] },
  { id: "b", kind: "clause", enabled: true, left: [attr("rsRating")], cmp: "gte", right: [num(80)] },
] } });
