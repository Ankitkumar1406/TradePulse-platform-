"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ActivityIcon, BarChart3, History, RefreshCw, CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SyncStatus {
  phase: string;
  status: string;
  universeDone: number;
  universeTotal: number;
  closesDone: number;
  closesTotal: number;
  barsDone: number;
  barsTotal: number;
  stockCount: number;
  lastQuoteTime: string | null;
  nextAutoUpdate: string | null;
}

function formatDataUpdated(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

function fmtClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(d);
}

/** Header banner: data-updated stamp + sync progress + refresh action. */
export function SyncBanner({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: status } = useQuery<SyncStatus>({
    queryKey: ["syncStatus"],
    queryFn: async () => {
      const res = await fetch("/api/sync");
      if (!res.ok) throw new Error("sync status failed");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const running = status?.status === "running" && status.phase !== "idle";

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "refresh" }),
      });
    } finally {
      await qc.invalidateQueries({ queryKey: ["syncStatus"] });
      setTimeout(() => setRefreshing(false), 1200);
    }
  };

  const stamp = formatDataUpdated(status?.lastQuoteTime ?? null);
  const autoAt = status?.nextAutoUpdate ? fmtClock(status.nextAutoUpdate) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-w-0 items-center gap-2">
        {running ? (
          <span className="flex items-center gap-1.5 text-[11px] text-brand-text">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="hidden sm:inline">
              Syncing {status?.phase} · {status?.phase === "closes" ? `${status.closesDone}/${status.closesTotal}` : `${status.universeDone}/${status.universeTotal}`}
            </span>
            <span className="sm:hidden">sync…</span>
          </span>
        ) : stamp ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
                <History className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span className="truncate">
                  {status && status.stockCount > 0 && (
                    <span className="hidden text-zinc-400 lg:inline">{status.stockCount.toLocaleString("en-IN")} stocks · </span>
                  )}
                  Data updated {stamp} IST
                  {autoAt && <span className="hidden xl:inline"> · auto 4 pm IST</span>}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 border-zinc-800 bg-zinc-900 text-xs text-zinc-300">
              Quotes are as of the last NSE session close, stamped in IST.
              {autoAt ? ` TradePulse auto-updates every trading day at 4:00 pm IST — next update around ${autoAt}.` : " TradePulse auto-updates every trading day at 4:00 pm IST."}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <TriangleAlert className="h-3.5 w-3.5 text-gold-text" /> Preparing data…
          </span>
        )}
        <button
          onClick={() => void onRefresh()}
          className={cn("rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200", refreshing && "text-brand-text")}
          aria-label="Refresh data"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
      </div>
    </TooltipProvider>
  );
}
