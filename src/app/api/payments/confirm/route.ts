import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { markPaidAndActivate, isCashfreeConfigured } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * Confirm a payment.
 *  - demo mode: body { orderId, outcome: "success" | "failure" } simulates the mandate debit.
 *  - cashfree mode: body { orderId } -> order status verified against the Cashfree API.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { orderId?: string; outcome?: string };
  const payment = await db.payment.findUnique({ where: { orderId: body.orderId ?? "" } });
  if (!payment || payment.userId !== session.user.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (payment.status === "PAID") {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  if (isCashfreeConfigured()) {
    // Verify the order server-side before activating.
    try {
      const res = await fetch(`https://api.cashfree.com/pg/orders/${encodeURIComponent(payment.orderId)}`, {
        headers: {
          "x-api-version": "2023-08-01",
          "x-client-id": process.env.CASHFREE_APP_ID as string,
          "x-client-secret": process.env.CASHFREE_SECRET_KEY as string,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const order = (await res.json()) as { order_status?: string };
      if (order.order_status !== "PAID") {
        return NextResponse.json({ ok: false, status: order.order_status ?? "PENDING" });
      }
    } catch (e) {
      return NextResponse.json(
        { error: `Could not verify payment: ${e instanceof Error ? e.message : "unknown"}` },
        { status: 502 }
      );
    }
    const { expiresAt, cycle } = await markPaidAndActivate(payment.id);
    return NextResponse.json({ ok: true, plan: "pro", cycle, expiresAt });
  }

  // Demo path
  if (body.outcome === "failure") {
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    return NextResponse.json({ ok: false, status: "FAILED" });
  }
  const { expiresAt, cycle } = await markPaidAndActivate(payment.id);
  return NextResponse.json({
    ok: true,
    plan: "pro",
    cycle,
    expiresAt,
    demo: true,
    amount: payment.amount,
  });
}
