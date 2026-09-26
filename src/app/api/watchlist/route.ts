import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveTier } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function watchlistLimit(userId: string): Promise<number> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return 10;
  return effectiveTier(user).tier === "pro" ? Infinity : 10;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await db.watchlistItem.findMany({ orderBy: { createdAt: "asc" } });
  const symbols = items.map((i) => i.symbol);
  const stocks = await db.stock.findMany({
    where: { symbol: { in: symbols } },
    select: {
      symbol: true, name: true, price: true, changePct: true, marketCap: true, sector: true,
      rsi14: true, fromHighPct: true, aboveSma50: true, aboveSma200: true,
    },
  });
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));
  return NextResponse.json({
    items: items.map((i) => ({ ...i, stock: bySymbol.get(i.symbol) ?? null })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { symbol?: string; note?: string };
  const symbol = (body.symbol ?? "").toUpperCase().trim();
  if (!/^[A-Z0-9&\-\.]+\.NS$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  const count = await db.watchlistItem.count();
  const limit = await watchlistLimit(session.user.id);
  const exists = await db.watchlistItem.findUnique({ where: { symbol } });
  if (!exists && count >= limit) {
    return NextResponse.json(
      { error: "Watchlist limit reached (10 stocks on the free plan). Upgrade to Pro for unlimited watchlists.", upgrade: true },
      { status: 403 }
    );
  }
  const item = await db.watchlistItem.upsert({
    where: { symbol },
    create: { symbol, note: (body.note ?? "").slice(0, 200) || null },
    update: body.note != null ? { note: body.note.slice(0, 200) || null } : {},
  });
  return NextResponse.json(item, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  await db.watchlistItem.deleteMany({ where: { symbol } });
  return NextResponse.json({ ok: true });
}
