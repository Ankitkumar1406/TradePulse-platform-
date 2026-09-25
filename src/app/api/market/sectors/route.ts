import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveTaxonomy } from "@/lib/taxonomy";
import { SUB_TO_GRP } from "@/lib/bp-taxonomy";

export const dynamic = "force-dynamic";

/**
 * Sector rotation data for /market/rotation:
 *
 *  - levels.sector / levels.industry / levels.subgroup — one row per group:
 *      avgRs (mean RS percentile of its ranked stocks), mom (Δ RS vs last
 *      month), prev (the group's position one month ago, for the map's
 *      trails), quads (its stocks' quadrant counts), leaders, rank.
 *  - stocks — per-stock rows for the Stocks level and the detail drawer,
 *      each with rs, rs momentum and a ranking status.
 *  - taxonomy — the full sector hierarchy (58 industries, 181
 *      subgroups) for the filter dropdowns.
 *
 * RS = percentile of the 6-month return across the universe. A stock's
 * "position last month" re-ranks the 6M return that ended one month ago
 * (closes[-21] / closes[-147] - 1 from the stored 2y close series, with a
 * mom6M/mom1M backed-out proxy when the series is short).
 */

const CACHE_MS = 10 * 60 * 1000;
const MCAP_LEADER_FLOOR = 5e9; // ₹500 cr — reference's ranked-stock floor for leaders
const MIN_GROUP = 4; // reference rule: groups need >= 4 ranked stocks
const YOUNG_BARS = 250; // ~1 trading year of closes before a stock is ranked

interface GroupRow {
  level: "sector" | "industry" | "subgroup";
  name: string;
  count: number;
  ranked: number;
  avgRs: number | null;
  mom: number | null;
  prev: { rs: number; mom: number } | null;
  quads: { lead: number; impr: number; weak: number; lag: number };
  leaders: { symbol: string; name: string; rs: number; rsMom: number | null; changePct: number }[];
  rank: number | null;
}

interface StockRow {
  symbol: string;
  name: string;
  sector: string;
  indGrp: string;
  subGrp: string;
  rs: number | null;
  mom: number | null;
  changePct: number;
  price: number | null;
  marketCap: number | null;
  status: "ranked" | "illiquid" | "young" | "nodata";
}

interface Payload {
  levels: { sector: GroupRow[]; industry: GroupRow[]; subgroup: GroupRow[] };
  stocks: StockRow[];
  taxonomy: { industries: string[]; subGroupsByIndustry: { industry: string; subgroups: string[] }[] };
  updatedAt: string | null;
}

function quadOf(rs: number, mom: number): "lead" | "impr" | "weak" | "lag" {
  return rs >= 50 ? (mom >= 0 ? "lead" : "weak") : mom >= 0 ? "impr" : "lag";
}

function percentileFactory() {
  const sorted: number[] = [];
  return {
    push(v: number) { sorted.push(v); },
    done() { sorted.sort((a, b) => a - b); },
    pct(v: number) {
      let lo = 0;
      for (const r of sorted) if (r < v) lo++;
      return Math.round((lo / Math.max(1, sorted.length - 1)) * 99);
    },
  };
}

export async function GET() {
  try {
    const g = globalThis as unknown as { __tpSectorAnalytics?: { at: number; data: Payload } };
    const now = Date.now();
    if (g.__tpSectorAnalytics && now - g.__tpSectorAnalytics.at < CACHE_MS) {
      return NextResponse.json(g.__tpSectorAnalytics.data);
    }

    // ---- one pass over the universe ---------------------------------------
    const stocks = await db.stock.findMany({
      where: { price: { not: null } },
      select: {
        symbol: true, name: true, price: true, changePct: true, marketCap: true,
        sector: true, industry: true, indGrp: true, subGrp: true,
        mom6M: true, mom1M: true, closes: true,
      },
    });

    const retNow: number[] = [];
    const retPrev: number[] = [];
    const retPrev2: number[] = [];
    interface Calc {
      symbol: string; name: string; price: number | null; changePct: number; marketCap: number | null;
      sector: string; indGrp: string; subGrp: string;
      retNow: number | null; retPrev: number | null; retPrev2: number | null;
      young: boolean; closesLen: number;
    }
    const calcs: Calc[] = [];

    for (const s of stocks) {
      const tax = resolveTaxonomy(s.symbol, s.sector, s.industry);
      const indGrp = s.indGrp ?? tax.grp;
      const subGrp = s.subGrp ?? tax.sub;
      const sector = s.sector ?? "Unknown";

      let closes: number[] = [];
      if (s.closes) {
        try {
          const series = JSON.parse(s.closes) as [number, number][];
          for (const p of series) if (p[1] != null && Number.isFinite(p[1])) closes.push(p[1]);
        } catch { /* malformed — treat as missing */ }
      }
      const n = closes.length;
      const m6 = s.mom6M != null ? s.mom6M / 100 : null;
      const m1 = s.mom1M != null ? s.mom1M / 100 : null;

      let rNow: number | null = n >= 127 ? closes[n - 1] / closes[n - 126] - 1 : m6;
      let rPrev: number | null = n >= 148 ? closes[n - 22] / closes[n - 148] - 1 : m6 != null && m1 != null && m1 !== 0 ? (1 + m6) / (1 + m1) - 1 : null;
      let rPrev2: number | null = n >= 169 ? closes[n - 43] / closes[n - 169] - 1 : null;
      if (rNow != null && !Number.isFinite(rNow)) rNow = null;
      if (rPrev != null && !Number.isFinite(rPrev)) rPrev = null;
      if (rPrev2 != null && !Number.isFinite(rPrev2)) rPrev2 = null;

      if (rNow != null) retNow.push(rNow);
      if (rPrev != null) retPrev.push(rPrev);
      if (rPrev2 != null) retPrev2.push(rPrev2);

      calcs.push({
        symbol: s.symbol, name: s.name, price: s.price, changePct: s.changePct ?? 0, marketCap: s.marketCap,
        sector, indGrp, subGrp,
        retNow: rNow, retPrev: rPrev, retPrev2: rPrev2,
        young: n > 0 && n < YOUNG_BARS, closesLen: n,
      });
    }

    const pNow = percentileFactory(); retNow.forEach((v) => pNow.push(v)); pNow.done();
    const pPrev = percentileFactory(); retPrev.forEach((v) => pPrev.push(v)); pPrev.done();
    const pPrev2 = percentileFactory(); retPrev2.forEach((v) => pPrev2.push(v)); pPrev2.done();

    interface StockCalc extends Calc { rs: number | null; rsPrev: number | null; rsPrev2: number | null; mom: number | null; status: StockRow["status"] }
    const ranked: StockCalc[] = [];
    const stockRows: StockRow[] = [];
    for (const c of calcs) {
      const rs = c.retNow != null ? pNow.pct(c.retNow) : null;
      const rsPrev = c.retPrev != null ? pPrev.pct(c.retPrev) : null;
      const rsPrev2 = c.retPrev2 != null ? pPrev2.pct(c.retPrev2) : null;
      const mom = rs != null && rsPrev != null ? rs - rsPrev : null;
      const status: StockRow["status"] =
        rs == null ? "nodata" : c.young ? "young" : (c.marketCap ?? 0) < 1e9 ? "illiquid" : "ranked";
      const sc: StockCalc = { ...c, rs, rsPrev, rsPrev2, mom, status };
      if (rs != null) ranked.push(sc);
      stockRows.push({
        symbol: c.symbol, name: c.name, sector: c.sector, indGrp: c.indGrp, subGrp: c.subGrp,
        rs, mom, changePct: c.changePct, price: c.price, marketCap: c.marketCap, status,
      });
    }

    // ---- group rows --------------------------------------------------------
    function buildGroups(level: GroupRow["level"], keyOf: (s: StockCalc) => string, allCounts: Map<string, number>): GroupRow[] {
      const by = new Map<string, StockCalc[]>();
      for (const s of ranked) {
        const k = keyOf(s);
        const arr = by.get(k);
        if (arr) arr.push(s);
        else by.set(k, [s]);
      }
      const rows: GroupRow[] = [];
      for (const [name, members] of by) {
        const avgRs = Math.round(members.reduce((a, b) => a + (b.rs ?? 0), 0) / members.length);
        const quads = { lead: 0, impr: 0, weak: 0, lag: 0 };
        for (const m of members) {
          if (m.mom == null) continue;
          quads[quadOf(m.rs ?? 0, m.mom)]++;
        }
        // Δ vs last month — paired on members that have a previous rank
        const paired = members.filter((m) => m.rsPrev != null);
        const mom = paired.length >= MIN_GROUP
          ? Math.round((paired.reduce((a, b) => a + (b.rs ?? 0), 0) / paired.length - paired.reduce((a, b) => a + (b.rsPrev ?? 0), 0) / paired.length) * 10) / 10
          : null;
        // position one month ago for the trail
        const paired2 = members.filter((m) => m.rsPrev != null && m.rsPrev2 != null);
        const prev = paired2.length >= MIN_GROUP
          ? (() => {
              const rsP = paired2.reduce((a, b) => a + (b.rsPrev ?? 0), 0) / paired2.length;
              const momP = rsP - paired2.reduce((a, b) => a + (b.rsPrev2 ?? 0), 0) / paired2.length;
              return { rs: Math.round(rsP), mom: Math.round(momP * 10) / 10 };
            })()
          : null;
        const leaders = members
          .filter((m) => (m.marketCap ?? 0) >= MCAP_LEADER_FLOOR && m.status === "ranked")
          .sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0))
          .slice(0, 5)
          .map((m) => ({ symbol: m.symbol, name: m.name, rs: m.rs ?? 0, rsMom: m.mom, changePct: m.changePct }));
        rows.push({
          level, name,
          count: allCounts.get(name) ?? members.length,
          ranked: members.length,
          avgRs: members.length >= MIN_GROUP ? avgRs : null,
          mom, prev, quads, leaders, rank: null,
        });
      }
      rows.sort((a, b) => (b.avgRs ?? -1) - (a.avgRs ?? -1));
      let r = 0;
      for (const row of rows) row.rank = row.avgRs != null ? ++r : null;
      return rows;
    }

    const countBy = (keyOf: (s: Calc) => string) => {
      const m = new Map<string, number>();
      for (const c of calcs) m.set(keyOf(c), (m.get(keyOf(c)) ?? 0) + 1);
      return m;
    };

    const levels: Payload["levels"] = {
      sector: buildGroups("sector", (s) => s.sector, countBy((s) => s.sector)),
      industry: buildGroups("industry", (s) => s.indGrp, countBy((s) => s.indGrp)),
      subgroup: buildGroups("subgroup", (s) => s.subGrp, countBy((s) => s.subGrp)),
    };

    // ---- full taxonomy for the dropdowns (58 industries / 181 subgroups) ---
    const subByInd = new Map<string, Set<string>>();
    for (const [sub, ind] of Object.entries(SUB_TO_GRP)) {
      const set = subByInd.get(ind);
      if (set) set.add(sub);
      else subByInd.set(ind, new Set([sub]));
    }
    const taxonomy: Payload["taxonomy"] = {
      industries: [...subByInd.keys()].sort((a, b) => a.localeCompare(b)),
      subGroupsByIndustry: [...subByInd.entries()]
        .map(([industry, subs]) => ({ industry, subgroups: [...subs].sort((a, b) => a.localeCompare(b)) }))
        .sort((a, b) => a.industry.localeCompare(b.industry)),
    };

    const lastSynced = await db.stock.aggregate({ _max: { closesSynced: true } });
    const payload: Payload = {
      levels,
      stocks: stockRows,
      taxonomy,
      updatedAt: lastSynced._max.closesSynced?.toISOString() ?? null,
    };
    g.__tpSectorAnalytics = { at: now, data: payload };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sector analytics failed" }, { status: 500 });
  }
}
