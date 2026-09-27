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
    // (The only sync a page visit may ever trigger — the universe is empty,
    // so there is nothing to gate. Every later sync is cron/admin-only.)
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
    const body = (await req.json().catch(() => ({}))) as { mode?: string; force?: boolean };
    const mode: SyncMode = body.mode === "full" ? "full" : body.mode === "daily" ? "daily" : "refresh";

    // Bypassing the 4-hour hard gate is an admin action: the caller must be
    // authenticated and listed in ADMIN_EMAILS (comma-separated).
    let force = false;
    if (body.force === true) {
      const session = await getServerSession(authOptions);
      const admins = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const email = (session?.user?.email ?? "").toLowerCase();
      if (!email || !admins.includes(email)) {
        return NextResponse.json(
          { error: "Forcing a sync requires an admin account (ADMIN_EMAILS)" },
          { status: 403 }
        );
      }
      force = true;
    }

    const result = await startSync(mode, { force });
    return NextResponse.json({
      ok: result.started,
      reason: result.reason ?? null,
      mode,
      forced: force,
      ...(await getSyncStatus()),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sync failed" }, { status: 500 });
  }
}
