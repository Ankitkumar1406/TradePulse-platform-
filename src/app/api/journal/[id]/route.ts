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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await db.journalEntry.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };

  const data: Record<string, unknown> = {};
  if (b.date !== undefined) {
    const date = str(b.date, 10);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) data.date = date;
  }
  if (b.title !== undefined) data.title = str(b.title, 200);
  if (b.setup !== undefined) data.setup = str(b.setup, 60);
  if (b.wentWell !== undefined) data.wentWell = str(b.wentWell);
  if (b.wentWrong !== undefined) data.wentWrong = str(b.wentWrong);
  if (b.learning !== undefined) data.learning = str(b.learning);
  if (b.notes !== undefined) data.notes = str(b.notes);
  if (b.tags !== undefined) data.tags = str(b.tags, 200);
  if (b.confidence !== undefined) {
    data.confidence = typeof b.confidence === "number" && b.confidence >= 1 && b.confidence <= 5 ? Math.round(b.confidence) : null;
  }
  if (b.entryPrice !== undefined) data.entryPrice = num(b.entryPrice);
  if (b.exitPrice !== undefined) data.exitPrice = num(b.exitPrice);
  if (b.stopLoss !== undefined) data.stopLoss = num(b.stopLoss);
  if (b.target !== undefined) data.target = num(b.target);
  if (b.quantity !== undefined) data.quantity = num(b.quantity);
  if (b.side !== undefined) data.side = b.side === "short" ? "short" : "long";

  const entry = await db.journalEntry.update({ where: { id }, data });
  return NextResponse.json({ entry, math: computePnl(entry) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await db.journalEntry.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.journalEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
