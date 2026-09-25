import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 6-month close sparklines for the rotation drawer's Charts mode.
 * GET /api/market/sectors/spark?symbols=TCS.NS,INFY.NS  (cap 150)
 * Returns { sparks: Record<symbol, number[]> } — last ~126 closes
 * downsampled to 42 points each.
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("symbols") ?? "";
    const symbols = [...new Set(q.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 150);
    if (symbols.length === 0) return NextResponse.json({ sparks: {} });

    const rows = await db.stock.findMany({
      where: { symbol: { in: symbols }, closes: { not: null } },
      select: { symbol: true, closes: true },
    });

    const sparks: Record<string, number[]> = {};
    for (const r of rows) {
      try {
        const series = JSON.parse(r.closes as string) as [number, number][];
        const closes = series.slice(-126).map((p) => p[1]).filter((v) => v != null && Number.isFinite(v));
        if (closes.length < 20) continue;
        const step = Math.max(1, Math.ceil(closes.length / 42));
        const out: number[] = [];
        for (let i = 0; i < closes.length; i += step) out.push(Math.round(closes[i] * 100) / 100);
        if (out.length > 1) sparks[r.symbol] = out;
      } catch { /* skip malformed */ }
    }
    return NextResponse.json({ sparks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "spark failed" }, { status: 500 });
  }
}
