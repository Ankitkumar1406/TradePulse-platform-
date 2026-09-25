import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCycle, PRO_PLANS } from "@/lib/pricing";
import { createCashfreeOrder, isCashfreeConfigured } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * Create a checkout: body { cycle: "monthly" | "quarterly" | "halfyearly" | "annual" }
 *  - cashfree mode -> { mode: "cashfree", orderId, sessionId } (UPI Autopay / card mandate)
 *  - demo mode     -> { mode: "demo", orderId, amount, cycle }
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { cycle?: unknown };
  if (!isCycle(body.cycle)) {
    return NextResponse.json({ error: "Invalid plan cycle" }, { status: 400 });
  }
  const cycle = body.cycle;
  const plan = PRO_PLANS[cycle];
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orderId = `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (isCashfreeConfigured()) {
    try {
      const { sessionId } = await createCashfreeOrder({
        orderId,
        amountPaise: plan.price * 100,
        customerEmail: user.email,
        customerPhone: user.phone ?? "",
        customerName: user.name ?? "",
        cycle,
      });
      const payment = await db.payment.create({
        data: {
          userId: user.id,
          provider: "cashfree",
          orderId,
          sessionId,
          cycle,
          amount: plan.price * 100,
        },
      });
      return NextResponse.json({ mode: "cashfree", orderId: payment.orderId, sessionId, cycle });
    } catch (e) {
      console.error("[payments] cashfree create failed:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Payment gateway error — try again" }, { status: 502 });
    }
  }

  // Demo/sandbox path
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      provider: "demo",
      orderId,
      cycle,
      amount: plan.price * 100,
    },
  });
  return NextResponse.json({
    mode: "demo",
    orderId: payment.orderId,
    amount: payment.amount,
    cycle,
    price: plan.price,
    per: plan.per,
  });
}
