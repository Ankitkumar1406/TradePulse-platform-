import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cancelAutoRenew } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** Cancel auto-renewal — access continues till the paid period ends. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await cancelAutoRenew(session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: "No active subscription to cancel" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    activeUntil: result.activeUntil,
    message: "Auto-renewal cancelled. Your Pro access continues till the period you already paid for.",
  });
}
