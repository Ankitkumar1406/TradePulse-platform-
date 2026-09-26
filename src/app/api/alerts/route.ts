import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const alerts = await db.priceAlert.findMany({ orderBy: { createdAt: "desc" } });
  const stocks = await db.stock.findMany({
    where: { symbol: { in: alerts.map((a) => a.symbol) } },
    select: { symbol: true, name: true, price: true, changePct: true },
  });
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));
  return NextResponse.json({
    alerts: alerts.map((a) => ({ ...a, stock: bySymbol.get(a.symbol) ?? null })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { symbol?: string; condition?: string; target?: number };
  const symbol = (body.symbol ?? "").toUpperCase().trim();
  const condition = body.condition === "below" ? "below" : "above";
  const target = Number(body.target);
  if (!symbol.endsWith(".NS") || !Number.isFinite(target) || target <= 0) {
    return NextResponse.json({ error: "Provide a symbol and a positive target price" }, { status: 400 });
  }
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  const alertCount = await db.priceAlert.count();
  const isPro = user ? effectiveTierSafe(user) : false;
  if (!isPro && alertCount >= 3) {
    return NextResponse.json({ error: "Free plan includes 3 alerts. Upgrade to Pro for unlimited alerts.", upgrade: true }, { status: 403 });
  }
  const alert = await db.priceAlert.create({ data: { symbol, condition, target } });
  return NextResponse.json(alert, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  await db.priceAlert.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}

function effectiveTierSafe(user: { plan: string; planExpiresAt: Date | null; trialEndsAt: Date | null }): boolean {
  const now = Date.now();
  if (user.plan === "pro" && user.planExpiresAt && user.planExpiresAt.getTime() > now) return true;
  return Boolean(user.trialEndsAt && user.trialEndsAt.getTime() > now);
}
