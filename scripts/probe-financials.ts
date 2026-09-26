import { yahooFetch } from "../src/lib/yahoo";

const sym = process.argv[2] ?? "RELIANCE.NS";
const d = await yahooFetch<{
  quoteSummary: {
    result: {
      defaultKeyStatistics?: Record<string, unknown>;
      incomeStatementHistoryQuarterly?: { incomeStatementHistory?: { endDate: { raw: number }; totalRevenue?: { raw?: number }; netIncome?: { raw?: number } }[] };
      incomeStatementHistory?: { incomeStatementHistory?: { endDate: { raw: number }; netIncome?: { raw?: number } }[] };
    }[];
  };
}>({
  url: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}`,
  query: { modules: "defaultKeyStatistics,incomeStatementHistory,incomeStatementHistoryQuarterly" },
  timeoutMs: 20000,
  retries: 1,
});
const r = d.quoteSummary?.result?.[0];
console.log("earningsQuarterlyGrowth:", JSON.stringify(r?.defaultKeyStatistics?.earningsQuarterlyGrowth));
const q = r?.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
console.log("quarterly count:", q.length);
for (const s of q) console.log(" Q end", new Date(s.endDate.raw * 1000).toISOString().slice(0, 10), "rev", s.totalRevenue?.raw, "ni", s.netIncome?.raw);
const a = r?.incomeStatementHistory?.incomeStatementHistory ?? [];
console.log("annual count:", a.length);
for (const s of a) console.log(" A end", new Date(s.endDate.raw * 1000).toISOString().slice(0, 10), "ni", s.netIncome?.raw);
