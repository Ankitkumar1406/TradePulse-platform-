"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Watchlist star toggle for scan / screener results.
 *
 * Renders a compact star button that adds or removes a symbol from the
 * watchlist straight from a results table row or a chart tile header.
 * Clicks never propagate, so the row's own "open stock detail" handler
 * stays intact. Membership state comes from the shared ["watchlist"]
 * query, so the Watchlist tab, the stock dialog and every star here
 * stay in sync instantly.
 */
export function AddToWatchlistButton({
  symbol,
  className,
  iconClassName,
}: {
  symbol: string;
  /** Extra classes for the wrapper button (sizing tweaks per surface). */
  className?: string;
  /** Extra classes for the star icon itself. */
  iconClassName?: string;
}) {
  const qc = useQueryClient();
  const label = symbol.replace(".NS", "");

  const { data } = useQuery<{ items: { symbol: string }[] }>({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/watchlist");
      if (!res.ok) return { items: [] };
      return res.json();
    },
    staleTime: 30_000,
  });
  const onList = (data?.items ?? []).some((i) => i.symbol === symbol);

  const toggle = useMutation({
    mutationFn: async (add: boolean) => {
      const res = add
        ? await fetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol }),
          })
        : await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { error?: string; upgrade?: boolean };
      if (!res.ok) {
        const err = new Error(j.error ?? "Could not update the watchlist") as Error & { upgrade?: boolean };
        err.upgrade = Boolean(j.upgrade);
        throw err;
      }
      return j;
    },
    onSuccess: (_j, add) => {
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
      toast({
        title: add ? `${label} added to watchlist` : `${label} removed from watchlist`,
        description: add ? "Review it in the Watchlist tab." : undefined,
      });
    },
    onError: (e: Error & { upgrade?: boolean }) => {
      if (e.upgrade) {
        toast({
          title: "Watchlist is full",
          description: "The free plan keeps 10 stocks. Upgrade to Pro for an unlimited watchlist.",
        });
      } else {
        toast({ title: e.message, variant: "destructive" });
      }
    },
  });

  return (
    <button
      type="button"
      disabled={toggle.isPending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggle.mutate(!onList);
      }}
      title={onList ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`}
      aria-label={onList ? `Remove ${label} from watchlist` : `Add ${label} to watchlist`}
      aria-pressed={onList}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 transition-colors",
        onList ? "text-gold hover:text-gold-text" : "text-zinc-600 hover:bg-zinc-800/60 hover:text-gold-text",
        className
      )}
    >
      <Star className={cn("h-3.5 w-3.5", onList && "fill-gold", iconClassName)} />
    </button>
  );
}
