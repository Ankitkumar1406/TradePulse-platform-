"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Bell, BellRing, Trash2 } from "lucide-react";
import { changeColor, fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AlertRow {
  id: string; symbol: string; condition: string; target: number;
  active: boolean; triggeredAt: string | null; triggeredPc: number | null;
  stock: { symbol: string; name: string; price: number | null; changePct: number | null } | null;
}

/** Smart price alerts — TradePulse watches the levels so you don't have to. */
export function AlertsTab({ onSelectStock }: { onSelectStock: (s: string) => void }) {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState("");
  const [target, setTarget] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");

  const { data, isLoading } = useQuery<{ alerts: AlertRow[] }>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const res = await fetch("/api/alerts");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: symbol.endsWith(".NS") ? symbol : `${symbol}.NS`, condition, target: Number(target) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error ?? "Could not create alert");
      return j;
    },
    onSuccess: () => {
      setSymbol(""); setTarget("");
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      toast({ title: "Alert created" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const alerts = data?.alerts ?? [];
  const canSubmit = /^[A-Z0-9&\-.]+$/.test(symbol.toUpperCase().trim()) && Number(target) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Alerts · set and forget</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">Price alerts</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="Symbol e.g. INFY"
            className="h-9 w-32 border-zinc-800 bg-zinc-900 text-xs text-zinc-100"
          />
          <div className="flex overflow-hidden rounded-md border border-zinc-800">
            {(["above", "below"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCondition(c)}
                className={cn("px-2.5 py-1.5 text-[11px] transition-colors", condition === c ? "bg-brand/15 text-brand-text" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300")}
              >
                {c === "above" ? "≥ above" : "≤ below"}
              </button>
            ))}
          </div>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            placeholder="Target ₹"
            className="h-9 w-24 border-zinc-800 bg-zinc-900 text-xs text-zinc-100"
          />
          <Button size="sm" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()} className="h-9 bg-brand px-3 text-xs text-white hover:bg-brand-hover">
            <Bell className="mr-1 h-3.5 w-3.5" /> Create
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 bg-zinc-800/70" />)}
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <BellRing className="h-6 w-6 text-zinc-700" />
              <p className="max-w-sm text-xs leading-5 text-zinc-500">
                No alerts yet. Set a level on any stock — TradePulse checks it after every data update (including the 4 pm
                auto-update) and flags the moment it triggers.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <button onClick={() => onSelectStock(a.symbol)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
                      {a.symbol.replace(".NS", "")}
                      {a.active ? (
                        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[9px] font-semibold text-brand-text">watching</span>
                      ) : (
                        <span className="rounded-full bg-gold/12 px-2 py-0.5 text-[9px] font-semibold text-gold-text">triggered</span>
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
                      <span className="text-zinc-500">
                        {a.condition === "above" ? "≥" : "≤"} ₹{a.target.toLocaleString("en-IN")}
                      </span>
                      {a.stock && <span className="font-mono text-zinc-300">now {fmtPrice(a.stock.price)}</span>}
                      {a.stock && <span className={cn("font-mono", changeColor(a.stock.changePct))}>{fmtPct(a.stock.changePct)}</span>}
                      {a.triggeredAt && (
                        <span className="text-gold-text">
                          hit {new Date(a.triggeredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          {a.triggeredPc != null ? ` (${fmtPct(a.triggeredPc, 1)})` : ""}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    onClick={() => remove.mutate(a.id)}
                    className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-loss"
                    aria-label="Delete alert"
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
