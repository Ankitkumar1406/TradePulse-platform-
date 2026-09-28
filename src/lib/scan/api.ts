/**
 * Scan builder — server API bridge for the v3 wire payload.
 *
 * `{ v: 3, scan: Scan }` is the sentence builder's wire format. The evaluator
 * returns matching symbols; this layer applies the Universe-bar filters and
 * sector on the store's snapshot (in JS), then sorts/pages and enriches with
 * the stock table rows the results table renders.
 */
import { NextResponse } from "next/server";
import { db, toPgSql } from "@/lib/db";
import { FNO_UNIVERSE, NIFTY50_UNIVERSE, universeToDbSymbols } from "@/lib/fno-universe";
import type { Scan } from "./expr-model";
import { validateScan, runScan, debugClauseFull, type DebugRow } from "./evaluate";
import { getStore } from "./columns";

export interface V3CondPayload {
  v: 3;
  scan: Scan;
  /** baseline universe filters carried alongside the scan (Universe bar) */
  uni?: { universe?: string; minPrice?: string; minMcapCr?: string; minTurnoverCr?: string };
}

export function isV3Payload(x: unknown): x is V3CondPayload {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return p.v === 3 && !!p.scan && typeof p.scan === "object" && (p.scan as { root?: unknown }).root != null;
}

const STOCK_SELECT_V3 = {
  symbol: true, name: true, price: true, changePct: true, volume: true, marketCap: true,
  sector: true, rsi14: true, mom1M: true, mom3M: true, mom6M: true, peTTM: true,
  fromHighPct: true, fromLowPct: true, aboveSma50: true, aboveSma200: true,
} as const;

export async function runScanV3(
  payload: V3CondPayload,
  url: URL,
  sort: string,
  dir: "asc" | "desc",
  page: number,
  perPage: number,
): Promise<NextResponse> {
  const scan = payload.scan;
  const v = validateScan(scan);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const sector = url.searchParams.get("sector") ?? "";
  const universe = url.searchParams.get("universe") ?? payload.uni?.universe ?? "all";
  const minPrice = Number(url.searchParams.get("minPrice") ?? payload.uni?.minPrice ?? "") || null;
  const minMcapCr = Number(url.searchParams.get("minMcapCr") ?? payload.uni?.minMcapCr ?? "") || null;
  const minTurnoverCr = Number(url.searchParams.get("minTurnoverCr") ?? payload.uni?.minTurnoverCr ?? "") || null;
  const wantCols = url.searchParams.get("cols");
  const debugSym = url.searchParams.get("debugSymbols");

  // restrict sets
  let restrict: Set<string> | null = null;
  if (universe === "n50") restrict = new Set(universeToDbSymbols(NIFTY50_UNIVERSE));
  else if (universe === "fno") restrict = new Set(universeToDbSymbols(FNO_UNIVERSE));

  const result = await runScan(scan, { restrictSymbols: restrict });
  const store = await getStore();

  // universe-bar + sector filters over the store snapshot
  let matched = result.matched;
  if (sector && sector !== "all") {
    matched = matched.filter((sym) => store.rows[store.bySym.get(sym)!]?.sector === sector);
  }
  if (minPrice != null && minPrice > 0) {
    matched = matched.filter((sym) => {
      const p = store.snap.price[store.bySym.get(sym)!];
      return Number.isFinite(p) && p >= minPrice;
    });
  }
  if (minMcapCr != null && minMcapCr > 0) {
    matched = matched.filter((sym) => {
      const m = store.snap.marketCap[store.bySym.get(sym)!];
      return Number.isFinite(m) && m >= minMcapCr * 1e7;
    });
  }
  if (minTurnoverCr != null && minTurnoverCr > 0) {
    matched = matched.filter((sym) => {
      const si = store.bySym.get(sym)!;
      const c = store.snap.price[si], v = store.snap.volume[si];
      return Number.isFinite(c) && Number.isFinite(v) && c * v >= minTurnoverCr * 1e7;
    });
  }
  // n500 approximation: top 500 by market cap of the matched list
  if (universe === "n500") {
    matched = matched
      .map((sym) => ({ sym, m: store.snap.marketCap[store.bySym.get(sym)!] }))
      .filter((x) => Number.isFinite(x.m))
      .sort((a, b) => b.m - a.m)
      .slice(0, 500)
      .map((x) => x.sym);
  }

  // debug mode — per-side values for the requested symbols
  if (debugSym) {
    let clause: unknown = null;
    try { clause = JSON.parse(url.searchParams.get("clause") ?? "null"); } catch { /* handled below */ }
    if (!clause) return NextResponse.json({ error: "debugSymbols needs a clause" }, { status: 400 });
    const rows: DebugRow[] = await debugClauseFull(clause as never, matched.slice(0, 3).concat(debugSym.split(",").slice(0, 8)));
    return NextResponse.json({ debug: rows });
  }

  // page + rows
  const total = matched.length;
  const pageSymbols = matched.slice((page - 1) * perPage, page * perPage);
  const rows = pageSymbols.length
    ? await db.stock.findMany({ where: { symbol: { in: pageSymbols } }, select: STOCK_SELECT_V3 })
    : [];
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const stocks = pageSymbols
    .map((s) => bySymbol.get(s))
    .filter((r): r is (typeof rows)[number] => Boolean(r)) as unknown as Record<string, unknown>[];

  // sort by the stock-table field, nulls last
  const sortVal = (r: Record<string, unknown>): number | null => {
    const v = r[sort];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  stocks.sort((a, b) => {
    const av = sortVal(a), bv = sortVal(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last regardless of direction
    if (bv == null) return -1;
    return dir === "desc" ? bv - av : av - bv;
  });

  // relative-volume context for the visible page (same shape as the other paths)
  const volAvg = new Map<string, number>();
  if (pageSymbols.length > 0) {
    const vrows: { symbol: string; avgVol: unknown }[] = await db.$queryRawUnsafe(
      toPgSql(`SELECT symbol, AVG(volume) AS avgVol
         FROM (SELECT symbol, volume,
                      ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                 FROM "DailyBar" WHERE symbol IN (${pageSymbols.map(() => "?").join(",")}))
        WHERE rn BETWEEN 2 AND 21
        GROUP BY symbol`),
      ...pageSymbols,
    );
    for (const r of vrows) {
      const avg = Number(r.avgVol);
      if (Number.isFinite(avg) && avg > 0) volAvg.set(r.symbol, avg);
    }
  }
  const enriched = stocks.map((s) => {
    const volAvg20 = volAvg.get(s.symbol as string) ?? null;
    const volume = s.volume as number | null;
    const relVol = volAvg20 != null && volume != null && volume > 0 ? volume / volAvg20 : null;
    return { ...s, volAvg20, relVol } as Record<string, unknown> & { volAvg20: number | null; relVol: number | null; symbol: string };
  });

  // "Show computed value" columns — left/right of the first clauses, capped at 6
  if (wantCols && pageSymbols.length > 0) {
    try {
      const parsedCols: unknown = JSON.parse(wantCols);
      const colClauses = (Array.isArray(parsedCols) ? parsedCols : [])
        .slice(0, 6) as { side: "left" | "right"; clauseIndex: number }[];
      if (colClauses.length > 0) {
        const flat: { clauseIndex: number; side: "left" | "right" }[] = colClauses;
        // evaluate by walking the scan tree's clauses in order
        const clauses: { left: unknown; right: unknown }[] = [];
        const collect = (g: Scan["root"]) => {
          for (const c of g.children) {
            if (!c.enabled) continue;
            if (c.kind === "group") collect(c);
            else clauses.push({ left: c.left, right: c.right });
          }
        };
        collect(scan.root);
        const { exprScalar } = await import("./attr-series");
        for (const s of enriched) {
          const si = store.bySym.get(s.symbol as string);
          if (si == null) continue;
          const sess = { store, si };
          const vals = flat.map(({ clauseIndex, side }) => {
            const cl = clauses[clauseIndex];
            if (!cl) return null;
            const expr = side === "left" ? (cl.left as never) : (cl.right as never);
            const v = exprScalar(sess, expr, "daily", 0);
            return Number.isNaN(v) ? null : Math.round(v * 1e4) / 1e4;
          });
          (s as { computed?: (number | null)[] }).computed = vals;
        }
      }
    } catch {
      // computed values are a nicety — never fail the screen
    }
  }

  const sectors = await db.stock.groupBy({
    by: ["sector"],
    where: { sector: { notIn: ["Unknown"] } },
    _count: { symbol: true },
    orderBy: { sector: "asc" },
  });

  return NextResponse.json({
    total,
    page,
    perPage,
    condCount: countClauses(scan),
    stocks: enriched,
    sectors: sectors.map((s) => s.sector).filter(Boolean),
    meta: {
      engine: "v3",
      dataDate: store.maxDate,
      universe: result.totalUniverse,
      fundAvailable: result.fundAvailable,
      skipped: result.skipped,
      unevaluable: result.unevaluable,
    },
  });
}

function countClauses(scan: Scan): number {
  let count = 0;
  const walk = (g: Scan["root"]) => {
    for (const c of g.children) {
      if (c.kind === "group") walk(c);
      else if (c.enabled) count++;
    }
  };
  walk(scan.root);
  return count;
}
