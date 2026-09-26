/** Shared number/price formatters + change color helpers. */

export function changeColor(pct: number | null | undefined): string {
  if (pct == null) return "text-zinc-500";
  if (pct > 0.05) return "text-profit";
  if (pct < -0.05) return "text-loss";
  return "text-zinc-400";
}

export function fmtPct(pct: number | null | undefined, digits = 2): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

export function fmtPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  if (price >= 1000) return price.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return price.toFixed(2);
}

export function fmtVol(vol: number | null | undefined): string {
  if (vol == null || !Number.isFinite(vol)) return "—";
  if (vol >= 1e7) return `${(vol / 1e7).toFixed(2)} Cr`;
  if (vol >= 1e5) return `${(vol / 1e5).toFixed(2)} L`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)} K`;
  return String(Math.round(vol));
}

export function fmtMcap(mcap: number | null | undefined): string {
  if (mcap == null || !Number.isFinite(mcap)) return "—";
  if (mcap >= 1e12) return `₹${(mcap / 1e12).toFixed(2)} L Cr`;
  return `₹${(mcap / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}
