import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, effectiveTier } from "@/lib/auth";
import { getScan, runScanCached } from "@/lib/scanners";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_SCANS = 8;

interface MultiRow {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  marketCap: number | null;
  sector: string | null;
  rs: number | null;
  matches: number;
  scans: string[];
}

/**
 * Multi-scan confluence ("Multiple Scans"): run several catalog scans at once
 * and return the stocks that fire in `min` or more of them, with the per-scan
 * match breakdown. Pro feature — every selected scan must be Pro-visible
 * (basic scans mixed in are fine for Pro users; non-Pro gets 403 upgrade).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user || effectiveTier(user).tier !== "pro") {
    return NextResponse.json(
      { error: "Multi-scan confluence is part of TradePulse Pro", upgrade: true },
      { status: 403 }
    );
  }

  let body: { ids?: unknown; min?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((i): i is string => typeof i === "string"))].slice(0, MAX_SCANS)
    : [];
  if (ids.length < 2) {
    return NextResponse.json({ error: "Pick at least 2 scans to combine" }, { status: 400 });
  }

  const scans = ids.map((id) => getScan(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (scans.length < 2) {
    return NextResponse.json({ error: "Unknown scan id in selection" }, { status: 400 });
  }

  const min = Math.min(
    scans.length,
    Math.max(2, Number(body.min) || 2)
  );

  try {
    const results = await Promise.all(
      scans.map(async (scan) => ({ scan, result: await runScanCached(scan) }))
    );

    // symbol -> { row, matched scan names }
    const bySymbol = new Map<string, { row: MultiRow; hits: string[] }>();
    const scanSummaries: { id: string; name: string; total: number }[] = [];

    for (const { scan, result } of results) {
      scanSummaries.push({ id: scan.id, name: scan.name, total: result.rows.length });
      for (const r of result.rows) {
        const existing = bySymbol.get(r.symbol);
        if (existing) existing.hits.push(scan.name);
        else
          bySymbol.set(r.symbol, {
            hits: [scan.name],
            row: {
              symbol: r.symbol,
              name: r.name,
              price: r.price,
              changePct: r.changePct,
              marketCap: r.marketCap,
              sector: r.sector,
              rs: r.rs ?? null,
              matches: 0,
              scans: [],
            },
          });
      }
    }

    const rows: MultiRow[] = [];
    for (const { row, hits } of bySymbol.values()) {
      if (hits.length < min) continue;
      rows.push({ ...row, matches: hits.length, scans: hits });
    }
    rows.sort(
      (a, b) =>
        b.matches - a.matches ||
        (b.rs ?? -1) - (a.rs ?? -1) ||
        (b.marketCap ?? 0) - (a.marketCap ?? 0)
    );

    return NextResponse.json({
      min,
      requested: scans.length,
      scanSummaries,
      total: rows.length,
      scanned: Math.max(...results.map((r) => r.result.scanned), 0),
      // full result set — the UI paginates client-side
      rows,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "multi-scan failed" },
      { status: 500 }
    );
  }
}
