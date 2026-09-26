import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadSymbolBars } from "@/lib/bars";
import { ensureFreshBars } from "@/lib/bar-sync";

export const dynamic = "force-dynamic";

/** Stock detail: full snapshot + indicators + cached OHLCV bars. */
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw).toUpperCase();
  if (!symbol.endsWith(".NS")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stock = await db.stock.findUnique({ where: { symbol } });
  if (!stock) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // sync the chart with the latest synced EOD data before serving
  // (best-effort, soft-deadlined — a slow upstream never blocks the view)
  await ensureFreshBars(symbol);

  let bars: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
  try {
    const loaded = await loadSymbolBars(symbol, 260);
    bars = loaded.bars;
  } catch {
    // bars are a cache — detail view works without them
  }

  const {
    closes: _closes, closesSynced: _closesSynced, barsSynced: _barsSynced,
    sectorSynced: _sectorSynced, universeSynced: _universeSynced, earningsSynced: _earningsSynced,
    ...detail
  } = stock;

  return NextResponse.json({ ...detail, bars });
}
