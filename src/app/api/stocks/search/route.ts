import { NextResponse } from "next/server";
import { db, descNullsLast } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Type-ahead stock search for the header search bar.
 * Matches on symbol AND company name across the whole NSE universe.
 * SQLite Prisma `contains` is case-sensitive, so a few case variants of the
 * query are OR-ed (uppercase for symbols, capitalized / title-case for names).
 * Symbol matches are ranked above name matches (exact > prefix > contains),
 * market cap breaks ties so liquid names surface first.
 */

const SELECT = {
  symbol: true, name: true, price: true, changePct: true, marketCap: true,
  sector: true, exchangeCode: true,
} as const;

function nameVariants(q: string): string[] {
  const cap = q.charAt(0).toUpperCase() + q.slice(1);
  const title = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const variants = [cap, title];
  return [...new Set(variants)];
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (!q) return NextResponse.json({ results: [] });

  const symQuery = q.toUpperCase().replace(/\s+/g, "");

  const [symRows, nameRows] = await Promise.all([
    db.stock.findMany({
      where: { symbol: { contains: symQuery } },
      orderBy: [descNullsLast("marketCap"), { symbol: "asc" }],
      take: 10,
      select: SELECT,
    }),
    db.stock.findMany({
      where: { OR: nameVariants(q).map((v) => ({ name: { contains: v } })) },
      orderBy: [descNullsLast("marketCap"), { symbol: "asc" }],
      take: 10,
      select: SELECT,
    }),
  ]);

  // Merge + rank: exact symbol > symbol prefix > name prefix > name contains,
  // then by market cap. Drop rows without a name to keep the dropdown clean.
  const bare = symQuery.replace(/\.NS$/, "");
  const seen = new Set<string>();
  const scored: { hit: (typeof symRows)[number]; rank: number }[] = [];
  for (const hit of [...symRows, ...nameRows]) {
    if (!hit.name || seen.has(hit.symbol)) continue;
    seen.add(hit.symbol);
    const sym = hit.symbol.replace(/\.NS$/, "");
    const nameUp = hit.name.toUpperCase();
    let rank = 4;
    if (sym === bare) rank = 0;
    else if (sym.startsWith(bare)) rank = 1;
    else if (nameUp.startsWith(bare)) rank = 2;
    else if (nameUp.includes(bare)) rank = 3;
    scored.push({ hit, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || (b.hit.marketCap ?? 0) - (a.hit.marketCap ?? 0));

  return NextResponse.json({ results: scored.slice(0, 10).map((s) => s.hit) });
}
