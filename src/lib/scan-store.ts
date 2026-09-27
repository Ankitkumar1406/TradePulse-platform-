/**
 * Scan results store — pipeline Step 3.
 *
 * The 39 fixed scanners are precomputed once per EOD session (nightly, in the
 * background) and their full wire payloads cached in ScanResult(scannerId,
 * date). A user click then reads ONE cached row and JSON.parses it —
 * single-digit milliseconds — instead of re-running the scan against the DB.
 * Rows are also written lazily here on a cache miss, so the very first click
 * after a new session backfills its own cache.
 *
 * This module deliberately does NOT import the scanner catalog (avoids a
 * circular dependency: scanners.ts imports the loaders below); the nightly
 * sweep lives in pipeline.ts.
 */

import { db } from "@/lib/db";
import { expectedLatestBarDate } from "@/lib/bar-sync";
import type { ScanResult } from "@/lib/scanners";

interface DateGlobals {
  __tpDataDateCache?: { date: string | null; at: number };
}
const g = globalThis as unknown as DateGlobals;

const DATE_TTL_MS = 60 * 1000;

/**
 * The data session scanner results are keyed on: the precomputed metrics
 * date when the pipeline has run, else the latest EOD quote date. Cached
 * for 60s so the hot scanner path adds at most one tiny PK read.
 */
export async function currentDataDate(): Promise<string | null> {
  if (g.__tpDataDateCache && Date.now() - g.__tpDataDateCache.at < DATE_TTL_MS) {
    return g.__tpDataDateCache.date;
  }
  const state = await db.syncState.findUnique({ where: { id: "main" }, select: { metricsDate: true } });
  const date = state?.metricsDate ?? (await expectedLatestBarDate());
  g.__tpDataDateCache = { date, at: Date.now() };
  return date;
}

export function invalidateDataDateCache(): void {
  g.__tpDataDateCache = undefined;
}

/** Cached scan output for (scannerId, date) — or the newest available session when date is omitted. */
export async function loadCachedScan(
  scannerId: string,
  date?: string
): Promise<ScanResult | null> {
  const row = date
    ? await db.scanResult.findUnique({
        where: { scannerId_date: { scannerId, date } },
        select: { resultJson: true },
      })
    : await db.scanResult.findFirst({
        where: { scannerId },
        orderBy: { date: "desc" },
        select: { resultJson: true },
      });
  if (!row) return null;
  try {
    return JSON.parse(row.resultJson) as ScanResult;
  } catch {
    return null;
  }
}

/** Persist a scan result for the session (upsert) and prune stale sessions. */
export async function saveScanResult(
  scannerId: string,
  date: string,
  result: ScanResult,
  durationMs: number
): Promise<void> {
  const resultJson = JSON.stringify(result);
  await db.scanResult.upsert({
    where: { scannerId_date: { scannerId, date } },
    create: {
      scannerId,
      date,
      resultJson,
      rowCount: result.rows.length,
      scanned: result.scanned,
      durationMs: Math.round(durationMs),
    },
    update: {
      resultJson,
      rowCount: result.rows.length,
      scanned: result.scanned,
      durationMs: Math.round(durationMs),
      computedAt: new Date(),
    },
  });
  // Hygiene: keep the last 5 sessions of cached scan output.
  const dates = await db.scanResult.findMany({
    where: { scannerId },
    orderBy: { date: "desc" },
    distinct: ["date"],
    select: { date: true },
  });
  if (dates.length > 5) {
    const cutoff = dates[4].date;
    await db.scanResult.deleteMany({ where: { date: { lt: cutoff } } });
  }
}
