import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getScan, runScanCached } from "@/lib/scanners";
import { effectiveTier } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Run a scan by id. Basic scans are free; the rest require Pro. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = getScan(id);
  if (!scan) return NextResponse.json({ error: "Unknown scan" }, { status: 404 });

  if (!scan.basic) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await db.user.findUnique({ where: { id: session.user.id } });
    if (!user || effectiveTier(user).tier !== "pro") {
      return NextResponse.json(
        { error: "This scanner is part of TradePulse Pro", upgrade: true },
        { status: 403 }
      );
    }
  }

  try {
    const result = await runScanCached(scan);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "scan failed" }, { status: 500 });
  }
}
