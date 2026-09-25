"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Plus, Star, Trash2 } from "lucide-react";
import { changeColor, fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface WatchItem {
  id: string;
  symbol: string;
  note: string | null;
  stock: {
    symbol: string; name: string; price: number | null; changePct: number | null;
    marketCap: number | null; sector: string | null; rsi14: number | null; fromHighPct: number | null;
    aboveSma50: boolean | null; aboveSma200: boolean | null;
  } | null;
}

/** Dedicated watchlist — the precise entry/stop/target list built at night. */
export function WatchlistTab({ onSelectStock }: { onSelectStock: (s: string) => void }) {
  const qc = useQueryClient();
  const [newSymbol, setNewSymbol] = useState("");

  const { data, isLoading } = useQuery<{ items: WatchItem[] }>({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/watchlist");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const add = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Could not add");
      return j;
    },
    onSuccess: () => {
      setNewSymbol("");
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove");
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["watchlist"] }),
    onError: () => toast({ title: "Could not remove", variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const normalized = newSymbol.toUpperCase().trim();
  const valid = /^[A-Z0-9&\-.]+$/.test(normalized);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Watchlist · your precise entry list</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">
            {items.length > 0 ? `${items.length} stock${items.length > 1 ? "s" : ""}` : "Watchlist"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) add.mutate(normalized.endsWith(".NS") ? normalized : `${normalized}.NS`);
            }}
            placeholder="Add symbol e.g. TCS"
            className="h-9 w-44 border-zinc-800 bg-zinc-900 text-xs text-zinc-100"
          />
          <Button
            size="sm"
            disabled={!valid || add.isPending}
            onClick={() => add.mutate(normalized.endsWith(".NS") ? normalized : `${normalized}.NS`)}
            className="h-9 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 bg-zinc-800/70" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Star className="h-6 w-6 text-zinc-700" />
              <p className="max-w-sm text-xs leading-5 text-zinc-500">
                Your watchlist is empty. Run a scanner or the screener, then add the best setups here — with entry, stop
                and target decided before the next open.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {items.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <button onClick={() => onSelectStock(i.symbol)} className="min-w-0 flex-1 text-left">
                    <span className="block text-xs font-semibold text-zinc-100">{i.symbol.replace(".NS", "")}</span>
                    {i.stock ? (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
                        <span className="max-w-48 truncate text-zinc-500">{i.stock.name}</span>
                        <span className="font-mono text-zinc-300">{fmtPrice(i.stock.price)}</span>
                        <span className={cn("font-mono", changeColor(i.stock.changePct))}>{fmtPct(i.stock.changePct)}</span>
                        {i.stock.rsi14 != null && <span className="font-mono text-zinc-600">RSI {i.stock.rsi14.toFixed(0)}</span>}
                        {i.stock.aboveSma200 && <span className="text-brand-text/80">&gt; 200 SMA</span>}
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-600">Awaiting data sync…</span>
                    )}
                  </button>
                  <button
                    onClick={() => remove.mutate(i.symbol)}
                    className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-loss"
                    aria-label={`Remove ${i.symbol}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
