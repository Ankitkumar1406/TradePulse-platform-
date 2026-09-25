import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSyncStatus, startSync, type SyncMode } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const status = await getSyncStatus();
    // First boot with an empty universe: the GET owns the initial full sync.
    if (status.stockCount === 0 && status.status === "idle") {
      void startSync("full");
    }
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sync status failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: string };
    const mode: SyncMode = body.mode === "full" ? "full" : body.mode === "daily" ? "daily" : "refresh";
    const result = await startSync(mode);
    return NextResponse.json({ ok: result.started, mode, ...(await getSyncStatus()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sync failed" }, { status: 500 });
  }
}
