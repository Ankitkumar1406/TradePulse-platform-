/**
 * Weekly fundamentals refresh — stock_fundamentals from Yahoo (spec step 4).
 *
 *   bun scripts/fundamentals-refresh.ts            # full universe (~35 min at 5 concurrent)
 *   bun scripts/fundamentals-refresh.ts 200        # top-N by market cap only
 *
 * Unit normalisation at ingestion (the registry's contract):
 *   - dividendYield: Yahoo returns a fraction (0.012) or a percent (1.2) —
 *     values < 1 are treated as fractions and × 100 (unit test in tests/).
 *   - debtToEquity: Yahoo reports e.g. 85.5 meaning 85.5% → stored as 0.855.
 *   - margins/ROE/ROA/payout: fractions → × 100 (percent).
 *   - money fields: absolute INR.
 * A null field stays null — the screener treats it as "no data" and reports
 * "Fundamental data available for X of N stocks".
 */
import { PrismaClient } from "@prisma/client";
import { yahooFetch } from "../src/lib/yahoo";

const db = new PrismaClient();

interface Norm {
  [field: string]: number | number[] | null;
}

const pct = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v * 100 : null;
const ratio = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const abs = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Yahoo mixes fractions and percents — the classic ingestion trap. */
export function normaliseDividendYield(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v < 1 ? v * 100 : v;
}

/** Yahoo reports debt/equity as a percent (85.5 = 0.855 ratio). */
export function normaliseDebtToEquity(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v > 10 ? v / 100 : v;
}

export function normalise(raw: Record<string, unknown>): Norm {
  const out: Norm = {};
  out.mcap = abs(raw.marketCap);
  out.pe = abs(raw.trailingPE);
  out.pb = abs(raw.priceToBook);
  out.divYield = normaliseDividendYield(raw.dividendYield);
  out.epsTtm = abs(raw.trailingEps);
  out.bookValue = abs(raw.bookValue);
  out.roe = pct(raw.returnOnEquity);
  out.profitMargin = pct(raw.profitMargins);
  out.opMargin = pct(raw.operatingMargins);
  out.debtToEquity = normaliseDebtToEquity(raw.debtToEquity);
  out.currentRatio = ratio(raw.currentRatio);
  out.quickRatio = ratio(raw.quickRatio);
  out.ev = abs(raw.enterpriseValue);
  out.evEbitda = abs(raw.enterpriseToEbitda);
  out.evRevenue = abs(raw.enterpriseToRevenue);
  out.psTtm = abs(raw.priceToSalesTrailing12Months);
  out.dividendRate = abs(raw.dividendRate);
  out.payoutRatio = pct(raw.payoutRatio);
  out.roa = pct(raw.returnOnAssets);
  out.grossMargin = pct(raw.grossMargins);
  out.revenueTtm = abs(raw.totalRevenue);
  out.ebitda = abs(raw.ebitda);
  out.netIncome = abs(raw.netIncomeToCommon);
  out.fcf = abs(raw.freeCashflow);
  out.ocf = abs(raw.operatingCashflow);
  out.totalDebt = abs(raw.totalDebt);
  out.totalCash = abs(raw.totalCash);
  out.sharesOut = abs(raw.sharesOutstanding);
  out.revenueGrowth = pct(raw.revenueGrowth);
  out.earningsGrowth = pct(raw.earningsGrowth);
  out.earningsGrowth = pct(raw.earningsGrowth);
  out.epsGrowthYoY = pct(raw.earningsQuarterlyGrowth);
  out.fwdEps = abs(raw.forwardEps);
  out.fwdPe = abs(raw.forwardPE);
  out.peg = abs(raw.trailingPegRatio ?? raw.pegRatio);
  // holdings are P2 proxies — only filled when Yahoo actually returns them
  out.instHoldingPct = pct(raw.heldPercentInstitutions);
  out.insiderHoldingPct = pct(raw.heldPercentInsiders);
  return out;
}

async function fetchQuoteSummary(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const d = await yahooFetch<{
      quoteSummary?: { result?: { [section: string]: Record<string, { raw?: number }> }[] };
    }>({
      url: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      query: { modules: "summaryDetail,defaultKeyStatistics,financialData" },
      timeoutMs: 20000,
      retries: 1,
    });
    const result = d.quoteSummary?.result?.[0];
    if (!result) return null;
    // flatten { field: { raw: x } } wrappers into plain numbers
    const flat: Record<string, unknown> = {};
    for (const section of Object.values(result)) {
      for (const [k, v] of Object.entries(section ?? {})) {
        if (v && typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
          flat[k] = (v as { raw?: unknown }).raw;
        }
      }
    }
    return flat;
  } catch {
    return null;
  }
}

async function main() {
  const limitArg = Number(process.argv[2] ?? "") || null;
  const stocks = await db.stock.findMany({
    select: { symbol: true, marketCap: true },
    orderBy: { marketCap: { sort: "desc", nulls: "last" } },
    ...(limitArg ? { take: limitArg } : {}),
  });
  console.log(`[fundamentals] refreshing ${stocks.length} stocks into stock_fundamentals`);
  const CONCURRENCY = 5;
  let done = 0, got = 0;
  const t0 = Date.now();

  async function worker(queue: string[]) {
    for (;;) {
      const sym = queue.shift();
      if (!sym) return;
      const raw = await fetchQuoteSummary(sym);
      const data = raw ? normalise(raw) : {};
      const fields = Object.entries(data).filter(([, v]) => v != null);
      if (fields.length > 0) got++;
      try {
        await db.stockFundamentals.upsert({
          where: { symbol: sym },
          create: { symbol: sym, ...(Object.fromEntries(fields) as Record<string, never>) },
          update: { fetchedAt: new Date(), ...(Object.fromEntries(fields) as Record<string, never>) },
        });
      } catch (e) {
        console.error(`  upsert failed for ${sym}:`, e instanceof Error ? e.message.split("\n")[0] : e);
      }
      done++;
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done}/${stocks.length} (data for ${got}) — ${rate.toFixed(1)}/s`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const queue = stocks.map((s) => s.symbol);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log(`[fundamentals] done — ${got}/${stocks.length} stocks returned data in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
