/**
 * Price alerts: evaluate active alerts against the latest stored quotes.
 * Called after every sync pass (manual refresh, 4 pm auto-update).
 */

import { db } from "@/lib/db";

export async function evaluateAlerts(): Promise<number> {
  const alerts = await db.priceAlert.findMany({
    where: { active: true },
    select: { id: true, symbol: true, condition: true, target: true },
  });
  if (alerts.length === 0) return 0;

  const stocks = await db.stock.findMany({
    where: { symbol: { in: alerts.map((a) => a.symbol) }, price: { not: null } },
    select: { symbol: true, price: true, changePct: true },
  });
  const priceBySymbol = new Map(stocks.map((s) => [s.symbol, s]));

  let triggered = 0;
  for (const a of alerts) {
    const stock = priceBySymbol.get(a.symbol);
    if (!stock?.price) continue;
    const hit = a.condition === "above" ? stock.price >= a.target : stock.price <= a.target;
    if (!hit) continue;
    await db.priceAlert.update({
      where: { id: a.id },
      data: {
        active: false,
        triggeredAt: new Date(),
        triggeredPc: a.target ? ((stock.price - a.target) / a.target) * 100 : null,
      },
    });
    triggered++;
  }
  return triggered;
}
