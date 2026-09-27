/**
 * Repair the data gaps behind the "screener table has missing data" report.
 *
 * Root cause (Task 47 audit): the PostgreSQL migration flipped DESC ordering
 * to NULLS FIRST, so the sector trickle burned its window on the ~1,079
 * no-market-cap rows (SME/ETF segment) first and stamped fetch failures as
 * sector "Unknown"; Yahoo's screener endpoint also omits marketCap/PE for a
 * few hundred mainboard names even though the quoteSummary endpoint HAS them.
 *
 * Phase 1 — re-fetch asset profiles for sector = "Unknown" (real companies
 *           whose single-retry profile fetch failed during the trickle).
 * Phase 2 — top-up marketCap / peTTM / pbRatio / divYield (null-preserving)
 *           from quoteSummary price+summaryDetail for mainboard names the
 *           screener payload left blank. SME (-SM), InvIT (-IV) and bond
 *           (-BL) segments are skipped: Yahoo has no such fields for them.
 *
 * Run standalone (NOT inside the dev server) — the same OOM discipline as
 * the other backfill scripts. Safe to re-run: every write is a no-op when
 * Yahoo still has nothing.
 */
/// <reference types="bun-types" />
import { db, descNullsLast } from "../src/lib/db";
import { fetchAssetProfile, yahooFetch } from "../src/lib/yahoo";
import { resolveTaxonomy } from "../src/lib/taxonomy";

const CONCURRENCY = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const rawOf = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && typeof (v as { raw?: unknown }).raw === "number") {
    const n = (v as { raw: number }).raw;
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// ------------------------------------------------------------------ phase 1

async function repairSectors(): Promise<void> {
  const targets = await db.stock.findMany({
    where: { sector: "Unknown" },
    select: { symbol: true },
    orderBy: descNullsLast("marketCap"),
  });
  console.log(`[sectors] ${targets.length} names with sector=Unknown — re-fetching profiles`);

  let done = 0;
  let recovered = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      const symbol = targets[i].symbol;
      try {
        const profile = await fetchAssetProfile(symbol);
        if (profile?.sector) {
          const tax = resolveTaxonomy(symbol, profile.sector, profile.industry ?? null);
          await db.stock.update({
            where: { symbol },
            data: {
              sector: profile.sector,
              industry: profile.industry ?? null,
              indGrp: tax.grp,
              subGrp: tax.sub,
              sectorSynced: new Date(),
            },
          }).catch(() => {});
          recovered++;
        }
      } catch {
        /* leave Unknown — Yahoo has nothing for this name */
      }
      done++;
      if (done % 100 === 0) console.log(`[sectors] ${done}/${targets.length} fetched, ${recovered} recovered`);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[sectors] DONE: ${recovered}/${targets.length} recovered`);
}

// ------------------------------------------------------------------ phase 2

interface PriceSummary {
  quoteSummary?: {
    result?: {
      price?: Record<string, unknown>;
      summaryDetail?: Record<string, unknown>;
    }[];
  };
}

async function repairMarketCap(): Promise<void> {
  const targets = await db.stock.findMany({
    where: {
      OR: [{ marketCap: null }, { peTTM: null }],
      AND: [
        { symbol: { not: { endsWith: "-SM.NS" } } },
        { symbol: { not: { endsWith: "-IV.NS" } } },
        { symbol: { not: { endsWith: "-BL.NS" } } },
      ],
    },
    select: { symbol: true, marketCap: true, peTTM: true, pbRatio: true, divYield: true },
    orderBy: descNullsLast("marketCap"),
  });
  console.log(`[mcap/pe] ${targets.length} mainboard names with missing fields — topping up`);

  let done = 0;
  let filled = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      const t = targets[i];
      try {
        const d = await yahooFetch<PriceSummary>({
          url: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t.symbol)}`,
          query: { modules: "price,summaryDetail" },
          timeoutMs: 20000,
          retries: 1,
        });
        const price = d.quoteSummary?.result?.[0]?.price ?? {};
        const detail = d.quoteSummary?.result?.[0]?.summaryDetail ?? {};

        // null-preserving: only fill fields the DB is missing
        const data: Record<string, number> = {};
        const mcap = rawOf(price.marketCap);
        if (t.marketCap == null && mcap != null) data.marketCap = mcap;
        const pe = rawOf(price.trailingPE) ?? rawOf(detail.trailingPE);
        if (t.peTTM == null && pe != null) data.peTTM = pe;
        const pb = rawOf(price.priceToBook) ?? rawOf(detail.priceToBook);
        if (t.pbRatio == null && pb != null) data.pbRatio = pb;
        const dy = rawOf(detail.trailingAnnualDividendYield);
        if (t.divYield == null && dy != null) data.divYield = dy * 100;

        if (Object.keys(data).length > 0) {
          await db.stock.update({ where: { symbol: t.symbol }, data }).catch(() => {});
          filled++;
        }
      } catch {
        /* structural gap — ETFs and a few names genuinely carry no fields */
      }
      done++;
      if (done % 100 === 0) console.log(`[mcap/pe] ${done}/${targets.length} fetched, ${filled} rows enriched`);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[mcap/pe] DONE: ${filled}/${targets.length} rows enriched`);
}

// -------------------------------------------------------------------- main

async function main() {
  const t0 = Date.now();
  await repairSectors();
  await sleep(1000);
  await repairMarketCap();
  console.log(`repair finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await db.$disconnect();
  process.exit(0);
}

main();
