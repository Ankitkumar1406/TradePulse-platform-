/**
 * Universe sync pipeline. Modes:
 *  - "full":    first fill — universe quotes, then all closes/indicators
 *  - "refresh": universe quotes + stale closes (manual Refresh button)
 *  - "daily":   the 4 pm IST EOD auto-update — quotes + stale closes + kickers
 *
 * Single-flight: one sync at a time (globalThis guard + SyncState row).
 */

import { db } from "@/lib/db";
import { fetchUniversePage, fetchSpark, type ScreenerQuote, type SparkPoint } from "@/lib/yahoo";
import { computeIndicators, computeExtendedIndicators } from "@/lib/indicators";
import { evaluateAlerts } from "@/lib/alerts";
import { startSectorTrickle, startBarsTrickle, startEarningsTrickle } from "@/lib/trickle";
import { nextAutoUpdateIso } from "@/lib/scheduler";

export const STALE_DATA_MS = 20 * 3600 * 1000;

export type SyncMode = "full" | "refresh" | "daily";

interface SyncGlobals {
  __tpSyncRunning?: boolean;
}
const g = globalThis as unknown as SyncGlobals;

export async function startSync(mode: SyncMode): Promise<{ started: boolean }> {
  if (g.__tpSyncRunning) return { started: false };

  const state = await db.syncState.findUnique({ where: { id: "main" } });
  const stockCount = await db.stock.count();

  if (stockCount === 0 && mode !== "full") mode = "full";

  g.__tpSyncRunning = true;
  await db.syncState.upsert({
    where: { id: "main" },
    create: { id: "main", phase: "universe", status: "running", startedAt: new Date(), lastError: null },
    update: { phase: "universe", status: "running", startedAt: new Date(), lastError: null },
  });

  // Run in the background — the caller gets an immediate ack.
  void runSync(mode).finally(() => {
    g.__tpSyncRunning = false;
  });
  return { started: true };
}

async function runSync(mode: SyncMode) {
  try {
    if (mode === "full") {
      await runUniversePhase();
      await runClosesPhase();
    } else {
      // refresh / daily: quotes first, then refresh anything stale
      await Promise.all([
        runUniversePhase().catch((e) => console.error("[sync] universe phase:", e.message)),
        runClosesPhase().catch((e) => console.error("[sync] closes phase:", e.message)),
      ]);
    }

    await db.syncState.updateMany({ where: { id: "main" }, data: { phase: "done", status: "done" } });

    // Side pipelines — non-blocking background tricles
    startSectorTrickle();
    startBarsTrickle();
    startEarningsTrickle();

    await evaluateAlerts();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync] failed:", msg);
    await db.syncState
      .updateMany({ where: { id: "main" }, data: { status: "error", lastError: msg.slice(0, 500) } })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------- universe

async function runUniversePageLoop() {
  let offset = 0;
  let total = Infinity;
  let processed = 0;
  const pageSize = 250;

  while (offset < total) {
    const { total: t, quotes } = await fetchUniversePage(offset, pageSize);
    total = t;
    if (quotes.length === 0) break;
    await upsertQuotes(quotes);
    processed += quotes.length;
    offset += pageSize;
    await db.syncState.updateMany({
      where: { id: "main" },
      data: { universeTotal: total, universeDone: processed },
    });
    await sleep(250);
  }
}

async function upsertQuotes(quotes: ScreenerQuote[]) {
  const now = new Date();
  for (const q of quotes) {
    if (!q.symbol) continue;
    const data = {
      name: q.longName || q.shortName || q.symbol,
      exchangeCode: q.exchange ?? null,
      price: q.regularMarketPrice ?? null,
      prevClose: q.regularMarketPreviousClose ?? null,
      changePct: q.regularMarketChangePercent ?? null,
      open: q.regularMarketOpen ?? null,
      dayHigh: q.regularMarketDayHigh ?? null,
      dayLow: q.regularMarketDayLow ?? null,
      volume: q.regularMarketVolume ?? null,
      avgVol3M: q.averageDailyVolume3Month ?? null,
      marketCap: q.marketCap ?? null,
      peTTM: q.trailingPE ?? null,
      epsTTM: q.epsTrailingTwelveMonths ?? null,
      bookValue: q.bookValue ?? null,
      pbRatio: q.priceToBook ?? null,
      divYield: q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : null,
      high52: q.fiftyTwoWeekHigh ?? null,
      low52: q.fiftyTwoWeekLow ?? null,
      sma50Yahoo: q.fiftyDayAverage ?? null,
      sma200Yahoo: q.twoHundredDayAverage ?? null,
      universeSynced: now,
      quoteTime: q.regularMarketTime ? new Date(q.regularMarketTime * 1000) : now,
    };
    await db.stock.upsert({ where: { symbol: q.symbol }, create: { symbol: q.symbol, ...data }, update: data });
  }
}

async function runUniversePhase() {
  await db.syncState.updateMany({ where: { id: "main" }, data: { phase: "universe", status: "running" } });
  await runUniversePageLoop();
}

// ---------------------------------------------------------------- closes

async function runClosesPhase(opts?: { staleCutoff?: Date }) {
  await db.syncState.updateMany({ where: { id: "main" }, data: { phase: "closes", status: "running" } });

  const staleCutoff = opts?.staleCutoff ?? new Date(Date.now() - STALE_DATA_MS);
  const where =
    opts?.staleCutoff == null
      ? { price: { not: null } }
      : { price: { not: null }, OR: [{ closesSynced: null }, { closesSynced: { lt: staleCutoff } }] };

  const stocks = await db.stock.findMany({
    where,
    select: { symbol: true, high52: true, low52: true, volume: true, avgVol3M: true },
    orderBy: { marketCap: "desc" },
  });

  const total = stocks.length;
  await db.syncState.updateMany({ where: { id: "main" }, data: { closesTotal: total, closesDone: 0 } });
  if (total === 0) return;

  // Yahoo spark caps symbols per request (400 above ~20) — keep batches small
  const batchSize = 20;
  let done = 0;
  for (let i = 0; i < stocks.length; i += batchSize) {
    const batch = stocks.slice(i, i + batchSize);
    const symbols = batch.map((s) => s.symbol);
    try {
      const sparks = await fetchSpark(symbols, "2y");
      const bySymbol = new Map(sparks.map((s) => [s.symbol, s]));
      for (const stock of batch) {
        const spark = bySymbol.get(stock.symbol);
        if (!spark) continue;
        const ok = await applySparkToStock(stock, spark);
        if (ok) done++;
      }
    } catch (e) {
      console.error("[sync] spark batch failed:", e instanceof Error ? e.message : e);
    }
    await db.syncState.updateMany({ where: { id: "main" }, data: { closesDone: done } });
    await sleep(300);
  }
}

async function applySparkToStock(
  stock: { symbol: string; high52: number | null; low52: number | null; volume: number | null; avgVol3M: number | null },
  spark: SparkPoint
): Promise<boolean> {
  const series: [number, number][] = [];
  for (let i = 0; i < spark.timestamp.length; i++) {
    const c = spark.close[i];
    if (c != null && Number.isFinite(c)) series.push([spark.timestamp[i], c]);
  }
  if (series.length < 30) return false;

  const closes = series.map((s) => s[1]);
  const ind = computeIndicators(closes);
  const ext = computeExtendedIndicators(series);
  const price = closes[closes.length - 1];

  const high52 = stock.high52 ?? Math.max(...closes);
  const low52 = stock.low52 ?? Math.min(...closes);
  const fromHighPct = high52 > 0 ? Math.max(0, ((high52 - price) / high52) * 100) : null;
  const fromLowPct = low52 > 0 ? Math.max(0, ((price - low52) / low52) * 100) : null;
  const volSpike = stock.volume != null && stock.avgVol3M != null && stock.avgVol3M > 0 ? stock.volume > 2 * stock.avgVol3M : null;

  const data = {
    sma20: ind.sma20,
    sma50: ind.sma50,
    sma200: ind.sma200,
    ema20: ind.ema20,
    rsi14: ind.rsi14,
    macd: ind.macd,
    macdSignal: ind.macdSignal,
    macdHist: ind.macdHist,
    atr14Pct: ind.atr14Pct,
    mom1M: ind.mom1M,
    mom3M: ind.mom3M,
    mom6M: ind.mom6M,
    fromHighPct,
    fromLowPct,
    aboveSma20: ind.aboveSma20,
    aboveSma50: ind.aboveSma50,
    aboveSma200: ind.aboveSma200,
    goldenCross: ind.goldenCross,
    volSpike,
    wRsi14: ext.wRsi14,
    wMacdHist: ext.wMacdHist,
    bbPctB: ext.bbPctB,
    bbWidthPct: ext.bbWidthPct,
    emaCross: ext.emaCross,
    distSma20Pct: ext.distSma20Pct,
    distSma50Pct: ext.distSma50Pct,
    distSma100Pct: ext.distSma100Pct,
    distSma200Pct: ext.distSma200Pct,
    distEma20Pct: ext.distEma20Pct,
    distEma50Pct: ext.distEma50Pct,
    distEma100Pct: ext.distEma100Pct,
    distEma200Pct: ext.distEma200Pct,
    closes: JSON.stringify(series),
    closesSynced: new Date(),
  };
  await db.stock.update({ where: { symbol: stock.symbol }, data });
  return true;
}

// ---------------------------------------------------------------- status

export async function getSyncStatus() {
  const [state, lastQuote] = await Promise.all([
    db.syncState.findUnique({ where: { id: "main" } }),
    db.stock.aggregate({ _max: { quoteTime: true } }),
  ]);
  const stockCount = await db.stock.count();
  return {
    phase: state?.phase ?? "idle",
    status: state?.status ?? "idle",
    universeTotal: state?.universeTotal ?? 0,
    universeDone: state?.universeDone ?? 0,
    closesTotal: state?.closesTotal ?? 0,
    closesDone: state?.closesDone ?? 0,
    sectorsTotal: state?.sectorsTotal ?? 0,
    sectorsDone: state?.sectorsDone ?? 0,
    barsTotal: state?.barsTotal ?? 0,
    barsDone: state?.barsDone ?? 0,
    earningsTotal: state?.earningsTotal ?? 0,
    earningsDone: state?.earningsDone ?? 0,
    lastError: state?.lastError ?? null,
    stockCount,
    lastQuoteTime: lastQuote._max.quoteTime ? lastQuote._max.quoteTime.toISOString() : null,
    nextAutoUpdate: nextAutoUpdateIso(),
  };
}

// ---------------------------------------------------------------- utils

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
