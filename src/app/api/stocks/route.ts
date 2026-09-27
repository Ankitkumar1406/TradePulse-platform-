import { NextResponse } from "next/server";
import { db, toPgSql } from "@/lib/db";
import {
  CondSemantics,
  ProCompileError,
  ProRowWire,
  isV2Payload,
  proSymbolList,
} from "@/lib/pro-sql";

export const dynamic = "force-dynamic";

/**
 * Screener / stock list. Filters over the universe with server-side paging.
 * Supports `cond` — the condition builder's payload. Two payload shapes:
 *
 *  1. Legacy bare JSON array (old builder — kept working):
 *      [{"f":"rsi14","op":"gt","v":60},
 *       {"kind":"expr","cmp":"gte","l":"close / min(66, low)","r":"1.30"}]
 *     A row with logic:"or" starts a new AND-group; groups OR-combine.
 *
 *  2. Versioned object from the rebuilt visual builder (Task 38):
 *      {"v":2,"rows":[{"kind":"expr","cmp":"gt","l":"close","r":"sma(close, 200)",
 *                      "logic":"and"}]}
 *     The logic chip joins a row to the previous one; AND chips split the
 *     chain into OR-groups and the groups AND-combine — A AND (B OR C),
 *     exactly as the builder's amber boxes read. Extra pro operators:
 *     crossAbove / crossBelow (previous-bar cross, per-series shift) and
 *     withinPct (|l−r|/|r|·100 ≤ pct).
 *
 * Pro rows compile to a single SQLite query whose CTEs compute the referenced
 * candle-series features (sma/min/max/lag over daily bars and weekly candles,
 * with candles-ago / weeks-ago shifts) via window functions — see pro-sql.ts.
 * Whenever a pro row is present the whole screen runs the pro path (field
 * rows compile to st.* comparisons in the same query); otherwise the fast
 * Prisma path is used. Up to 50 rows.
 */

const NUMERIC_FIELDS = [
  "price", "open", "dayHigh", "dayLow", "changePct", "volume", "avgVol3M", "marketCap",
  // current-week candle columns (screener builder Weekly timeframe)
  "wOpen", "wHigh", "wLow", "wClose",
  "peTTM", "pbRatio", "divYield",
  "rsi14", "wRsi14", "macdHist", "wMacdHist", "mom1M", "mom3M", "mom6M",
  "fromHighPct", "fromLowPct", "atr14Pct",
  "bbPctB", "bbWidthPct",
  "distSma20Pct", "distSma50Pct", "distSma100Pct", "distSma200Pct",
  "distEma20Pct", "distEma50Pct", "distEma100Pct", "distEma200Pct",
  "rsRating", "epsScore",
] as const;

const BOOLEAN_FIELDS = ["aboveSma20", "aboveSma50", "aboveSma200", "goldenCross", "volSpike", "emaCross"] as const;

const OPS = ["gt", "gte", "lt", "lte", "eq", "between"] as const;

export const MAX_COND_ROWS = 50;

interface CondRow {
  f?: unknown;
  op?: unknown;
  v?: unknown;
  v2?: unknown;
  logic?: unknown; // "and" (default) | "or" — how this row joins the previous one
}

function buildCondition(raw: CondRow): Record<string, unknown> | null {
  const f = typeof raw.f === "string" ? raw.f : "";
  const op = typeof raw.op === "string" ? raw.op : "";
  if (!(NUMERIC_FIELDS as readonly string[]).includes(f) && !(BOOLEAN_FIELDS as readonly string[]).includes(f)) return null;

  if ((BOOLEAN_FIELDS as readonly string[]).includes(f)) {
    if (op !== "eq") return null;
    return { [f]: { equals: raw.v === true || raw.v === "true" } };
  }

  const v = Number(raw.v);
  if (!Number.isFinite(v)) return null;
  switch (op) {
    case "gt": return { [f]: { gt: v } };
    case "gte": return { [f]: { gte: v } };
    case "lt": return { [f]: { lt: v } };
    case "lte": return { [f]: { lte: v } };
    case "between": {
      const v2 = Number(raw.v2);
      if (!Number.isFinite(v2)) return null;
      const lo = Math.min(v, v2), hi = Math.max(v, v2);
      return { [f]: { gte: lo, lte: hi } };
    }
    default: return null;
  }
}

const STOCK_SELECT = {
  symbol: true, name: true, price: true, changePct: true, volume: true, marketCap: true,
  sector: true, rsi14: true, mom1M: true, mom3M: true, mom6M: true, peTTM: true,
  fromHighPct: true, fromLowPct: true, aboveSma50: true, aboveSma200: true,
} as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const sector = url.searchParams.get("sector") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const perPage = Math.min(100, Math.max(10, Number(url.searchParams.get("perPage") ?? "25") || 25));
  const sortKey = url.searchParams.get("sort") ?? "marketCap";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  const allowedSorts = [
    "marketCap", "changePct", "rsi14", "price", "mom1M", "mom3M", "mom6M", "volume",
    "peTTM", "fromHighPct", "fromLowPct", "pbRatio", "divYield", "atr14Pct",
  ] as const;
  const sort = (allowedSorts as readonly string[]).includes(sortKey) ? sortKey : "marketCap";

  const baseWhere: { AND: Record<string, unknown>[] } = {
    AND: [{ price: { not: null } }],
  };
  if (q) {
    const or: Record<string, unknown>[] = [
      { symbol: { contains: q.toUpperCase() } },
      { name: { contains: q } },
    ];
    // SQLite Prisma `contains` is case-sensitive — provide a capitalized fallback too
    or.push({ name: { contains: q.charAt(0).toUpperCase() + q.slice(1) } });
    baseWhere.AND.push({ OR: or });
  }
  if (sector && sector !== "all") baseWhere.AND.push({ sector });

  // Condition builder — up to 50 rows. Legacy arrays keep old semantics;
  // {v:2, rows} from the rebuilt builder uses AND-of-OR-groups semantics.
  let condCount = 0;
  const condRaw = url.searchParams.get("cond");
  let condRows: ProRowWire[] = [];
  let hasPro = false;
  let semantics: CondSemantics = "legacy";
  if (condRaw) {
    try {
      const parsed: unknown = JSON.parse(condRaw);
      if (Array.isArray(parsed)) {
        condRows = parsed.slice(0, MAX_COND_ROWS) as ProRowWire[];
        hasPro = condRows.some(
          (r) => r != null && typeof r === "object" && (r as { kind?: unknown }).kind === "expr"
        );
      } else if (isV2Payload(parsed)) {
        condRows = (parsed.rows as ProRowWire[]).slice(0, MAX_COND_ROWS);
        semantics = "v2";
        hasPro = condRows.length > 0;
      }
    } catch {
      return NextResponse.json({ error: "Invalid cond JSON" }, { status: 400 });
    }
  }

  try {
    let total: number;
    let stocks: Record<string, unknown>[];

    if (hasPro) {
      // ---- pro path: compile everything into one SQL query (cached briefly)
      const symbols = await proSymbolList(db, condRows, { sector, sort, dir }, semantics);
      total = symbols.length;
      condCount = condRows.length;
      const pageSymbols = symbols.slice((page - 1) * perPage, page * perPage);
      const rows = pageSymbols.length
        ? await db.stock.findMany({ where: { symbol: { in: pageSymbols } }, select: STOCK_SELECT })
        : [];
      const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
      stocks = pageSymbols
        .map((s) => bySymbol.get(s))
        .filter((r): r is (typeof rows)[number] => Boolean(r)) as unknown as Record<string, unknown>[];
    } else {
      // ---- fast path: snapshot columns only, compiled to a Prisma where
      const where = { ...baseWhere, AND: [...baseWhere.AND] };
      const groups: Record<string, unknown>[][] = [];
      for (const raw of condRows) {
        const cond = buildCondition(raw as CondRow);
        if (!cond) continue;
        const isOr = (raw as CondRow).logic === "or" && groups.length > 0;
        if (isOr) groups.push([cond]);
        else {
          if (groups.length === 0) groups.push([]);
          groups[groups.length - 1].push(cond);
        }
        condCount++;
      }
      if (groups.length === 1) where.AND.push(...groups[0]);
      else if (groups.length > 1) {
        where.AND.push({ OR: groups.map((g) => (g.length === 1 ? g[0] : { AND: g })) });
      }
      const [count, rows] = await Promise.all([
        db.stock.count({ where }),
        db.stock.findMany({
          where,
          orderBy: [{ [sort]: dir }, { marketCap: "desc" }],
          skip: (page - 1) * perPage,
          take: perPage,
          select: STOCK_SELECT,
        }),
      ]);
      total = count;
      stocks = rows as unknown as Record<string, unknown>[];
    }

    // Relative-volume context for the visible page: each row's traded volume
    // against its own prior-20-session average (latest stored session excluded,
    // so neither an intraday snapshot nor the just-synced EOD bar pollutes the
    // base). One indexed window query over the page's symbols keeps it cheap.
    const pageSymbols = stocks.map((s) => s.symbol) as string[];
    const volAvg = new Map<string, number>();
    if (pageSymbols.length > 0) {
      const rows: { symbol: string; avgVol: unknown }[] = await db.$queryRawUnsafe(
        toPgSql(`SELECT symbol, AVG(volume) AS avgVol
           FROM (SELECT symbol, volume,
                        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
                   FROM "DailyBar" WHERE symbol IN (${pageSymbols.map(() => "?").join(",")}))
          WHERE rn BETWEEN 2 AND 21
          GROUP BY symbol`),
        ...pageSymbols
      );
      for (const r of rows) {
        const avg = Number(r.avgVol);
        if (Number.isFinite(avg) && avg > 0) volAvg.set(r.symbol, avg);
      }
    }
    const enriched = stocks.map((s) => {
      const volAvg20 = volAvg.get(s.symbol as string) ?? null;
      const volume = s.volume as number | null;
      const relVol = volAvg20 != null && volume != null && volume > 0 ? volume / volAvg20 : null;
      return { ...s, volAvg20, relVol };
    });

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
      condCount,
      stocks: enriched,
      sectors: sectors.map((s) => s.sector).filter(Boolean),
    });
  } catch (e) {
    if (e instanceof ProCompileError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[/api/stocks] pro query failed:", e);
    return NextResponse.json({ error: "Screen failed — check the conditions" }, { status: 500 });
  }
}
