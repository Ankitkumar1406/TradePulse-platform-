import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, effectiveTier } from "@/lib/auth";
import { db } from "@/lib/db";
import { computePnl } from "@/lib/journal";

export const dynamic = "force-dynamic";

const TEXT_MAX = 5000;

function str(v: unknown, max = TEXT_MAX): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Journal is a Pro feature (the 15-day trial counts as Pro). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (effectiveTier(user).tier !== "pro") {
    return NextResponse.json({ error: "The trading journal is part of TradePulse Pro", upgrade: true }, { status: 403 });
  }
  const entries = await db.journalEntry.findMany({
    where: { userId: user.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ entries });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (effectiveTier(user).tier !== "pro") {
    return NextResponse.json({ error: "The trading journal is part of TradePulse Pro", upgrade: true }, { status: 403 });
  }

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = b.kind === "note" ? "note" : "trade";
  const errors: Record<string, string> = {};

  const date = str(b.date, 10) ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "Use a valid date";

  let symbol: string | null = null;
  let side: string | null = null;
  let entryPrice: number | null = null;
  let exitPrice: number | null = null;
  let quantity: number | null = null;
  let stopLoss: number | null = null;
  let target: number | null = null;

  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };

  if (kind === "trade") {
    symbol = str(b.symbol, 20);
    if (!symbol) errors.symbol = "Symbol is required";
    side = b.side === "short" ? "short" : "long";
    entryPrice = num(b.entryPrice);
    quantity = num(b.quantity);
    if (entryPrice == null || entryPrice <= 0) errors.entryPrice = "Entry price is required";
    if (quantity == null || quantity <= 0) errors.quantity = "Quantity is required";
    exitPrice = num(b.exitPrice);
    if (exitPrice != null && exitPrice <= 0) errors.exitPrice = "Exit price must be positive";
    stopLoss = num(b.stopLoss);
    target = num(b.target);
  } else {
    if (!str(b.title, 200)) errors.title = "Give the note a headline";
    if (!str(b.notes) && !str(b.learning)) errors.notes = "Add the learning or a few notes";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: Object.values(errors)[0], errors }, { status: 422 });
  }

  const entry = await db.journalEntry.create({
    data: {
      userId: user.id,
      kind,
      date,
      title: str(b.title, 200),
      symbol: symbol ? (symbol.toUpperCase().endsWith(".NS") ? symbol.toUpperCase() : `${symbol.toUpperCase()}.NS`) : null,
      side,
      entryPrice,
      exitPrice,
      quantity,
      stopLoss,
      target,
      setup: str(b.setup, 60),
      confidence: typeof b.confidence === "number" && b.confidence >= 1 && b.confidence <= 5 ? Math.round(b.confidence) : null,
      wentWell: str(b.wentWell),
      wentWrong: str(b.wentWrong),
      learning: str(b.learning),
      notes: str(b.notes),
      tags: str(b.tags, 200),
    },
  });

  return NextResponse.json({ entry, math: computePnl(entry) }, { status: 201 });
}
