"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Bell, Plus, Star, TrendingUp } from "lucide-react";
import { CandleChart, type Candle } from "@/components/candle-chart";
import { detectBase } from "@/lib/base";
import { changeColor, fmtMcap, fmtNum, fmtPct, fmtPrice, fmtVol } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StockDetail {
  symbol: string; name: string; sector: string | null; industry: string | null;
  price: number | null; prevClose: number | null; changePct: number | null;
  open: number | null; dayHigh: number | null; dayLow: number | null;
  volume: number | null; avgVol3M: number | null; marketCap: number | null;
  peTTM: number | null; epsTTM: number | null; bookValue: number | null; pbRatio: number | null;
  divYield: number | null; high52: number | null; low52: number | null;
  sma20: number | null; sma50: number | null; sma200: number | null;
  rsi14: number | null; macd: number | null; macdSignal: number | null; macdHist: number | null;
  atr14Pct: number | null; mom1M: number | null; mom3M: number | null; mom6M: number | null;
  fromHighPct: number | null; fromLowPct: number | null;
  aboveSma20: boolean | null; aboveSma50: boolean | null; aboveSma200: boolean | null; goldenCross: boolean | null;
  earningsDate: string | null;
  rsRating: number | null; epsScore: number | null; adRating: string | null; epsQuarterlyGrowth: number | null;
  bars: Candle[];
}

/**
 * Stock detail dialog. Deliberately wide (max-w-6xl/7xl at sm/lg) with an
 * overflow-safe grid so charts and stat blocks never force horizontal scroll.
 */
export function StockDetail({ symbol, open, onClose, isPro }: { symbol: string; open: boolean; onClose: () => void; isPro: boolean }) {
  const qc = useQueryClient();
  const [alertTarget, setAlertTarget] = useState("");
  const [showBase, setShowBase] = useState(true);

  const { data, isLoading, isError } = useQuery<StockDetail>({
    queryKey: ["stock", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    enabled: open,
    staleTime: 60_000,
  });

  const addWatch = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Could not add to watchlist");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: `${symbol.replace(".NS", "")} added to watchlist` });
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const addAlert = useMutation({
    mutationFn: async (condition: "above" | "below") => {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, condition, target: Number(alertTarget) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Could not create alert");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alert created" });
      setAlertTarget("");
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const inWatchlist = useQuery<boolean>({
    queryKey: ["watchlist", "has", symbol],
    queryFn: async () => {
      const res = await fetch("/api/watchlist");
      if (!res.ok) return false;
      const j = (await res.json()) as { items: { symbol: string }[] };
      return j.items.some((i) => i.symbol === symbol);
    },
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] sm:max-w-6xl lg:max-w-7xl max-h-[92vh] overflow-y-auto bg-zinc-950 border-zinc-800 text-zinc-200">
        {isLoading || !data ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
            <DialogTitle className="sr-only">{symbol}</DialogTitle>
            {isError ? "Stock not found." : "Loading…"}
          </div>
        ) : (
          <>
            <DialogHeader className="pb-0">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="flex flex-wrap items-center gap-2.5 text-xl text-zinc-50">
                    {data.symbol.replace(".NS", "")}
                    {data.sector && data.sector !== "Unknown" && (
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-400">{data.sector}</span>
                    )}
                  </DialogTitle>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{data.name}{data.industry ? ` · ${data.industry}` : ""}</p>
                </div>
                <div className="text-right">
                  <span className="font-mono text-2xl font-bold text-zinc-50">{fmtPrice(data.price)}</span>
                  <span className={cn("ml-2 font-mono text-sm", changeColor(data.changePct))}>{fmtPct(data.changePct)}</span>
                </div>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-2">
              {/* chart + range stats — KLineChart layout (MA/VOL/MACD/RSI, D/W/M, base overlay) */}
              <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <TrendingUp className="h-3.5 w-3.5 text-brand-text" /> Technical chart · 2y of daily data
                  </span>
                  <button
                    onClick={() => setShowBase((v) => !v)}
                    aria-pressed={showBase}
                    className={cn(
                      "cursor-pointer rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors",
                      showBase ? "border-gold/50 bg-gold/10 text-gold-text" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                    )}
                    title="Show the consolidation base rectangle and how long it has been forming"
                  >
                    Base overlay
                  </button>
                </div>
                <CandleChart candles={data.bars ?? []} height={440} showBase={showBase} maMode={20} />
              </div>

              {/* indicators grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                <Stat label="RSI (14)" value={fmtNum(data.rsi14, 1)} tone={data.rsi14 != null ? (data.rsi14 > 60 ? "up" : data.rsi14 < 40 ? "down" : undefined) : undefined} />
                <Stat label="RS rating" value={data.rsRating != null ? String(data.rsRating) : "—"} hint="12M momentum percentile" tone={data.rsRating != null ? (data.rsRating >= 70 ? "up" : data.rsRating < 40 ? "down" : undefined) : undefined} />
                <Stat label="EPS score" value={data.epsScore != null ? String(data.epsScore) : "—"} hint="growth percentile (1-99)" tone={data.epsScore != null ? (data.epsScore >= 70 ? "up" : data.epsScore < 40 ? "down" : undefined) : undefined} />
                <Stat label="A/D rating" value={data.adRating ?? "—"} hint="13-wk up/down volume" tone={data.adRating ? (data.adRating.startsWith("A") ? "up" : data.adRating.startsWith("D") || data.adRating === "E" ? "down" : undefined) : undefined} />
                <Stat label="EPS chg % (YoY)" value={data.epsQuarterlyGrowth != null ? fmtPct(data.epsQuarterlyGrowth * 100, 1) : "—"} tone={data.epsQuarterlyGrowth != null ? (data.epsQuarterlyGrowth > 0 ? "up" : "down") : undefined} />
                <Stat label="MACD hist" value={fmtNum(data.macdHist)} tone={data.macdHist != null ? (data.macdHist > 0 ? "up" : "down") : undefined} />
                <Stat label="ATR %" value={fmtNum(data.atr14Pct, 1)} />
                <Stat label="1M return" value={fmtPct(data.mom1M, 1)} tone={data.mom1M != null ? (data.mom1M > 0 ? "up" : "down") : undefined} />
                <Stat label="3M return" value={fmtPct(data.mom3M, 1)} tone={data.mom3M != null ? (data.mom3M > 0 ? "up" : "down") : undefined} />
                <Stat label="6M return" value={fmtPct(data.mom6M, 1)} tone={data.mom6M != null ? (data.mom6M > 0 ? "up" : "down") : undefined} />
                <Stat label="20 SMA" value={fmtPrice(data.sma20)} hint={data.aboveSma20 ? "price above" : "price below"} />
                <Stat label="50 SMA" value={fmtPrice(data.sma50)} hint={data.aboveSma50 ? "price above" : "price below"} />
                <Stat label="200 SMA" value={fmtPrice(data.sma200)} hint={data.aboveSma200 ? "price above" : "price below"} />
                <Stat label="52W high" value={fmtPrice(data.high52)} hint={data.fromHighPct != null ? `${data.fromHighPct.toFixed(1)}% below` : undefined} />
                <Stat label="52W low" value={fmtPrice(data.low52)} hint={data.fromLowPct != null ? `${data.fromLowPct.toFixed(1)}% above` : undefined} />
                <BaseStat bars={data.bars ?? []} />
                <Stat label="Earnings" value={data.earningsDate ? data.earningsDate.slice(0, 10) : "—"} />
              </div>

              {/* fundamentals + actions */}
              <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Fundamentals</h4>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Stat label="Market cap" value={fmtMcap(data.marketCap)} />
                    <Stat label="P/E (TTM)" value={fmtNum(data.peTTM)} />
                    <Stat label="EPS (TTM)" value={fmtNum(data.epsTTM)} />
                    <Stat label="Book value" value={fmtPrice(data.bookValue)} />
                    <Stat label="P/B" value={fmtNum(data.pbRatio)} />
                    <Stat label="Div yield" value={data.divYield != null ? `${data.divYield.toFixed(2)}%` : "—"} />
                  </div>
                </div>
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <Button
                    variant="outline"
                    disabled={addWatch.isPending || inWatchlist.data}
                    onClick={() => addWatch.mutate()}
                    className="h-9 w-full border-zinc-700 bg-transparent text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    <Star className={cn("mr-1.5 h-3.5 w-3.5", inWatchlist.data ? "fill-gold text-gold" : "text-gold-text")} />
                    {inWatchlist.data ? "On your watchlist" : "Add to watchlist"}
                  </Button>
                  <div className="flex items-center gap-2">
                    <Input
                      value={alertTarget}
                      onChange={(e) => setAlertTarget(e.target.value)}
                      inputMode="decimal"
                      placeholder="Alert price"
                      className="h-9 flex-1 border-zinc-800 bg-zinc-900 text-xs text-zinc-100"
                    />
                    <Button
                      size="sm" disabled={!alertTarget || addAlert.isPending}
                      onClick={() => addAlert.mutate("above")}
                      className="h-9 bg-brand px-2.5 text-xs text-white hover:bg-brand-hover"
                      title="Alert when price goes above"
                    >
                      <Bell className="h-3.5 w-3.5" />↑
                    </Button>
                    <Button
                      size="sm" disabled={!alertTarget || addAlert.isPending}
                      onClick={() => addAlert.mutate("below")}
                      className="h-9 bg-zinc-800 px-2.5 text-xs text-zinc-200 hover:bg-zinc-700"
                      title="Alert when price goes below"
                    >
                      <Bell className="h-3.5 w-3.5" />↓
                    </Button>
                  </div>
                  {!isPro && <p className="text-[10px] leading-4 text-zinc-600">Basic plan: 3 alerts, 1 watchlist of 10. Pro removes limits.</p>}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 truncate font-mono text-sm font-semibold", tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-zinc-100")}>
        {value}
      </div>
      {hint && <div className="text-[9px] text-zinc-600">{hint}</div>}
    </div>
  );
}

/** Base formation chip — detects the current consolidation from the daily bars. */
function BaseStat({ bars }: { bars: Candle[] }) {
  const base = useMemo(() => (bars.length > 20 ? detectBase(bars) : null), [bars]);
  if (!base) {
    return <Stat label="Base" value="—" hint="no clean base in the last 6 months" />;
  }
  return (
    <div className="rounded-lg border border-gold/30 bg-gold/5 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">Base</div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold text-gold-text">
        {base.days} sessions
      </div>
      <div className="text-[9px] text-zinc-600">
        {base.status === "in-base" ? "forming" : "broke out"} · {base.depthPct}% deep
      </div>
    </div>
  );
}
