export {};
const num = (v: number) => ({ t: "number", value: v });
const attr = (name: string) => ({ t: "attr", name, tf: "daily", offset: null, period: "ttm" });

async function run(label: string, left: unknown, cmp: string, right: unknown[]) {
  const scan = { segment: "cash", root: { id: "r", kind: "group", mode: "all", enabled: true, children: [
    { id: "a", kind: "clause", enabled: true, left: [left], cmp, right } ] } };
  const res = await fetch("http://localhost:3000/api/stocks?cond=" + encodeURIComponent(JSON.stringify({ v: 3, scan })) + "&perPage=5&page=1");
  const d = await res.json();
  console.log(`${label}: ${res.ok ? `${d.total} matches (fund for ${d.meta?.fundAvailable})` : d.error} | top: ${(d.stocks ?? []).slice(0, 3).map((s: { symbol: string }) => s.symbol.replace(".NS", "")).join(", ")}`);
}

await run("ROE > 20%", attr("roe"), "gt", [num(20)]);
await run("EV/EBITDA < 12", attr("evEbitda"), "lt", [num(12)]);
await run("Debt/Equity < 0.5", attr("debtToEquity"), "lt", [num(0.5)]);
await run("Div yield > 2%", attr("divYield"), "gt", [num(2)]);
