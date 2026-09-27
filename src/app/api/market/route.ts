import { NextResponse } from "next/server";
import { db, descNullsLast } from "@/lib/db";
import { fetchIndices } from "@/lib/yahoo";
import { evaluateAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CacheEntry {
  at: number;
  data: unknown;
}
const g = globalThis as unknown as {
  __marketCache?: Partial<Record<string, CacheEntry>>;
};

export async function GET(req: Request) {
  try {
    const now = Date.now();
    const url = new URL(req.url);
    // movers=liquid (default) keeps circuit-filter penny noise out of the
    // Gainers/Losers lists: price ≥ ₹10, turnover (price × volume) ≥ ₹1 Cr,
    // market cap ≥ ₹100 Cr. movers=all restores the raw lists.
    const moversMode = url.searchParams.get("movers") === "all" ? "all" : "liquid";

    // --- Indices (10 min cache; slow calls) ---
    const idxCache = g.__marketCache?.indices;
    let indices;
    if (idxCache && now - idxCache.at < 10 * 60 * 1000) {
      indices = idxCache.data;
    } else {
      indices = await fetchIndices();
      (g.__marketCache ??= {}).indices = { at: now, data: indices };
    }

    // --- Breadth + movers + sectors from DB (30s cache, per movers mode) ---
    const pCache = g.__marketCache?.[`payload_${moversMode}`];
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

    // Circuit filters (ADSL/XELPMOC-style upper-circuit names) dominate raw
    // changePct ranks. In liquid mode fetch a wider candidate window then keep
    // only names with ≥ ₹1 Cr actually traded today (price × volume).
    async function movers(dir: "desc" | "asc") {
      if (moversMode === "all") {
        return db.stock.findMany({ where: liquid, orderBy: dir === "desc" ? descNullsLast("changePct") : { changePct: dir }, take: 10, select });
      }
      const candidates = await db.stock.findMany({
        where: { ...liquid, price: { gte: 10 }, volume: { gte: 20_000 } },
        orderBy: dir === "desc" ? descNullsLast("changePct") : { changePct: dir },
        take: 80,
        select,
      });
      return candidates.filter((r) => r.price != null && r.volume != null && r.price * r.volume >= 1e7).slice(0, 10);
    }

    const [gainers, losers, mostActive, sectors] = await Promise.all([
      movers("desc"),
      movers("asc"),
      db.stock.findMany({
        where: base,
        orderBy: [descNullsLast("volume"), descNullsLast("marketCap")],
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
    (g.__marketCache ??= {})[`payload_${moversMode}`] = { at: now, data: payload };

    return NextResponse.json({ indices, ...payload, alertsTriggered });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "market failed" }, { status: 500 });
  }
}
