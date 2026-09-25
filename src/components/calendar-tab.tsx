"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, CalendarDays, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarketEvent {
  id: string; key: string; date: string; endDate: string | null; title: string;
  category: string; impact: string; source: string | null; tentative: boolean;
  description: string | null; details: string | null;
}

const CAT_STYLE: Record<string, string> = {
  holiday: "bg-loss/12 text-loss border border-loss/25",
  market: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
  expiry: "bg-violet-500/10 text-violet-300 border border-violet-500/30",
  macro: "bg-amber-500/10 text-amber-300 border border-amber-500/30",
  earnings: "bg-sky-500/10 text-sky-300 border border-sky-500/30",
  other: "bg-zinc-800/80 text-zinc-300 border border-zinc-700",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Market calendar — NSE holidays, F&O expiries, macro events, earnings windows. */
export function CalendarTab() {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ events: MarketEvent[] }>({
    queryKey: ["calendar"],
    queryFn: async () => {
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 60 * 60_000,
  });

  const events = data?.events ?? [];
  const byDate = useMemo(() => {
    const map = new Map<string, MarketEvent[]>();
    for (const e of events) {
      const start = new Date(`${e.date}T00:00:00`);
      const end = e.endDate ? new Date(`${e.endDate}T00:00:00`) : start;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = ymd(d);
        const list = map.get(key) ?? [];
        list.push(e);
        map.set(key, list);
      }
    }
    return map;
  }, [events]);

  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const upcomingNonTrading = useMemo(
    () => events
      .filter((e) => e.category === "holiday" && e.date >= ymd(today))
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [events, today]
  );
  const upcomingHighImpact = useMemo(
    () => events
      .filter((e) => e.impact === "high" && e.date >= ymd(today))
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [events, today]
  );
  const agenda30 = useMemo(
    () => events
      .filter((e) => e.date >= ymd(today) && e.date <= ymd(new Date(Date.now() + 30 * 86400_000)))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [events, today]
  );

  const selectedEvents = selected ? byDate.get(selected) ?? [] : [];
  const monthLabel = month.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Calendar · events that move the market</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">Market calendar</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))} className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-300 hover:text-zinc-100">
            Today
          </button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 bg-zinc-900" />
      ) : (
        <>
          {/* callouts */}
          <div className="grid gap-2 sm:grid-cols-2">
            {upcomingNonTrading && (
              <CalloutCard
                label="Next non-trading day"
                title={upcomingNonTrading.title}
                date={upcomingNonTrading.date}
                tone="red"
                tentative={upcomingNonTrading.tentative}
              />
            )}
            {upcomingHighImpact && (
              <CalloutCard
                label="Next high-impact event"
                title={upcomingHighImpact.title}
                date={upcomingHighImpact.date}
                tone="gold"
                tentative={upcomingHighImpact.tentative}
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* month grid */}
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="p-3 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <CalendarDays className="h-4 w-4 text-brand-text" /> {monthLabel}
                  </span>
                  <span className="hidden flex-wrap gap-1.5 sm:flex">
                    {["holiday", "market", "expiry", "macro", "earnings"].map((c) => (
                      <span key={c} className={cn("rounded-full px-2 py-0.5 text-[9px] capitalize", CAT_STYLE[c])}>{c}</span>
                    ))}
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAYS.map((w) => (
                    <div key={w} className="py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{w}</div>
                  ))}
                  {grid.map((d, i) => {
                    if (!d) return <div key={`e-${i}`} className="min-h-14 rounded-md bg-zinc-950/40" />;
                    const key = ymd(d);
                    const evts = byDate.get(key) ?? [];
                    const isToday = key === ymd(today);
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const holiday = evts.some((e) => e.category === "holiday" || e.category === "market");
                    return (
                      <button
                        key={key}
                        onClick={() => setSelected(key === selected ? null : key)}
                        className={cn(
                          "min-h-14 rounded-md border p-1 text-left align-top transition-colors sm:min-h-20",
                          isToday ? "border-brand/60 ring-1 ring-brand/40" : "border-transparent",
                          evts.length ? "hover:border-zinc-600" : "hover:border-zinc-700",
                          (isWeekend || holiday) && !evts.length ? "bg-zinc-950/60" : "bg-zinc-950/40",
                          selected === key && "border-zinc-500"
                        )}
                      >
                        <span className={cn(
                          "text-[10px] font-semibold",
                          isToday ? "text-brand-text" : isWeekend || holiday ? "text-zinc-600" : "text-zinc-400"
                        )}>
                          {d.getDate()}
                        </span>
                        <span className="mt-0.5 hidden flex-col gap-0.5 sm:flex">
                          {evts.slice(0, 2).map((e) => (
                            <span key={e.id} className={cn("truncate rounded px-1 py-0.5 text-[8px] leading-3", CAT_STYLE[e.category] ?? CAT_STYLE.other)}>
                              {e.title}
                            </span>
                          ))}
                          {evts.length > 2 && <span className="text-[8px] text-zinc-600">+{evts.length - 2} more</span>}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
                          {evts.slice(0, 3).map((e) => (
                            <span key={e.id} className={cn("h-1.5 w-1.5 rounded-full", CAT_STYLE[e.category]?.split(" ").find((c) => c.startsWith("text-"))?.replace("text-", "bg-") ?? "bg-zinc-600")} />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* day detail / agenda */}
            <div className="space-y-3">
              {selected ? (
                <Card className="border-zinc-800 bg-zinc-900/60">
                  <CardContent className="p-4">
                    <h3 className="text-sm font-semibold text-zinc-100">
                      {new Date(`${selected}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
                    </h3>
                    {selectedEvents.length === 0 ? (
                      <p className="mt-2 text-xs text-zinc-500">
                        Regular trading day{new Date(`${selected}T00:00:00`).getDay() === 0 || new Date(`${selected}T00:00:00`).getDay() === 6 ? " — but it's a weekend, markets closed." : " — no scheduled events."}
                      </p>
                    ) : (
                      <div className="mt-2.5 space-y-3">
                        {selectedEvents.map((e) => (
                          <div key={e.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize", CAT_STYLE[e.category] ?? CAT_STYLE.other)}>
                                {e.category}
                              </span>
                              <span className="text-xs font-semibold text-zinc-100">{e.title}</span>
                              {e.tentative && <span className="text-[9px] text-zinc-500">(expected)</span>}
                            </div>
                            {e.description && <p className="mt-1.5 text-[11px] leading-5 text-zinc-400">{e.description}</p>}
                            {e.details && (
                              <div className="mt-2 rounded-lg border border-gold/25 bg-gold/8 px-2.5 py-2">
                                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-gold-text">
                                  <Info className="h-3 w-3" /> Why it matters / how to prepare
                                </div>
                                <p className="mt-1 text-[11px] leading-5 text-zinc-300">{e.details}</p>
                              </div>
                            )}
                            {e.source && <p className="mt-1.5 text-[9px] text-zinc-600">Source: {e.source}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-zinc-800 bg-zinc-900/60">
                  <CardContent className="p-4">
                    <h3 className="text-sm font-semibold text-zinc-100">Next 30 days</h3>
                    <div className="mt-2 space-y-1.5">
                      {agenda30.length === 0 && <p className="text-xs text-zinc-500">No scheduled events in the next 30 days.</p>}
                      {agenda30.slice(0, 8).map((e) => (
                        <button
                          key={e.id}
                          onClick={() => { setSelected(e.date); const d = new Date(`${e.date}T00:00:00`); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/50"
                        >
                          <span className="w-14 shrink-0 font-mono text-[10px] text-zinc-500">
                            {new Date(`${e.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </span>
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[8px] font-semibold capitalize", CAT_STYLE[e.category] ?? CAT_STYLE.other)}>{e.category}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{e.title}</span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-3 text-[10px] leading-4 text-zinc-600">
                      Tap any day in the grid for full details. Expected (unconfirmed) dates are marked and stay honest
                      until the official circular lands.
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card className="border-zinc-800 bg-zinc-900/60">
                <CardContent className="p-4">
                  <h3 className="text-xs font-semibold text-zinc-200">Legend</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {["holiday", "market", "expiry", "macro", "earnings"].map((c) => (
                      <Badge key={c} variant="outline" className={cn("text-[9px] capitalize", CAT_STYLE[c])}>{c}</Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-zinc-600">
                    holiday = NSE closed · market = special session (Muhurat) · expiry = monthly F&amp;O expiry ·
                    macro = RBI/Fed/Budget · earnings = results season windows.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CalloutCard({ label, title, date, tone, tentative }: { label: string; title: string; date: string; tone: "red" | "gold"; tentative?: boolean }) {
  return (
    <div className={cn(
      "rounded-2xl border px-4 py-3",
      tone === "red" ? "border-loss/25 bg-loss/8" : "border-gold/25 bg-gold/8"
    )}>
      <div className={cn("text-[9px] font-bold uppercase tracking-wider", tone === "red" ? "text-loss" : "text-gold-text")}>{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold text-zinc-100">{title}</span>
        <span className="text-[10px] text-zinc-500">
          {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
          {tentative ? " (expected)" : ""}
        </span>
      </div>
    </div>
  );
}
