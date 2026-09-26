import { NextResponse } from "next/server";
import { ensureCalendarSeed } from "@/lib/market-calendar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Market calendar: seeds on first call, then returns all events. */
export async function GET() {
  try {
    await ensureCalendarSeed();
    const events = await db.marketEvent.findMany({ orderBy: { date: "asc" } });
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "calendar failed" }, { status: 500 });
  }
}
