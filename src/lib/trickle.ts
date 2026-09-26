/**
 * Background trickle pipelines: sector profiles, OHLCV bars and earnings dates.
 * Each runs a bounded, chunked loop in the background after a sync; safe to
 * call repeatedly (single-flight via globalThis guards).
 */

import { db } from "@/lib/db";
import { fetchAssetProfile, fetchChart, fetchEarningsDate, fetchFinancials } from "@/lib/yahoo";
import { STALE_DATA_MS } from "@/lib/sync";
import { resolveTaxonomy } from "@/lib/taxonomy";

interface TrickleGlobals {
  __tpSectorTrickle?: boolean;
  __tpBarsTrickle?: boolean;
  __tpEarningsTrickle?: boolean;
  __tpFinancialsTrickle?: boolean;
}
const g = globalThis as unknown as TrickleGlobals;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bumpCounters(patch: Record<string, number>) {
  await db.syncState.upsert({
    where: { id: "main" },
    create: { id: "main", ...patch },
    update: patch,
  }).catch(() => {});
}

// ---------------------------------------------------------------- sectors

export function startSectorTrickle() {
  if (g.__tpSectorTrickle) return;
  g.__tpSectorTrickle = true;
  void (async () => {
    try {
      const pendingTotal = await db.stock.count({ where: { sectorSynced: null } });
      await bumpCounters({ sectorsTotal: pendingTotal, sectorsDone: 0 });
      const CHUNK = 6;
      let done = 0;
      for (;;) {
        const pending = await db.stock.findMany({
          where: { sectorSynced: null },
          select: { symbol: true },
          orderBy: { marketCap: "desc" },
          take: CHUNK,
        });
        if (pending.length === 0) break;
        for (const s of pending) {
          const profile = await fetchAssetProfile(s.symbol).catch(() => null);
          const sector = profile?.sector ?? "Unknown";
          const industry = profile?.industry ?? null;
          const tax = resolveTaxonomy(s.symbol, sector, industry);
          await db.stock.update({
            where: { symbol: s.symbol },
            data: {
              sector,
              industry,
              indGrp: tax.grp,
              subGrp: tax.sub,
              sectorSynced: new Date(),
            },
          }).catch(() => {});
          done++;
        }
        await bumpCounters({ sectorsDone: done });
        await sleep(400);
      }
    } catch (e) {
      console.error("[trickle] sectors:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpSectorTrickle = false;
    }
  })();
}

/** Monday (UTC) anchor of the week containing the given YYYY-MM-DD date. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Current-week OHLC from freshly fetched bars (last week bucket, Mon-anchored). */
function weeklyOhlc(rows: { date: string; open: number; high: number; low: number; close: number }[]) {
  if (rows.length === 0) return null;
  const monday = mondayOf(rows[rows.length - 1].date);
  const wk = rows.filter((r) => r.date >= monday);
  if (wk.length === 0) return null;
  return {
    wOpen: wk[0].open,
    wHigh: Math.max(...wk.map((r) => r.high)),
    wLow: Math.min(...wk.map((r) => r.low)),
    wClose: wk[wk.length - 1].close,
  };
}

// ---------------------------------------------------------------- bars

export function startBarsTrickle() {
  if (g.__tpBarsTrickle) return;
  g.__tpBarsTrickle = true;
  void (async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_DATA_MS);
      const pendingTotal = await db.stock.count({
        where: { OR: [{ barsSynced: null }, { barsSynced: { lt: cutoff } }] },
      });
      await bumpCounters({ barsTotal: pendingTotal, barsDone: 0 });
      const CHUNK = 6;
      let done = 0;
      for (;;) {
        const pending = await db.stock.findMany({
          where: { OR: [{ barsSynced: null }, { barsSynced: { lt: cutoff } }] },
          select: { symbol: true },
          orderBy: { marketCap: "desc" },
          take: CHUNK,
        });
        if (pending.length === 0) break;
        for (const s of pending) {
          try {
            const chart = await fetchChart(s.symbol, "2y");
            const ts = chart.timestamp;
            const q = chart.indicators.quote[0];
            const rows: { symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
            for (let i = 0; i < ts.length; i++) {
              const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
              if (o == null || h == null || l == null || c == null) continue;
              rows.push({
                symbol: s.symbol,
                date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
                open: o, high: h, low: l, close: c,
                volume: v ?? 0,
              });
            }
            if (rows.length > 0) {
              await db.$transaction([
                db.dailyBar.deleteMany({ where: { symbol: s.symbol } }),
                db.dailyBar.createMany({ data: rows }),
              ]);
            }
            // rebuild the current-week candle alongside the bars so the
            // screener builder's Weekly-timeframe price conditions stay fresh
            const wk = weeklyOhlc(rows);
            await db.stock.update({
              where: { symbol: s.symbol },
              data: { barsSynced: new Date(), ...(wk ?? {}) },
            });
          } catch {
            // symbol failed this pass — mark so it isn't retried until next cycle
            await db.stock.update({ where: { symbol: s.symbol }, data: { barsSynced: new Date() } }).catch(() => {});
          }
          done++;
        }
        await bumpCounters({ barsDone: done });
        await sleep(500);
      }
    } catch (e) {
      console.error("[trickle] bars:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpBarsTrickle = false;
    }
  })();
}

// ---------------------------------------------------------------- earnings

export function startEarningsTrickle() {
  if (g.__tpEarningsTrickle) return;
  g.__tpEarningsTrickle = true;
  void (async () => {
    try {
      const pendingTotal = await db.stock.count({ where: { earningsSynced: null } });
      await bumpCounters({ earningsTotal: pendingTotal, earningsDone: 0 });
      const CHUNK = 6;
      let done = 0;
      for (;;) {
        const pending = await db.stock.findMany({
          where: { earningsSynced: null },
          select: { symbol: true },
          orderBy: { marketCap: "desc" },
          take: CHUNK,
        });
        if (pending.length === 0) break;
        for (const s of pending) {
          const date = await fetchEarningsDate(s.symbol).catch(() => null);
          await db.stock.update({
            where: { symbol: s.symbol },
            data: {
              earningsDate: date && !Number.isNaN(date.getTime()) ? date : null,
              earningsSynced: new Date(),
            },
          }).catch(() => {});
          done++;
        }
        await bumpCounters({ earningsDone: done });
        await sleep(400);
      }
    } catch (e) {
      console.error("[trickle] earnings:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpEarningsTrickle = false;
    }
  })();
}

// ---------------------------------------------------------------- financials

/**
 * Quarterly financials (EPS growth YoY, revenue QoQ, 3Y NI CAGR) — one
 * quoteSummary call per stock, fetched for the whole universe on first run
 * and refreshed once they go stale. Powers the EPS score, the EPS Chg % (YoY)
 * screener column and Trader Choice 7's fundamental filters.
 */
export function startFinancialsTrickle() {
  if (g.__tpFinancialsTrickle) return;
  g.__tpFinancialsTrickle = true;
  void (async () => {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000); // financials move quarterly
      const pendingTotal = await db.stock.count({
        where: { OR: [{ financialsSynced: null }, { financialsSynced: { lt: cutoff } }] },
      });
      await bumpCounters({ financialsTotal: pendingTotal, financialsDone: 0 });
      const CHUNK = 4;
      let done = 0;
      for (;;) {
        const pending = await db.stock.findMany({
          where: { OR: [{ financialsSynced: null }, { financialsSynced: { lt: cutoff } }] },
          select: { symbol: true },
          orderBy: { marketCap: "desc" },
          take: CHUNK,
        });
        if (pending.length === 0) break;
        for (const s of pending) {
          const f = await fetchFinancials(s.symbol).catch(() => null);
          // null-preserving: a missing statement must not wipe a good value
          await db.stock
            .update({
              where: { symbol: s.symbol },
              data: {
                ...(f?.epsQuarterlyGrowth != null ? { epsQuarterlyGrowth: f.epsQuarterlyGrowth } : {}),
                ...(f?.revenueQoQGrowth != null ? { revenueQoQGrowth: f.revenueQoQGrowth } : {}),
                ...(f?.netIncome3YCagr != null ? { netIncome3YCagr: f.netIncome3YCagr } : {}),
                financialsSynced: new Date(),
              },
            })
            .catch(() => {});
          done++;
        }
        await bumpCounters({ financialsDone: done });
        await sleep(300);
      }
    } catch (e) {
      console.error("[trickle] financials:", e instanceof Error ? e.message : e);
    } finally {
      g.__tpFinancialsTrickle = false;
    }
  })();
}
