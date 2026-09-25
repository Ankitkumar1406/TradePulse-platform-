"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  BookOpen, ChevronDown, Download, Lock, Pencil, Plus, Star, Trash2, TrendingUp,
} from "lucide-react";
import { computePnl, computeStats, fmtINR, fmtR, JOURNAL_SETUPS } from "@/lib/journal";
import { cn } from "@/lib/utils";

interface JournalEntry {
  id: string; kind: string; date: string; title: string | null;
  symbol: string | null; side: string | null;
  entryPrice: number | null; exitPrice: number | null; quantity: number | null;
  stopLoss: number | null; target: number | null;
  setup: string | null; confidence: number | null;
  wentWell: string | null; wentWrong: string | null; learning: string | null;
  notes: string | null; tags: string | null;
  createdAt: string;
}

const emptyForm = {
  kind: "trade" as "trade" | "note",
  date: new Date().toISOString().slice(0, 10),
  title: "",
  symbol: "",
  side: "long" as "long" | "short",
  entryPrice: "",
  exitPrice: "",
  quantity: "",
  stopLoss: "",
  target: "",
  setup: "",
  confidence: 3,
  wentWell: "",
  wentWrong: "",
  learning: "",
  notes: "",
  tags: "",
};

/** Trading journal — trades, learnings, everything. Pro feature. */
export function JournalTab({ isPro, onUpgrade }: { isPro: boolean; onUpgrade: () => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "trade" | "note">("all");
  const [outcome, setOutcome] = useState<"all" | "wins" | "losses" | "open">("all");
  const [search, setSearch] = useState("");
  const [setupFilter, setSetupFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ entries: JournalEntry[] }>({
    queryKey: ["journal"],
    queryFn: async () => {
      const res = await fetch("/api/journal");
      if (res.status === 403) throw new Error("upgrade");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    retry: false,
  });

  const entries = data?.entries ?? [];
  const stats = useMemo(() => computeStats(entries), [entries]);

  const usedSetups = useMemo(
    () => [...new Set(entries.map((e) => e.setup).filter(Boolean) as string[])],
    [entries]
  );

  const filtered = useMemo(() => {
    let list = entries;
    if (filter !== "all") list = list.filter((e) => e.kind === filter);
    if (outcome !== "all") {
      list = list.filter((e) => {
        if (e.kind !== "trade") return false;
        const m = computePnl(e);
        if (outcome === "open") return m.open;
        if (outcome === "wins") return !m.open && (m.pnl ?? 0) > 0;
        return !m.open && (m.pnl ?? 0) < 0;
      });
    }
    if (setupFilter !== "all") list = list.filter((e) => e.setup === setupFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        [e.symbol, e.title, e.learning, e.notes, e.tags].some((t) => (t ?? "").toLowerCase().includes(q))
      );
    }
    return list;
  }, [entries, filter, outcome, setupFilter, search]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["journal"] });
      toast({ title: "Entry deleted" });
    },
  });

  const exportCsv = () => {
    const header = "date,kind,symbol,side,entry,exit,qty,stop,target,setup,confidence,pnl,returnPct,rMultiple,learning,tags,notes";
    const lines = entries.map((e) => {
      const m = computePnl(e);
      return [
        e.date, e.kind, e.symbol ?? "", e.side ?? "", e.entryPrice ?? "", e.exitPrice ?? "", e.quantity ?? "",
        e.stopLoss ?? "", e.target ?? "", e.setup ?? "", e.confidence ?? "",
        m.pnl != null ? m.pnl.toFixed(2) : "", m.returnPct != null ? m.returnPct.toFixed(2) : "",
        m.rMultiple != null ? m.rMultiple.toFixed(2) : "",
        e.learning ?? "", e.tags ?? "", (e.notes ?? "").replace(/\n/g, " "),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tradepulse-journal.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 bg-zinc-900" />
        <Skeleton className="h-64 bg-zinc-900" />
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-gold/30 bg-zinc-900/40 py-16 text-center">
        <Lock className="h-7 w-7 text-gold-text" />
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">The trading journal is a Pro feature</h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-zinc-500">
            Log every trade with auto P&amp;L and R-multiples, review what went well and what didn&apos;t, and store
            every market learning in one place. Start the 15-day free trial to use it today.
          </p>
        </div>
        <Button onClick={onUpgrade} className="h-9 rounded-full bg-brand px-5 text-xs font-semibold text-white hover:bg-brand-hover">
          <Star className="mr-1.5 h-3.5 w-3.5" /> Upgrade to Pro
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Journal · trades, learnings, everything</div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-100">Trading journal</h2>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv} className="h-8 border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-300 hover:bg-zinc-800">
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => { setEditing(null); setEditorOpen(true); }}
            className="h-8 bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-hover"
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> New entry
          </Button>
        </div>
      </div>

      {/* stats strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Trades" value={String(stats.trades)} sub={`${stats.closed} closed · ${stats.open} open`} />
        <StatCard label="Win rate" value={stats.winRate != null ? `${stats.winRate.toFixed(0)}%` : "—"} sub={`${stats.wins}W · ${stats.losses}L`} tone={stats.winRate != null && stats.winRate >= 50 ? "up" : undefined} />
        <StatCard label="Net P&L" value={fmtINR(stats.netPnl)} tone={stats.netPnl > 0 ? "up" : stats.netPnl < 0 ? "down" : undefined} />
        <StatCard label="Profit factor" value={stats.profitFactor == null ? "—" : stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)} />
        <StatCard label="Avg R" value={fmtR(stats.avgR)} tone={stats.avgR != null && stats.avgR > 0 ? "up" : stats.avgR != null && stats.avgR < 0 ? "down" : undefined} />
        <StatCard label="Learnings" value={String(stats.notes)} sub="market notes logged" />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-800">
          {(["all", "trade", "note"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn("px-2.5 py-1.5 text-[11px] capitalize transition-colors", filter === f ? "bg-brand/15 text-brand-text" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300")}
            >
              {f === "all" ? "All" : f === "trade" ? "Trades" : "Notes"}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-zinc-800">
          {(["all", "wins", "losses", "open"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setOutcome(f)}
              className={cn("px-2.5 py-1.5 text-[11px] capitalize transition-colors", outcome === f ? "bg-brand/15 text-brand-text" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300")}
            >
              {f}
            </button>
          ))}
        </div>
        {usedSetups.length > 0 && (
          <select
            value={setupFilter}
            onChange={(e) => setSetupFilter(e.target.value)}
            className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300"
            aria-label="Setup filter"
          >
            <option value="all">All setups</option>
            {usedSetups.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol, learning, tags…"
          className="h-8 w-48 border-zinc-800 bg-zinc-900 text-xs text-zinc-100"
        />
      </div>

      {/* entries */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-800 py-14 text-center">
          <BookOpen className="h-7 w-7 text-zinc-700" />
          <p className="max-w-md text-xs leading-5 text-zinc-500">
            {entries.length === 0
              ? "The journal is where the edge compounds. Log your first trade — entry, stop, target, setup and conviction — or write a market note about what today taught you."
              : "Nothing matches these filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((e) => {
            const m = computePnl(e);
            const isOpen = expanded === e.id;
            return (
              <Card key={e.id} className="border-zinc-800 bg-zinc-900/60">
                <CardContent className="p-0">
                  <button
                    onClick={() => setExpanded(isOpen ? null : e.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                          e.kind === "trade" ? "bg-brand/10 text-brand-text" : "bg-gold/12 text-gold-text"
                        )}
                      >
                        {e.kind}
                      </span>
                      {e.symbol && (
                        <span className="text-xs font-semibold text-zinc-100">
                          {e.symbol.replace(".NS", "")}
                          <span className={cn("ml-1.5 text-[10px] font-medium", e.side === "short" ? "text-loss" : "text-emerald-400")}>
                            {e.side === "short" ? "SHORT" : "LONG"}
                          </span>
                        </span>
                      )}
                      {e.title && !e.symbol && <span className="truncate text-xs font-semibold text-zinc-100">{e.title}</span>}
                      {e.setup && <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[9px] text-zinc-400">{e.setup}</span>}
                      <span className="text-[10px] text-zinc-600">{e.date}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                      {e.confidence != null && (
                        <span className="flex items-center gap-0.5" title={`Conviction ${e.confidence}/5`}>
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={cn("h-2.5 w-2.5", i < e.confidence! ? "fill-gold text-gold" : "text-zinc-700")} />
                          ))}
                        </span>
                      )}
                      {e.kind === "trade" && (
                        <span className="font-mono text-xs">
                          {m.open ? (
                            <span className="text-gold-text">open</span>
                          ) : m.pnl != null ? (
                            <>
                              <span className={m.pnl > 0 ? "text-emerald-400" : m.pnl < 0 ? "text-red-400" : "text-zinc-300"}>{fmtINR(m.pnl)}</span>
                              <span className="ml-1.5 text-zinc-500">{fmtR(m.rMultiple)}</span>
                            </>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </span>
                      )}
                      <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-600 transition-transform", isOpen && "rotate-180")} />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-zinc-800/60 px-4 py-3">
                      {e.kind === "trade" && (
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                          <MiniStat label="Entry" value={e.entryPrice != null ? `₹${e.entryPrice}` : "—"} />
                          <MiniStat label="Exit" value={e.exitPrice != null ? `₹${e.exitPrice}` : "open"} />
                          <MiniStat label="Qty" value={e.quantity != null ? String(e.quantity) : "—"} />
                          <MiniStat label="Return" value={m.returnPct != null ? `${m.returnPct > 0 ? "+" : ""}${m.returnPct.toFixed(2)}%` : "—"} tone={m.returnPct != null ? (m.returnPct > 0 ? "up" : "down") : undefined} />
                          <MiniStat label="R multiple" value={fmtR(m.rMultiple)} />
                        </div>
                      )}
                      {e.title && e.symbol && <p className="text-xs font-medium text-zinc-200">{e.title}</p>}
                      <div className="mt-2 grid gap-2.5 sm:grid-cols-3">
                        {e.wentWell && <ReviewBlock label="What went well" text={e.wentWell} tone="up" />}
                        {e.wentWrong && <ReviewBlock label="What went wrong" text={e.wentWrong} tone="down" />}
                        {e.learning && <ReviewBlock label="Key learning" text={e.learning} tone="gold" />}
                      </div>
                      {e.notes && <p className="mt-2.5 whitespace-pre-wrap text-xs leading-5 text-zinc-400">{e.notes}</p>}
                      {e.tags && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {e.tags.split(",").filter(Boolean).map((t) => (
                            <span key={t} className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[9px] text-zinc-400">#{t.trim()}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(e); setEditorOpen(true); }} className="h-7 px-2.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
                          <Pencil className="mr-1 h-3 w-3" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { if (confirm("Delete this entry?")) remove.mutate(e.id); }} className="h-7 px-2.5 text-xs text-loss hover:bg-loss/10 hover:text-loss">
                          <Trash2 className="mr-1 h-3 w-3" /> Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editorOpen && (
        <JournalEditor
          editing={editing}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 font-mono text-lg font-bold", tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-zinc-100")}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-zinc-600">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("font-mono text-xs font-semibold", tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-zinc-200")}>{value}</div>
    </div>
  );
}

function ReviewBlock({ label, text, tone }: { label: string; text: string; tone: "up" | "down" | "gold" }) {
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2",
      tone === "up" ? "border-emerald-500/20 bg-emerald-500/5" : tone === "down" ? "border-red-500/20 bg-red-500/5" : "border-gold/25 bg-gold/8"
    )}>
      <div className={cn("text-[9px] font-semibold uppercase tracking-wider", tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-gold-text")}>
        {label}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-zinc-300">{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------- editor

function JournalEditor({ editing, onClose }: { editing: JournalEntry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() =>
    editing
      ? {
          kind: (editing.kind === "note" ? "note" : "trade") as "trade" | "note",
          date: editing.date,
          title: editing.title ?? "",
          symbol: editing.symbol?.replace(".NS", "") ?? "",
          side: (editing.side === "short" ? "short" : "long") as "long" | "short",
          entryPrice: editing.entryPrice?.toString() ?? "",
          exitPrice: editing.exitPrice?.toString() ?? "",
          quantity: editing.quantity?.toString() ?? "",
          stopLoss: editing.stopLoss?.toString() ?? "",
          target: editing.target?.toString() ?? "",
          setup: editing.setup ?? "",
          confidence: editing.confidence ?? 3,
          wentWell: editing.wentWell ?? "",
          wentWrong: editing.wentWrong ?? "",
          learning: editing.learning ?? "",
          notes: editing.notes ?? "",
          tags: editing.tags ?? "",
        }
      : { ...emptyForm }
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const preview = computePnl({
    side: f.side,
    entryPrice: Number(f.entryPrice) || null,
    exitPrice: f.exitPrice ? Number(f.exitPrice) : null,
    quantity: Number(f.quantity) || null,
    stopLoss: Number(f.stopLoss) || null,
  });

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        ...f,
        symbol: f.kind === "trade" ? f.symbol.trim() : undefined,
        entryPrice: f.entryPrice ? Number(f.entryPrice) : null,
        exitPrice: f.exitPrice ? Number(f.exitPrice) : null,
        quantity: f.quantity ? Number(f.quantity) : null,
        stopLoss: f.stopLoss ? Number(f.stopLoss) : null,
        target: f.target ? Number(f.target) : null,
        confidence: f.confidence,
      };
      const res = await fetch(editing ? `/api/journal/${editing.id}` : "/api/journal", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors((j as { errors?: Record<string, string> }).errors ?? { _: (j as { error?: string }).error ?? "Could not save" });
        return;
      }
      await qc.invalidateQueries({ queryKey: ["journal"] });
      toast({ title: editing ? "Entry updated" : "Entry saved to journal" });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string) => v.replace(/[^\d.]/g, "");
  const inputCls = "h-9 border-zinc-800 bg-zinc-900 text-sm text-zinc-100";
  const err = (k: string) => errors[k] && <p className="mt-0.5 text-[10px] text-loss">{errors[k]}</p>;

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="w-[calc(100%-2rem)] max-h-[92vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-200 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base text-zinc-50">{editing ? "Edit journal entry" : "New journal entry"}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <button
            onClick={() => set("kind", "trade")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors",
              f.kind === "trade" ? "border-brand/60 bg-brand/10 text-brand-text" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            )}
          >
            <TrendingUp className="h-3.5 w-3.5" /> Trade
          </button>
          <button
            onClick={() => set("kind", "note")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors",
              f.kind === "note" ? "border-gold/60 bg-gold/10 text-gold-text" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            )}
          >
            <BookOpen className="h-3.5 w-3.5" /> Learning / note
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-zinc-400">Date *</Label>
            <Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} className={cn(inputCls, "mt-1")} />
          </div>
          {f.kind === "note" ? (
            <div>
              <Label className="text-xs text-zinc-400">Headline *</Label>
              <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Chasing gaps costs money" className={cn(inputCls, "mt-1")} />
              {err("title")}
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs text-zinc-400">Symbol *</Label>
                <Input
                  value={f.symbol}
                  onChange={(e) => set("symbol", e.target.value.toUpperCase())}
                  placeholder="e.g. RELIANCE"
                  className={cn(inputCls, "mt-1")}
                />
                {err("symbol")}
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Direction</Label>
                <div className="mt-1 flex overflow-hidden rounded-md border border-zinc-800">
                  {(["long", "short"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => set("side", s)}
                      className={cn("flex-1 py-2 text-xs transition-colors", f.side === s ? (s === "long" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400") : "bg-zinc-900 text-zinc-500")}
                    >
                      {s === "long" ? "Long" : "Short"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Entry price *</Label>
                <Input value={f.entryPrice} onChange={(e) => set("entryPrice", num(e.target.value))} inputMode="decimal" placeholder="0.00" className={cn(inputCls, "mt-1")} />
                {err("entryPrice")}
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Quantity *</Label>
                <Input value={f.quantity} onChange={(e) => set("quantity", num(e.target.value))} inputMode="numeric" placeholder="0" className={cn(inputCls, "mt-1")} />
                {err("quantity")}
              </div>
              <div>
                <Label className="text-xs text-zinc-400">Exit price <span className="text-zinc-600">(blank = open)</span></Label>
                <Input value={f.exitPrice} onChange={(e) => set("exitPrice", num(e.target.value))} inputMode="decimal" placeholder="0.00" className={cn(inputCls, "mt-1")} />
                {err("exitPrice")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-zinc-400">Stop loss</Label>
                  <Input value={f.stopLoss} onChange={(e) => set("stopLoss", num(e.target.value))} inputMode="decimal" placeholder="0.00" className={cn(inputCls, "mt-1")} />
                </div>
                <div>
                  <Label className="text-xs text-zinc-400">Target</Label>
                  <Input value={f.target} onChange={(e) => set("target", num(e.target.value))} inputMode="decimal" placeholder="0.00" className={cn(inputCls, "mt-1")} />
                </div>
              </div>
            </>
          )}
          {f.kind === "note" && null}
          <div>
            <Label className="text-xs text-zinc-400">Setup / playbook</Label>
            <select
              value={f.setup}
              onChange={(e) => set("setup", e.target.value)}
              className={cn(inputCls, "mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-200")}
            >
              <option value="">— none —</option>
              {JOURNAL_SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* conviction */}
        <div className="mt-3">
          <Label className="text-xs text-zinc-400">Conviction at entry</Label>
          <div className="mt-1.5 flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => set("confidence", n)} aria-label={`Conviction ${n}`}>
                <Star className={cn("h-5 w-5 transition-colors", n <= f.confidence ? "fill-gold text-gold" : "text-zinc-700 hover:text-zinc-500")} />
              </button>
            ))}
            <span className="ml-1.5 text-[10px] text-zinc-600">{f.confidence}/5</span>
          </div>
        </div>

        {/* live P&L preview */}
        {f.kind === "trade" && Number(f.entryPrice) > 0 && Number(f.quantity) > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-brand/25 bg-brand/8 px-3.5 py-2.5 text-xs">
            <span className="font-semibold text-brand-text">Live preview</span>
            {preview.open ? (
              <span className="text-zinc-400">position open — add an exit price to compute P&amp;L</span>
            ) : (
              <>
                <span className="font-mono text-zinc-100">P&L {fmtINR(preview.pnl ?? 0)}</span>
                <span className="font-mono text-zinc-300">
                  {preview.returnPct != null ? `${preview.returnPct > 0 ? "+" : ""}${preview.returnPct.toFixed(2)}%` : ""}
                </span>
                <span className="font-mono text-zinc-300">{fmtR(preview.rMultiple)}</span>
              </>
            )}
          </div>
        )}

        {/* review fields */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {f.kind === "trade" && (
            <>
              <div>
                <Label className="text-xs text-zinc-400">What went well</Label>
                <textarea
                  value={f.wentWell}
                  onChange={(e) => set("wentWell", e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
                  placeholder="Followed the plan, clean entry…"
                />
              </div>
              <div>
                <Label className="text-xs text-zinc-400">What went wrong</Label>
                <textarea
                  value={f.wentWrong}
                  onChange={(e) => set("wentWrong", e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
                  placeholder="Exited early, moved the stop…"
                />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Label className="text-xs text-zinc-400">Key learning *{f.kind === "note" ? "" : " (the heart of the journal)"}</Label>
            <textarea
              value={f.learning}
              onChange={(e) => set("learning", e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
              placeholder={f.kind === "trade" ? "One line you'll want to remember next time…" : "What did the market teach you today?"}
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs text-zinc-400">{f.kind === "note" ? "Notes * (the full observation)" : "Notes"}</Label>
            <textarea
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
              placeholder={f.kind === "note" ? "Market observation, plan review, mistake post-mortem — everything…" : "Extra context, screenshots references, news…"}
            />
            {err("notes")}
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs text-zinc-400">Tags <span className="text-zinc-600">(comma separated)</span></Label>
            <Input value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="nifty, banking, patience" className={cn(inputCls, "mt-1")} />
          </div>
        </div>

        {errors._ && <p className="mt-2 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">{errors._}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="h-9 border-zinc-700 bg-transparent text-xs text-zinc-300 hover:bg-zinc-800">
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} className="h-9 bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-hover">
            {busy ? "Saving…" : editing ? "Save changes" : "Save entry"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
