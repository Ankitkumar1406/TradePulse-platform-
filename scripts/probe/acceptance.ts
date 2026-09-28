/**
 * Acceptance scan through the v3 API — the spec's test scan, built entirely
 * from registry items and executed by the vectorised evaluator.
 */
export {};

const num = (v: number) => ({ t: "number", value: v });
const op = (o: string) => ({ t: "op", op: o });
const attr = (name: string, offset: { n: number; unit: string } | null = null) => ({ t: "attr", name, tf: "daily", offset });

const rangeClause = {
  id: "c1", kind: "clause" as const, enabled: true,
  left: [
    { t: "bracket", inner: [
      { t: "fn", name: "winMax", tf: "daily", offset: null, args: [[num(22)], [attr("low", { n: 1, unit: "day" })]] },
      op("-"),
      { t: "fn", name: "winMin", tf: "daily", offset: null, args: [[num(22)], [attr("low", { n: 1, unit: "day" })]] },
    ] },
    op("/"),
    { t: "fn", name: "winMin", tf: "daily", offset: null, args: [[num(22)], [attr("low", { n: 1, unit: "day" })]] },
    op("*"),
    num(100),
  ],
  cmp: "lt", right: [num(12)],
};
const mcapClause = { id: "c2", kind: "clause" as const, enabled: true, left: [attr("mcap")], cmp: "gt", right: [num(1e7)] };
const closeHigh52 = { id: "c3", kind: "clause" as const, enabled: true, left: [attr("close")], cmp: "withinPct", right: [attr("high52")], pct: 2 };
const volSma = { id: "c4", kind: "clause" as const, enabled: true, left: [attr("volume")], cmp: "gt", right: [{ t: "fn", name: "sma", tf: "daily", offset: null, args: [[attr("volume")], [num(20)]] }, op("*"), num(2)] };

const scan = { segment: "cash" as const, root: { id: "root", kind: "group" as const, mode: "all" as const, enabled: true, children: [
  rangeClause, mcapClause, closeHigh52, volSma,
] } };

const t0 = Date.now();
const res = await fetch("http://localhost:3000/api/stocks?cond=" + encodeURIComponent(JSON.stringify({ v: 3, scan })) + "&perPage=10&page=1");
const data = await res.json();
console.log("status", res.status, "in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
if (!res.ok) { console.log(data); process.exit(1); }
console.log("total:", data.total, "| meta:", JSON.stringify(data.meta));
console.log("top:", (data.stocks ?? []).slice(0, 8).map((s: { symbol: string }) => s.symbol.replace(".NS", "")).join(", "));
