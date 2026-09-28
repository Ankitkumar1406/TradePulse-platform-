"use client";

/**
 * Scan builder — top-level component (Screener ▸ Condition builder).
 *
 * Replaces the previous row-based builder with the single-input,
 * sentence-style flow. Same external contract as before (initial / save /
 * update / state-change), with the v3 wire format:
 *
 *   { v: 3, scan: Scan, uni?: UniverseState }
 *
 * Saved v2/legacy definitions load through a best-effort converter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  BookmarkPlus, Bug, ChevronDown, ClipboardCopy, ClipboardPaste, RotateCcw, Radar, Table2, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ResultsTable, Pager, SORTS, type StocksResponse } from "@/components/screener-tables";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Clause, Scan } from "@/lib/scan/expr-model";
import {
  countEnabledClauses, initScanUI, reduceScan, scanComplete, type ScanAction, type ScanPath,
} from "@/lib/scan/scan-reducer";
import { defToScan, uniFromDef } from "@/lib/scan/convert";
import { parseScanText, scanToText } from "@/lib/scan/serialize";
import { GroupNode } from "./group-node";
import { useRegistryPrefs } from "./slot-input";
import { DragCtx, type DragWiring } from "./drag-ctx";

export const MAX_TREE_NODES = 200;

// ---------------------------------------------------------------- universe bar

export interface UniverseState {
  universe: "all" | "n50" | "n500" | "fno";
  minPrice: string;
  minMcapCr: string;
  minTurnoverCr: string;
}

const DEFAULT_UNIVERSE: UniverseState = { universe: "all", minPrice: "", minMcapCr: "", minTurnoverCr: "" };

function UniverseBar({ state, onChange }: { state: UniverseState; onChange: (u: UniverseState) => void }) {
  const num = (key: keyof UniverseState, placeholder: string, label: string, title: string) => (
    <label className="flex items-center gap-1 text-[10px] text-zinc-500" title={title}>
      {label}
      <Input
        type="number"
        min={0}
        value={state[key] as string}
        onChange={(e) => onChange({ ...state, [key]: e.target.value })}
        placeholder={placeholder}
        aria-label={label}
        className="h-7 w-20 border-zinc-800 bg-zinc-950 px-1.5 text-center font-mono text-xs text-zinc-100"
      />
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Universe &amp; filters</span>
      <select
        value={state.universe}
        onChange={(e) => onChange({ ...state, universe: e.target.value as UniverseState["universe"] })}
        className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 text-xs text-zinc-200"
        aria-label="Universe"
        title="Which stocks are even considered — baseline filters don't use condition slots"
      >
        <option value="all">All NSE</option>
        <option value="n50">Nifty 50</option>
        <option value="n500">Nifty 500 (top 500 by mcap)</option>
        <option value="fno">F&amp;O eligible</option>
      </select>
      {num("minPrice", "50", "Min price ₹", "Close at or above this price — filters out penny stocks")}
      {num("minMcapCr", "1000", "Min mcap ₹Cr", "Market cap at or above this many ₹ crore")}
      {num("minTurnoverCr", "1", "Min turnover ₹Cr", "Close × volume at or above this many ₹ crore — liquidity floor")}
    </div>
  );
}

// ---------------------------------------------------------------- external contract

export interface BuilderStateInfo {
  name: string | null;
  dirty: boolean;
  wireJson: string;
}

export interface BuilderInitial {
  /** saved definition — v3 / v2 / legacy / text (converted on load) */
  def: unknown;
  name: string | null;
  screenId: string | null;
  /** wire the loaded screen was saved with; omitted → baseline is the current wire */
  baselineWire?: string;
  uni?: UniverseState;
}

// ---------------------------------------------------------------- helpers

function findPath(scan: Scan, id: string): ScanPath | null {
  const walk = (g: Scan["root"], prefix: ScanPath): ScanPath | null => {
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      const p = [...prefix, i];
      if (c.id === id) return p;
      if (c.kind === "group") {
        const inner = walk(c, p);
        if (inner) return inner;
      }
    }
    return null;
  };
  return walk(scan.root, []);
}

const wireOf = (scan: Scan) => JSON.stringify({ v: 3, scan });

/** Debug dialog — computed left/right for sample stocks. */
function DebugDialog({ clause, onClose }: { clause: Clause | null; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ debug: { symbol: string; left: number | string | null; right: number | string | null; pass: boolean; skipped: boolean }[] }>({
    queryKey: ["scanDebug", clause],
    enabled: clause != null,
    queryFn: async () => {
      const res = await fetch("/api/scan/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clause }),
      });
      if (!res.ok) throw new Error("Debug failed");
      return res.json();
    },
  });
  return (
    <Dialog open={clause != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Bug className="h-4 w-4 text-brand-text" /> Condition debug — sample stocks
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 bg-zinc-800/70" />)}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="py-1">Stock</th>
                <th className="py-1 text-right">Left</th>
                <th className="py-1 text-right">Right</th>
                <th className="py-1 text-right">Pass</th>
              </tr>
            </thead>
            <tbody>
              {(data?.debug ?? []).map((r) => (
                <tr key={r.symbol} className="border-t border-zinc-800/60">
                  <td className="py-1 font-medium">{r.symbol.replace(/\.NS$/, "")}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{r.left ?? "—"}</td>
                  <td className="py-1 text-right font-mono tabular-nums">{r.right ?? "—"}</td>
                  <td className={cn("py-1 text-right font-semibold", r.skipped ? "text-zinc-500" : r.pass ? "text-emerald-400" : "text-rose-400")}>
                    {r.skipped ? "no data" : r.pass ? "yes" : "no"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- main

export function ScanBuilder({
  sectors,
  onSelectStock,
  initial,
  onStateChange,
  onSaveNew,
  onUpdate,
}: {
  sectors: (string | null)[];
  onSelectStock: (s: string) => void;
  initial?: BuilderInitial | null;
  onStateChange?: (s: BuilderStateInfo) => void;
  onSaveNew?: (name: string, definition: unknown) => Promise<string | null>;
  onUpdate?: (id: string, name: string, definition: unknown) => Promise<boolean>;
}) {
  const prefs = useRegistryPrefs();
  const [state, setState] = useState(() => {
    if (initial?.def != null) {
      const res = defToScan(initial.def);
      return initScanUI(res ? res.scan : undefined);
    }
    return initScanUI();
  });
  const treeDispatch = useCallback((a: ScanAction) => setState((s) => reduceScan(s, a)), []);
  const [universe, setUniverse] = useState<UniverseState>(initial?.uni ?? DEFAULT_UNIVERSE);
  const [applied, setApplied] = useState<{ wire: string; uni: UniverseState } | null>(
    initial?.def != null && initial.screenId != null ? { wire: wireOf((state.scan)), uni: initial.uni ?? DEFAULT_UNIVERSE } : null,
  );
  const [editingName, setEditingName] = useState<string | null>(initial?.name ?? null);
  const [editingId, setEditingId] = useState<string | null>(initial?.screenId ?? null);
  // v3 defs baseline against their own wire; converted defs start "unsaved"
  const baselineRef = useRef<string>(
    initial?.baselineWire ?? (initial ? wireOf(state.scan) : ""),
  );
  const [sourceName, setSourceName] = useState<string | null>(initial?.name ?? null);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [debugClause, setDebugClause] = useState<Clause | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [sector, setSector] = useState("all");
  const [bSort, setBSort] = useState("marketCap");
  const [bDir, setBDir] = useState<"asc" | "desc">("desc");
  const [bPage, setBPage] = useState(1);
  const [resetConfirm, setResetConfirm] = useState(false);

  const scan = state.scan;
  const complete = useMemo(() => scanComplete(scan), [scan]);
  const clauseCount = countEnabledClauses(scan);
  const wireJson = useMemo(() => wireOf(scan), [scan]);

  // load notes once
  const notesShown = useRef(false);
  useEffect(() => {
    if (notesShown.current || initial?.def == null) return;
    notesShown.current = true;
    const res = defToScan(initial.def);
    if (res?.notes.length) toast({ title: `Loaded with ${res.notes.length} conversion note(s)`, description: res.notes[0] });
    else if (!res) toast({ title: "Saved view could not be converted", variant: "destructive" });
     
  }, []);

  // report state up (same protocol as the old builder)
  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({ name: editingName, dirty: baselineRef.current !== wireJson, wireJson });
     
  }, [wireJson, editingName]);

  // ------------------------------------------------------------ live counter (debounced 400ms)
  const [previewWire, setPreviewWire] = useState<string | null>(null);
  const uniKey = JSON.stringify(universe);
  useEffect(() => {
    const t = setTimeout(() => setPreviewWire(complete && clauseCount > 0 ? wireJson : null), 400);
    return () => clearTimeout(t);
  }, [wireJson, complete, clauseCount]);

  const withCommon = (params: URLSearchParams, uni: UniverseState) => {
    if (sector && sector !== "all") params.set("sector", sector);
    if (uni.universe !== "all") params.set("universe", uni.universe);
    if (uni.minPrice.trim()) params.set("minPrice", uni.minPrice);
    if (uni.minMcapCr.trim()) params.set("minMcapCr", uni.minMcapCr);
    if (uni.minTurnoverCr.trim()) params.set("minTurnoverCr", uni.minTurnoverCr);
  };

  const { data: cData, isFetching: cFetching, error: cError } = useQuery<StocksResponse>({
    queryKey: ["scanPreview", previewWire, uniKey, sector],
    queryFn: async () => {
      const params = new URLSearchParams({ cond: previewWire ?? "[]", page: "1", perPage: "10" });
      withCommon(params, universe);
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d?.error ?? "Preview failed");
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: previewWire !== null,
  });

  // ------------------------------------------------------------ applied results
  const appliedUniKey = applied ? JSON.stringify(applied.uni) : "";
  const colsParam = useMemo(() => {
    if (!applied || !showValues) return null;
    // left/right of the first 3 enabled clauses
    const flat: { clauseIndex: number; side: "left" | "right" }[] = [];
    let idx = 0;
    const walk = (g: Scan["root"]) => {
      for (const c of g.children) {
        if (!c.enabled) continue;
        if (c.kind === "group") { walk(c); continue; }
        if (flat.length < 6) {
          flat.push({ clauseIndex: idx, side: "left" });
          if (flat.length < 6) flat.push({ clauseIndex: idx, side: "right" });
        }
        idx++;
      }
    };
    walk(scan.root);
    return flat.length ? JSON.stringify(flat) : null;
     
  }, [applied, showValues, scan]);

  const { data: bData, isLoading: bLoading, error: bError } = useQuery<StocksResponse & { meta?: { dataDate?: string; fundAvailable?: number | null; skipped?: number; universe?: number; unevaluable?: string[] } }>({
    queryKey: ["scanResults", applied?.wire, appliedUniKey, sector, bSort, bDir, bPage, colsParam],
    queryFn: async () => {
      const params = new URLSearchParams({ cond: applied?.wire ?? "[]", sort: bSort, dir: bDir, page: String(bPage), perPage: "25" });
      withCommon(params, applied?.uni ?? universe);
      if (colsParam) params.set("cols", colsParam);
      const res = await fetch(`/api/stocks?${params}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d?.error ?? "Screen failed — check the conditions");
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
    enabled: applied !== null,
  });

  const runScan = () => {
    if (!complete || clauseCount === 0) return;
    setApplied({ wire: wireJson, uni: universe });
    setBPage(1);
  };

  const resetConditions = () => {
    if (clauseCount >= 3 && !resetConfirm) {
      setResetConfirm(true);
      window.setTimeout(() => setResetConfirm(false), 3500);
      return;
    }
    setResetConfirm(false);
    treeDispatch({ a: "load", scan: { segment: "cash", root: { id: `g${Date.now().toString(36)}`, kind: "group", mode: "all", enabled: true, children: [] } } });
    setApplied(null);
    setSourceName(null);
    baselineRef.current = "";
  };

  // ------------------------------------------------------------ save / update
  const definition = useMemo(() => ({ v: 3, scan, uni: universe }), [scan, universe]);

  const saveAsNew = async () => {
    const name = nameDraft.trim();
    if (!name || !onSaveNew || saving) return;
    setSaving(true);
    try {
      const id = await onSaveNew(name, definition);
      if (id) {
        setEditingId(id);
        setEditingName(name);
        setSourceName(name);
        baselineRef.current = wireJson;
        setNameOpen(false);
        setNameDraft("");
      }
    } finally {
      setSaving(false);
    }
  };

  const updateExisting = async () => {
    if (!editingId || !onUpdate || saving) return;
    setSaving(true);
    try {
      const ok = await onUpdate(editingId, editingName ?? "", definition);
      if (ok) baselineRef.current = wireJson;
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------ text import / export
  const openText = () => {
    setTextDraft(clauseCount > 0 ? scanToText(scan) : "");
    setTextOpen(true);
  };
  const applyText = () => {
    const res = parseScanText(textDraft);
    if (!res.ok) {
      toast({ title: "Could not read that scan", description: res.error, variant: "destructive" });
      return;
    }
    treeDispatch({ a: "load", scan: res.scan });
    setApplied(null);
    setTextOpen(false);
    toast({ title: "Scan imported from text" });
  };
  const copyText = () => {
    navigator.clipboard
      ?.writeText(scanToText(scan))
      .then(() => toast({ title: "Scan copied as text" }))
      .catch(() => toast({ title: "Could not copy", variant: "destructive" }));
  };

  // ------------------------------------------------------------ drag reorder (same-parent, HTML5)
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragWiring: DragWiring = useMemo(
    () => ({
      dragOverId,
      onDragStart: (id) => { dragId.current = id; },
      onDragOver: (id) => { if (dragOverId !== id) setDragOverId(id); },
      onDragEnd: () => { dragId.current = null; setDragOverId(null); },
      onDrop: (id) => {
        const fromId = dragId.current;
        dragId.current = null;
        setDragOverId(null);
        if (!fromId || fromId === id) return;
        const fromPath = findPath(scan, fromId);
        const overPath = findPath(scan, id);
        if (!fromPath || !overPath) return;
        if (fromPath.length !== overPath.length) return; // reorder within the same group only (v1)
        if (fromPath.slice(0, -1).join(",") !== overPath.slice(0, -1).join(",")) return;
        const fromIdx = fromPath[fromPath.length - 1];
        const toIdx = overPath[overPath.length - 1];
        treeDispatch({ a: "moveNode", fromPath, toIndex: fromIdx < toIdx ? toIdx + 1 : toIdx });
      },
    }),
    [dragOverId, scan, treeDispatch],
  );

  // ------------------------------------------------------------ toolbar
  const nameEditor = (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void saveAsNew()}
        placeholder="Screen name…"
        aria-label="Screen name"
        className="h-8 w-40 border-zinc-700 bg-zinc-900 text-xs text-zinc-100"
      />
      <Button size="sm" disabled={saving || !nameDraft.trim()} onClick={() => void saveAsNew()} className="h-8 bg-brand px-2.5 text-xs text-white hover:bg-brand-hover">
        Save
      </Button>
      <button type="button" onClick={() => setNameOpen(false)} aria-label="Cancel save" className="rounded p-1 text-zinc-500 hover:text-zinc-300">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const meta = bData?.meta;

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="space-y-3 p-3">
          {/* sticky toolbar */}
          <div className="sticky top-0 z-20 -mx-3 -mt-1 rounded-t-lg border-b border-zinc-800/60 bg-zinc-950/95 px-3 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openText}
                title="Copy-friendly text version — edit and apply back"
                className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                ⇄ Text
              </button>
              <button
                type="button"
                onClick={copyText}
                disabled={clauseCount === 0}
                title="Copy the scan as Chartink-style text"
                className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <ClipboardCopy className="h-3.5 w-3.5" /> Copy
              </button>
              <Button size="sm" variant="ghost" onClick={resetConditions} className={cn("h-8 px-2.5 text-xs", resetConfirm ? "bg-loss/10 text-loss hover:text-loss" : "text-zinc-500 hover:text-zinc-300")} title={resetConfirm ? "Click again to clear everything" : "Clear the scan"}>
                <RotateCcw className="h-3.5 w-3.5" />
                {resetConfirm ? "Clear everything?" : "Reset"}
              </Button>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <Button
                  size="sm"
                  onClick={runScan}
                  disabled={!complete || clauseCount === 0}
                  title={complete && clauseCount > 0 ? "Run the screen" : "Build a complete condition first"}
                  className="h-8 gap-1.5 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover"
                >
                  <Radar className="h-3.5 w-3.5" /> Run screen
                </Button>
                {sourceName && (
                  <span className="hidden items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] lg:inline-flex" title={baselineRef.current !== wireJson ? "Edits not saved to this screen yet" : "All edits saved"}>
                    <span className="text-zinc-500">editing:</span>
                    <span className="font-medium text-zinc-300">{sourceName}</span>
                    <span className={baselineRef.current !== wireJson ? "text-gold-text" : "text-emerald-400"}>
                      • {baselineRef.current !== wireJson ? "unsaved" : "saved"}
                    </span>
                  </span>
                )}

                {/* live counter */}
                <span className="text-[11px]" aria-live="polite">
                  {!complete || clauseCount === 0 ? (
                    <span className="italic text-zinc-600">Build a condition to preview</span>
                  ) : cFetching ? (
                    <span className="animate-pulse text-zinc-400">checking…</span>
                  ) : cError ? (
                    <span className="text-gold-text">Preview failed — {cError instanceof Error ? cError.message : "check conditions"}</span>
                  ) : cData ? (
                    cData.total === 0 ? (
                      <span className="text-gold-text">0 stocks match — check your condition values</span>
                    ) : (
                      <span className="text-zinc-300">
                        <b className="font-semibold text-brand-text">~{cData.total.toLocaleString("en-IN")}</b> stocks match
                      </span>
                    )
                  ) : (
                    <span className="text-zinc-600">…</span>
                  )}
                </span>

                {editingId ? (
                  <>
                    <Button size="sm" onClick={() => void updateExisting()} disabled={saving || !complete} title="Save over the loaded screen" className="h-8 bg-brand px-3 text-xs text-white hover:bg-brand-hover">
                      {saving ? "Saving…" : "Update"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="h-8 border-zinc-700 bg-zinc-900 px-1.5 text-zinc-300 hover:bg-zinc-800" aria-label="More save options">
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="border-zinc-700 bg-zinc-900 text-zinc-200">
                        <DropdownMenuItem onClick={() => { setNameOpen(true); setNameDraft(""); }}>
                          <BookmarkPlus className="mr-2 h-3.5 w-3.5" /> Save as new screen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : nameOpen ? (
                  nameEditor
                ) : (
                  <Button size="sm" onClick={() => setNameOpen(true)} disabled={!complete || clauseCount === 0} title="Save this scan under a name" className="h-8 gap-1.5 bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover">
                    <BookmarkPlus className="h-3.5 w-3.5" /> Save view
                  </Button>
                )}
              </div>
            </div>
          </div>

          <UniverseBar state={universe} onChange={setUniverse} />

          {/* the scan tree */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <DragCtx.Provider value={dragWiring}>
              <GroupNode group={scan.root} path={[]} treeDispatch={treeDispatch} prefs={prefs} onDebug={setDebugClause} isRoot />
            </DragCtx.Provider>
          </div>
        </CardContent>
      </Card>

      {/* results */}
      {applied == null ? (
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Radar className="h-6 w-6 text-zinc-700" />
            <p className="text-xs text-zinc-500">Build conditions above — matching stocks appear here, with a live count as you type.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runScan}
              className="h-8 rounded-md bg-brand px-3 text-xs font-medium text-white hover:bg-brand-hover"
            >
              Re-run
            </button>
            <select value={sector} onChange={(e) => { setSector(e.target.value); setBPage(1); }} aria-label="Sector filter" className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300">
              <option value="all">All sectors</option>
              {sectors.filter(Boolean).map((s) => (
                <option key={s as string} value={s as string}>{s as string}</option>
              ))}
            </select>
            <select value={bSort} onChange={(e) => { setBSort(e.target.value); setBPage(1); }} aria-label="Sort" className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>Sort: {s.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => { setBDir((d) => (d === "desc" ? "asc" : "desc")); setBPage(1); }} className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300">
              {bDir === "desc" ? "↓ high first" : "↑ low first"}
            </button>
            <button
              type="button"
              onClick={() => setShowValues((v) => !v)}
              title="Evaluate both sides of the first conditions for each stock"
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                showValues ? "border-brand/50 bg-brand/10 text-brand-text" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200",
              )}
            >
              <Table2 className="h-3.5 w-3.5" /> Show computed value
            </button>
            {meta?.dataDate && <span className="text-[10.5px] text-zinc-600">data as of {meta.dataDate}</span>}
            {meta && typeof meta.universe === "number" && (
              <span className="text-[10.5px] text-zinc-600">
                {meta.universe.toLocaleString("en-IN")} stocks scanned
                {meta.skipped ? ` · ${meta.skipped} skipped (insufficient history)` : ""}
                {meta.fundAvailable != null && ` · fundamental data for ${meta.fundAvailable.toLocaleString("en-IN")} of ${meta.universe.toLocaleString("en-IN")}`}
              </span>
            )}
            {meta?.unevaluable && meta.unevaluable.length > 0 && (
              <span className="text-[10.5px] text-gold-text">unsupported: {meta.unevaluable.join(", ")}</span>
            )}
          </div>

          {bError ? (
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="py-8 text-center text-xs text-loss">
                {bError instanceof Error ? bError.message : "Screen failed"}
              </CardContent>
            </Card>
          ) : bLoading ? (
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 bg-zinc-800/70" />)}
              </CardContent>
            </Card>
          ) : (bData?.total ?? 0) === 0 ? (
            <Card className="border-zinc-800 bg-zinc-900/60">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Radar className="h-6 w-6 text-zinc-700" />
                <p className="text-xs text-zinc-500">No stock matches this scan — relax a threshold or remove a condition.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <ResultsTable rows={bData?.stocks} isLoading={false} onSelectStock={onSelectStock} showValues={showValues} />
              {bData && bData.total > bData.perPage && (
                <Pager page={bPage} totalPages={Math.max(1, Math.ceil(bData.total / bData.perPage))} onPage={setBPage} />
              )}
            </>
          )}
        </>
      )}

      {/* text import / export */}
      <Dialog open={textOpen} onOpenChange={setTextOpen}>
        <DialogContent className="max-w-xl border-zinc-800 bg-zinc-900 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ClipboardPaste className="h-4 w-4 text-brand-text" /> Scan as text
            </DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-zinc-500">
            One condition per line, joined by <code className="text-zinc-400">and</code> / <code className="text-zinc-400">or</code>; groups in brackets,
            e.g. <code className="text-zinc-400">any 2 of ( … )</code>. Paste a scan and press Apply to load it into the builder.
          </p>
          <textarea
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            spellCheck={false}
            rows={10}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 outline-none focus:border-brand/50"
            placeholder={"Daily Close / Daily Min(22, Daily Low) > 1.1\nand Market cap > 3cr"}
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs text-zinc-400" onClick={() => setTextOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 bg-brand px-3 text-xs text-white hover:bg-brand-hover" onClick={applyText}>
              Apply to builder
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DebugDialog clause={debugClause} onClose={() => setDebugClause(null)} />
    </div>
  );
}
