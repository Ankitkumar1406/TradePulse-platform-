/**
 * Trading journal domain logic: setups, P&L / R-multiple math, stats.
 * Shared by the journal API and the journal tab UI.
 */

export const JOURNAL_SETUPS = [
  "Breakout",
  "Pullback",
  "VCP",
  "Cup & Handle",
  "Flag",
  "Reversal",
  "Gap & Go",
  "Earnings",
  "Swing",
  "Positional",
  "Scalp",
  "Bottom Fishing",
  "Trend Continuation",
  "Other",
] as const;

export interface TradeMath {
  pnl: number | null;
  returnPct: number | null;
  rMultiple: number | null;
  open: boolean;
}

/** Side-aware P&L, return % and R-multiple from stop. */
export function computePnl(input: {
  side?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  quantity?: number | null;
  stopLoss?: number | null;
}): TradeMath {
  const long = (input.side ?? "long") !== "short";
  const entry = input.entryPrice ?? null;
  const exit = input.exitPrice ?? null;
  const qty = input.quantity ?? null;
  const open = exit == null;

  if (entry == null || qty == null || qty <= 0) {
    return { pnl: null, returnPct: null, rMultiple: null, open };
  }

  if (open) {
    return { pnl: null, returnPct: null, rMultiple: null, open };
  }

  const dir = long ? 1 : -1;
  const pnl = (exit - entry) * dir * qty;
  const returnPct = entry !== 0 ? ((exit - entry) / entry) * 100 * dir : null;
  let rMultiple: number | null = null;
  if (input.stopLoss != null && input.stopLoss !== 0) {
    const risk = Math.abs(entry - input.stopLoss);
    if (risk > 0) rMultiple = ((exit - entry) * dir) / risk;
  }
  return { pnl, returnPct, rMultiple, open: false };
}

export interface JournalStats {
  trades: number;
  closed: number;
  open: number;
  notes: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgR: number | null;
  bestPnl: number | null;
  worstPnl: number | null;
}

export function computeStats(
  entries: Array<{
    kind: string;
    side?: string | null;
    entryPrice?: number | null;
    exitPrice?: number | null;
    quantity?: number | null;
    stopLoss?: number | null;
  }>
): JournalStats {
  let closed = 0;
  let open = 0;
  let notes = 0;
  let wins = 0;
  let losses = 0;
  let netPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const rs: number[] = [];
  let best: number | null = null;
  let worst: number | null = null;

  for (const e of entries) {
    if (e.kind === "note") {
      notes++;
      continue;
    }
    const m = computePnl(e);
    if (m.open || m.pnl == null) {
      open++;
      continue;
    }
    closed++;
    netPnl += m.pnl;
    if (m.pnl > 0) {
      wins++;
      grossProfit += m.pnl;
    } else if (m.pnl < 0) {
      losses++;
      grossLoss += Math.abs(m.pnl);
    }
    if (m.rMultiple != null) rs.push(m.rMultiple);
    best = best == null ? m.pnl : Math.max(best, m.pnl);
    worst = worst == null ? m.pnl : Math.min(worst, m.pnl);
  }

  return {
    trades: closed + open,
    closed,
    open,
    notes,
    wins,
    losses,
    winRate: closed > 0 ? (wins / closed) * 100 : null,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    bestPnl: best,
    worstPnl: worst,
  };
}

export function fmtINR(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function fmtR(r: number | null): string {
  if (r == null) return "—";
  return `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;
}
