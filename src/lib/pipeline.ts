/**
 * Post-ingest precompute pipeline — the orchestrator for Steps 2 + 3.
 *
 *   ingest (sync.ts: universe quotes → closes → bars trickle)  [Step 1]
 *      ↓  once the session's bars have fully landed
 *   computeStockMetrics()     → StockMetrics (flat wide table)   [Step 2]
 *      ↓
 *   precomputeAllScans()      → ScanResult (one row/scanner)     [Step 3]
 *
 * Triggered by the scheduler's 10-minute sweeper whenever the metrics date
 * is behind the latest EOD session AND the bars have caught up, plus once
 * directly at the end of a successful sync. Single-flight on both levels.
 * Nothing here ever runs inside a request handler.
 */

import { db } from "@/lib/db";
import { SCANS, type ScanDef, type ScanResult, setScanCache } from "@/lib/scanners";
import { saveScanResult } from "@/lib/scan-store";
import { computeStockMetrics } from "@/lib/metrics";

interface PipelineGlobals {
  __tpPostPipelineRunning?: boolean;
  __tpScansPrecomputeRunning?: boolean;
}
const g = globalThis as unknown as PipelineGlobals;

/** Run every fixed scanner once and cache the output for the current session. */
export async function precomputeAllScans(opts?: { date?: string }): Promise<{
  date: string | null;
  computed: number;
  failed: number;
  totalMs: number;
}> {
  if (g.__tpScansPrecomputeRunning) {
    return { date: opts?.date ?? null, computed: 0, failed: 0, totalMs: 0 };
  }
  g.__tpScansPrecomputeRunning = true;
  const t0 = Date.now();
  let computed = 0;
  let failed = 0;
  try {
    let date: string | null = opts?.date ?? null;
    if (!date) {
      const s = await db.syncState.findUnique({
        where: { id: "main" },
        select: { metricsDate: true },
      });
      date = s?.metricsDate ?? null;
    }
    let rowCount = 0;
    for (const scan of SCANS) {
      try {
        const s0 = Date.now();
        const result = await scan.run();
        const durationMs = Date.now() - s0;
        if (date) await saveScanResult(scan.id, date, result, durationMs);
        setScanCache(scan.id, result);
        rowCount += result.rows.length;
        computed++;
      } catch (e) {
        failed++;
        console.error(`[pipeline] scan ${scan.id} failed:`, e instanceof Error ? e.message : e);
      }
      // let queued API renders run between scans
      await new Promise((r) => setImmediate(r));
    }
    if (date) {
      await db.syncState.updateMany({
        where: { id: "main" },
        data: { scansDate: date, scansSyncedAt: new Date() },
      }).catch(() => {});
    }
    const totalMs = Date.now() - t0;
    console.log(
      `[pipeline] scan results cached for ${date}: ${computed}/${SCANS.length} scanners, ${rowCount} rows, ${(totalMs / 1000).toFixed(1)}s${failed ? `, ${failed} failed` : ""}`
    );
    return { date, computed, failed, totalMs };
  } finally {
    g.__tpScansPrecomputeRunning = false;
  }
}

/**
 * Metrics → scans, the full post-ingest chain. Returns the metrics outcome;
 * scans only run when metrics were actually (re)computed.
 */
export async function runPostSyncPipeline(opts?: { force?: boolean }): Promise<{
  metrics: Awaited<ReturnType<typeof computeStockMetrics>>;
  scans?: Awaited<ReturnType<typeof precomputeAllScans>>;
}> {
  if (g.__tpPostPipelineRunning) {
    return { metrics: { ok: false, date: null, rows: 0, reason: "already-running" } };
  }
  g.__tpPostPipelineRunning = true;
  try {
    const metrics = await computeStockMetrics({ force: opts?.force });
    if (metrics.ok && metrics.date) {
      const scans = await precomputeAllScans({ date: metrics.date });
      return { metrics, scans };
    }
    return { metrics };
  } finally {
    g.__tpPostPipelineRunning = false;
  }
}

export function isPostPipelineRunning(): boolean {
  return Boolean(g.__tpPostPipelineRunning || g.__tpScansPrecomputeRunning);
}

/** Catalog access for ops scripts (precompute-only runs). */
export function allScans(): ScanDef[] {
  return SCANS;
}
export type { ScanResult };
