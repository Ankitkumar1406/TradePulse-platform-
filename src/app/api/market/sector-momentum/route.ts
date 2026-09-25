import { NextResponse } from "next/server";
import { getSectorMomentum } from "@/lib/sector-momentum";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sector momentum — multi-timeframe RSI (daily / weekly / monthly) for NSE
 * indices and DB sectors, classified into strength buckets. Cached 6 h.
 * `?force=1` recomputes.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const data = await getSectorMomentum(force);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sector momentum failed" },
      { status: 500 }
    );
  }
}
