import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchIndices } from "@/lib/yahoo";
import { evaluateAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CacheEntry {
  at: number;
  data: unknown;
}
const g = globalThis as unknown as {
  __marketCache?: Partial<{ indices: CacheEntry; payload: CacheEntry }>;
};

export async function GET() {
  try {
    const now = Date.now();

    // --- Indices (10 min cache; slow calls) ---
    const idxCache = g.__marketCache?.indices;
    let indices;
    if (idxCache && now - idxCache.at < 10 * 60 * 1000) {
      indices = idxCache.data;
    } else {
      indices = await fetchIndices();
      (g.__marketCache ??= {}).indices = { at: now, data: indices };
    }

    // --- Breadth + movers + sectors from DB (30s cache) ---
    const pCache = g.__marketCache?.payload;
    if (pCache && now - pCache.at < 30 * 1000) {
      return NextResponse.json({ indices, ...(pCache.data as object), alertsTriggered: 0 });
    }

    const base = {
      price: { not: null },
      changePct: { not: null },
    };

    const [advances, declines, unchanged, total] = await Promise.all([
      db.stock.count({ where: { ...base, changePct: { gt: 0.05 } } }),
      db.stock.count({ where: { ...base, changePct: { lt: -0.05 } } }),
      db.stock.count({ where: { ...base, changePct: { gte: -0.05, lte: 0.05 } } }),
      db.stock.count({ where: { changePct: { not: null } } }),
    ]);

    // Participation breadth
    const [aboveSma20, aboveSma50, aboveSma200, newHighs, newLows] = await Promise.all([
      db.stock.count({ where: { ...base, aboveSma20: true } }),
      db.stock.count({ where: { ...base, aboveSma50: true } }),
      db.stock.count({ where: { ...base, aboveSma200: true } }),
      db.stock.count({ where: { ...base, fromHighPct: { lte: 0.5 } } }),
      db.stock.count({ where: { ...base, fromLowPct: { lte: 0.5 } } }),
    ]);

    const select = {
      symbol: true, name: true, price: true, changePct: true, volume: true,
      marketCap: true, sector: true, high52: true, low52: true, rsi14: true,
    };

    const liquid = { ...base, marketCap: { gte: 1e9 } }; // >= 100 Cr to avoid micro-cap noise

    const [gainers, losers, mostActive, sectors] = await Promise.all([
      db.stock.findMany({ where: liquid, orderBy: { changePct: "desc" }, take: 10, select }),
      db.stock.findMany({ where: liquid, orderBy: { changePct: "asc" }, take: 10, select }),
      db.stock.findMany({
        where: base,
        orderBy: [{ volume: "desc" }, { marketCap: "desc" }],
        take: 10,
        select: { ...select },
      }),
      db.stock.groupBy({
        by: ["sector"],
        where: { sector: { notIn: ["Unknown"] }, ...base },
        _avg: { changePct: true },
        _count: { symbol: true },
        _sum: { marketCap: true },
        orderBy: { _avg: { changePct: "desc" } },
      }),
    ]);

    const alertsTriggered = await evaluateAlerts();

    const payload = {
      breadth: { advances, declines, unchanged, total, aboveSma20, aboveSma50, aboveSma200, newHighs, newLows },
      gainers,
      losers,
      mostActive,
      sectors: sectors
        .filter((s) => s.sector)
        .map((s) => ({
          sector: s.sector as string,
          avgChangePct: s._avg.changePct ?? 0,
          count: s._count.symbol,
          totalMcap: s._sum.marketCap ?? 0,
        })),
    };
    (g.__marketCache ??= {}).payload = { at: now, data: payload };

    return NextResponse.json({ indices, ...payload, alertsTriggered });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "market failed" }, { status: 500 });
  }
}
