import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Screener / stock list. Filters over the universe with server-side paging.
 * Supports `cond` — a JSON array of condition rows for the advanced
 * multi-condition builder, e.g.
 *   [{"f":"rsi14","op":"gt","v":60},{"f":"aboveSma50","op":"eq","v":true,"logic":"or"},
 *    {"f":"mom6M","op":"between","v":10,"v2":40}]
 * All fields are whitelisted; rows AND-combine by default. A row carrying
 * logic:"or" starts a new OR-group — the chain is evaluated as
 * (AND-group 1) OR (AND-group 2) …, so A AND B OR C = (A∧B) ∨ (C).
 * SQLite stores every indicator as a column (incl. weekly RSI/MACD,
 * Bollinger %B/width and price-vs-MA distances), so the whole builder
 * compiles to one Prisma where.
 */

const NUMERIC_FIELDS = [
  "price", "changePct", "volume", "avgVol3M", "marketCap",
  "peTTM", "pbRatio", "divYield",
  "rsi14", "wRsi14", "macdHist", "wMacdHist", "mom1M", "mom3M", "mom6M",
  "fromHighPct", "fromLowPct", "atr14Pct",
  "bbPctB", "bbWidthPct",
  "distSma20Pct", "distSma50Pct", "distSma100Pct", "distSma200Pct",
  "distEma20Pct", "distEma50Pct", "distEma100Pct", "distEma200Pct",
] as const;

const BOOLEAN_FIELDS = ["aboveSma20", "aboveSma50", "aboveSma200", "goldenCross", "volSpike", "emaCross"] as const;

const OPS = ["gt", "gte", "lt", "lte", "eq", "between"] as const;

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

  const where: { AND: Record<string, unknown>[] } = {
    AND: [{ price: { not: null } }],
  };
  if (q) {
    const or: Record<string, unknown>[] = [
      { symbol: { contains: q.toUpperCase() } },
      { name: { contains: q } },
    ];
    // SQLite Prisma `contains` is case-sensitive — provide a capitalized fallback too
    or.push({ name: { contains: q.charAt(0).toUpperCase() + q.slice(1) } });
    where.AND.push({ OR: or });
  }
  if (sector && sector !== "all") where.AND.push({ sector });

  // Advanced condition builder — up to 15 rows, AND by default with OR-groups.
  let condCount = 0;
  const condRaw = url.searchParams.get("cond");
  if (condRaw) {
    try {
      const parsed = JSON.parse(condRaw);
      if (Array.isArray(parsed)) {
        // Split the chain at OR connectors: each group is a conjunction, and the
        // groups themselves OR together — (A∧B) ∨ (C∧D) ∨ …
        const groups: Record<string, unknown>[][] = [];
        for (const raw of parsed.slice(0, 15)) {
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
      }
    } catch {
      return NextResponse.json({ error: "Invalid cond JSON" }, { status: 400 });
    }
  }

  const [total, stocks, sectors] = await Promise.all([
    db.stock.count({ where }),
    db.stock.findMany({
      where,
      orderBy: [{ [sort]: dir }, { marketCap: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        symbol: true, name: true, price: true, changePct: true, volume: true, marketCap: true,
        sector: true, rsi14: true, mom1M: true, mom3M: true, mom6M: true, peTTM: true,
        fromHighPct: true, fromLowPct: true, aboveSma50: true, aboveSma200: true,
      },
    }),
    db.stock.groupBy({
      by: ["sector"],
      where: { sector: { notIn: ["Unknown"] } },
      _count: { symbol: true },
      orderBy: { sector: "asc" },
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    perPage,
    condCount,
    stocks,
    sectors: sectors.map((s) => s.sector).filter(Boolean),
  });
}
