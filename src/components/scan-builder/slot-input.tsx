"use client";

/**
 * Scan builder — SlotInput + token chips (Deliverable 2, UI half).
 *
 * SlotInput is the ONE input of the builder: a combobox whose options mirror
 * what the cursor expects (operand → math op / comparator / finish). It hosts
 * the keyboard contract (Enter commits, Tab next slot, Esc cancels, Backspace
 * on empty removes the last token, arrows move, typing filters).
 *
 * Token chips render committed operands; every time-based token carries a
 * muted timeframe·offset prefix that opens a NON-BLOCKING editor — the flow
 * never pauses for it. Fundamentals carry a period chip instead. Number
 * literals accept 3cr / 50L / 1.5k and display readably.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowRight,
  Braces,
  Check,
  ChevronDown,
  Hash,
  ListPlus,
  Plus,
  Star,
  Type,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Expr, FundPeriod, Offset, OffsetUnit, Term, Timeframe } from "@/lib/scan/expr-model";
import { isOp } from "@/lib/scan/expr-model";
import {
  allItems,
  byId,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  COMPARATOR_BY_ID,
  FUND_PERIOD_LABELS,
  MATH_OPS,
  OFFSET_UNITS_BY_TF,
  TF_LABELS,
  type FundPeriod as FundPeriodT,
  type RegistryItem,
} from "@/lib/scan/registry";
import {
  canFinish,
  comparatorsAllowed,
  cursorHint,
  curExpr,
  slotInfo,
  unitWarning,
  type PatchSide,
  type PathStep,
  type SMAction,
  type SMState,
} from "@/lib/scan/slot-machine";
import { clauseSentence, comparatorLabel, fmtReadable, offsetLabel, tfOffsetLabel } from "@/lib/scan/expr-display";

// ---------------------------------------------------------------- prefs (recents + starred)

const RECENT_KEY = "tp.scan.recentItems";
const STAR_KEY = "tp.scan.starItems";
const EMPTY_IDS: string[] = [];

/** Tiny localStorage-backed store — read via useSyncExternalStore (SSR-safe). */
function createLocalStore(key: string, cap: number, dedupe: boolean) {
  let cached: string[] | null = null;
  const listeners = new Set<() => void>();
  const read = (): string[] => {
    if (cached) return cached;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
      cached = Array.isArray(parsed) ? parsed : [];
    } catch {
      cached = [];
    }
    return cached;
  };
  const write = (next: string[]) => {
    cached = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage disabled — session-only */
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const push = (id: string) => {
    const cur = read();
    const next = dedupe ? [id, ...cur.filter((x) => x !== id)].slice(0, cap) : cur.includes(id) ? cur : [id, ...cur].slice(0, cap);
    write(next);
  };
  const toggle = (id: string) => {
    const cur = read();
    write(cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, cap));
  };
  return { read, subscribe, push, toggle };
}

export interface RegistryPrefs {
  recents: string[];
  starred: string[];
  pushRecent(id: string): void;
  toggleStar(id: string): void;
}

export function useRegistryPrefs(): RegistryPrefs {
  const recentStore = useMemo(() => createLocalStore(RECENT_KEY, 12, true), []);
  const starStore = useMemo(() => createLocalStore(STAR_KEY, 60, false), []);
  const recents = useSyncExternalStore(recentStore.subscribe, recentStore.read, () => EMPTY_IDS);
  const starred = useSyncExternalStore(starStore.subscribe, starStore.read, () => EMPTY_IDS);
  return {
    recents,
    starred,
    pushRecent: recentStore.push,
    toggleStar: starStore.toggle,
  };
}

// ---------------------------------------------------------------- token chip shells

function PrefixChip({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground",
        "bg-muted/70 hover:bg-muted hover:text-foreground transition-colors",
        !onClick && "cursor-default",
      )}
    >
      {children}
    </button>
  );
}

function NameChip({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border bg-background px-1.5 py-0.5 text-xs font-semibold text-foreground",
        onClick && "hover:border-primary/50 hover:bg-primary/5 transition-colors",
      )}
    >
      {children}
    </button>
  );
}

function NumberChip({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md bg-primary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground",
        onClick && "hover:opacity-85 transition-opacity",
      )}
    >
      {children}
    </button>
  );
}

function TextChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-dashed bg-background px-1.5 py-0.5 text-xs text-foreground">
      {children}
    </span>
  );
}

function OpChip({ disp }: { disp: string }) {
  return (
    <span className="px-0.5 text-sm font-bold text-amber-600 dark:text-amber-400" title="math operator">
      {disp}
    </span>
  );
}

// ---------------------------------------------------------------- timeframe / offset editor (non-blocking)

const UNIT_LABELS: Record<OffsetUnit, string> = {
  candle: "candles ago",
  day: "days ago",
  week: "weeks ago",
  month: "months ago",
};

export function TfOffsetEditor({
  tf,
  offset,
  period,
  periodOptions,
  supportsTimeframe,
  onApply,
}: {
  tf: Timeframe;
  offset: Offset;
  period?: FundPeriod;
  periodOptions?: FundPeriodT[];
  supportsTimeframe: boolean;
  onApply: (patch: { tf?: Timeframe; offset?: Offset; period?: FundPeriod | null }) => void;
}) {
  const [n, setN] = useState<string>(offset && offset.unit !== "candle" ? String(offset.n) : "1");
  const units = OFFSET_UNITS_BY_TF[tf];
  const activeN = Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.floor(Number(n)) : 1;
  return (
    <div className="w-[260px] space-y-2.5 p-1">
      {supportsTimeframe && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Timeframe</p>
          <div className="flex gap-1">
            {(Object.keys(TF_LABELS) as Timeframe[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onApply({ tf: t })}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                  t === tf ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {TF_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}
      {supportsTimeframe && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Offset</p>
          <button
            type="button"
            onClick={() => onApply({ offset: null })}
            className={cn(
              "mb-1.5 w-full rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              !offset ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            Latest
          </button>
          <div className="flex items-center gap-1.5">
            <Input
              value={n}
              onChange={(e) => setN(e.target.value.replace(/[^\d]/g, ""))}
              className="h-7 w-14 text-center text-xs tabular-nums"
              inputMode="numeric"
            />
            <div className="flex flex-wrap gap-1">
              {units.map((u) => {
                const active = offset?.unit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => onApply({ offset: { n: activeN, unit: u } })}
                    className={cn(
                      "rounded-md border px-1.5 py-1 text-[11px] transition-colors",
                      active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {UNIT_LABELS[u]}
                  </button>
                );
              })}
            </div>
          </div>
          {offset && (
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              Current: {offsetLabel(offset)} · only units valid for {TF_LABELS[tf].toLowerCase()} are shown
            </p>
          )}
        </div>
      )}
      {periodOptions && periodOptions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Period</p>
          <div className="flex flex-wrap gap-1">
            {periodOptions.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onApply({ period: p })}
                className={cn(
                  "rounded-md border px-1.5 py-1 text-[11px] transition-colors",
                  (period ?? periodOptions[0]) === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {FUND_PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Muted prefix on a time-based token — click to edit, flow never pauses. */
export function TfOffsetChip({
  term,
  side,
  path,
  dispatch,
}: {
  term: Extract<Term, { t: "attr" | "fn" | "saved" }>;
  side: PatchSide;
  path: PathStep[];
  dispatch: (a: SMAction) => void;
}) {
  const item = term.t === "attr" ? byId(term.name) : term.t === "fn" ? byId(term.name) : byId(`saved:${term.id}`);
  if (item?.periodSelector) {
    const current = term.t === "attr" ? (term.period ?? item.periodSelector[0]) : item.periodSelector[0];
    return (
      <Popover>
        <PopoverTrigger asChild>
          <PrefixChip onClick={() => {}}>
            {FUND_PERIOD_LABELS[current]}
          </PrefixChip>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1" align="start">
          <TfOffsetEditor
            tf={term.tf}
            offset={term.offset}
            period={current}
            periodOptions={item.periodSelector}
            supportsTimeframe={false}
            onApply={(patch) => dispatch({ a: "patchTerm", side, path, patch })}
          />
        </PopoverContent>
      </Popover>
    );
  }
  if (!item?.supportsTimeframe) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <PrefixChip onClick={() => {}}>{tfOffsetLabel(term.tf, term.offset)}</PrefixChip>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1" align="start">
        <TfOffsetEditor
          tf={term.tf}
          offset={term.offset}
          supportsTimeframe
          onApply={(patch) => dispatch({ a: "patchTerm", side, path, patch })}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Number token chip — click to retype (unit shortcuts welcome). */
export function NumberTokenChip({
  value,
  side,
  path,
  dispatch,
  allowUnits = true,
}: {
  value: number;
  side: PatchSide;
  path: PathStep[];
  dispatch: (a: SMAction) => void;
  allowUnits?: boolean;
}) {
  const [val, setVal] = useState(String(value));
  const commit = () => {
    const parsed = allowUnits ? parseNum(val) : Number(val);
    if (parsed != null && Number.isFinite(parsed)) dispatch({ a: "patchTerm", side, path, patch: { value: parsed } });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <NumberChip onClick={() => {}}>{fmtReadable(value)}</NumberChip>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2" align="start">
        <Input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className="h-7 text-xs tabular-nums"
          inputMode="decimal"
          placeholder={allowUnits ? "500 · 3cr · 50L · 1.5k" : "whole number"}
        />
        <p className="mt-1.5 text-[10.5px] text-muted-foreground">
          {allowUnits ? "Accepts 3cr / 50L / 1.5k" : "Plain number"} — Enter to apply
        </p>
      </PopoverContent>
    </Popover>
  );
}

function parseNum(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)(cr|crore|l|lac|lakh|k)?$/i);
  if (!m) return null;
  const mult = m[2] ? ({ cr: 1e7, crore: 1e7, l: 1e5, lac: 1e5, lakh: 1e5, k: 1e3 } as Record<string, number>)[m[2].toLowerCase()] ?? 1 : 1;
  const v = Number(m[1]) * mult;
  return Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------- token → chip tree

/** Everything the recursive chip renderer needs — threaded down fn args / brackets. */
interface ChipCtx {
  side: PatchSide;
  dispatch: (a: SMAction) => void;
  state: SMState;
  prefs: RegistryPrefs;
  cursorArr: Expr | null;
  onInsertGroup?: () => void;
}

function TokenChip({ term, ctx, path }: { term: Term; ctx: ChipCtx; path: PathStep[] }) {
  switch (term.t) {
    case "number":
      return <NumberTokenChip value={term.value} side={ctx.side} path={path} dispatch={ctx.dispatch} />;
    case "text":
      return <TextChip>“{term.value}”</TextChip>;
    case "attr": {
      const item = byId(term.name);
      return (
        <span className="inline-flex items-center gap-1">
          <TfOffsetChip term={term} side={ctx.side} path={path} dispatch={ctx.dispatch} />
          <NameChip>{item?.label ?? term.name}</NameChip>
        </span>
      );
    }
    case "fn": {
      const item = byId(term.name);
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <TfOffsetChip term={term} side={ctx.side} path={path} dispatch={ctx.dispatch} />
          <NameChip>{item?.label ?? term.name}</NameChip>
          <span className="text-xs text-muted-foreground">(</span>
          {term.args.map((arg, j) => {
            // arg addressing reuses the fn's step with arg: j
            const argPath = [...path.slice(0, -1), { ...path[path.length - 1], arg: j }];
            return (
              <span key={j} className="inline-flex items-center gap-1">
                {j > 0 && <span className="text-xs text-muted-foreground">,</span>}
                <ExprChips expr={arg} ctx={ctx} path={argPath} />
              </span>
            );
          })}
          <span className="text-xs text-muted-foreground">)</span>
        </span>
      );
    }
    case "bracket":
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1 py-0.5">
          <span className="text-xs text-muted-foreground">(</span>
          {/* the bracket's own step is the descent step — children append theirs */}
          <ExprChips expr={term.inner} ctx={ctx} path={path} />
          <span className="text-xs text-muted-foreground">)</span>
        </span>
      );
    case "saved": {
      const item = byId(`saved:${term.id}`);
      return (
        <span className="inline-flex items-center gap-1">
          <TfOffsetChip term={term} side={ctx.side} path={path} dispatch={ctx.dispatch} />
          <NameChip>{item?.label ?? term.id}</NameChip>
        </span>
      );
    }
  }
}

/**
 * Renders one Expr as a wrapped line of chips. When this exact array is the
 * machine's cursor container, the SlotInput is appended at the cursor.
 */
export function ExprChips({
  expr,
  ctx,
  path,
}: {
  expr: Expr;
  ctx: ChipCtx;
  path: PathStep[];
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {expr.map((x, i) =>
        isOp(x) ? (
          <OpChip key={i} disp={MATH_OPS.find((m) => m.op === x.op)?.disp ?? x.op} />
        ) : (
          <TokenChip key={i} term={x} ctx={ctx} path={[...path, { i }]} />
        ),
      )}
      {expr === ctx.cursorArr && (
        <SlotInput state={ctx.state} dispatch={ctx.dispatch} prefs={ctx.prefs} onInsertGroup={ctx.onInsertGroup} />
      )}
    </span>
  );
}

// ---------------------------------------------------------------- SlotInput (the one input)

export function SlotInput({
  state,
  dispatch,
  prefs,
  onInsertGroup,
}: {
  state: SMState;
  dispatch: (a: SMAction) => void;
  prefs: RegistryPrefs;
  onInsertGroup?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"picker" | "number" | "text">("picker");
  const [val, setVal] = useState("");
  const info = slotInfo(state);
  const done = state.phase === "done";

  const resetInternal = () => {
    setQuery("");
    setMode("picker");
    setVal("");
  };

  const pickItem = (item: RegistryItem) => {
    prefs.pushRecent(item.id);
    dispatch({ a: "pick", item, period: item.periodSelector?.[0] });
    resetInternal();
  };

  const commitVal = () => {
    if (!val.trim()) return;
    if (mode === "number") dispatch({ a: "number", raw: val });
    else dispatch({ a: "text", value: val });
    resetInternal();
  };

  const items = useMemo(() => allItems(), []);
  const byCat = useMemo(() => {
    const map = new Map<string, RegistryItem[]>();
    for (const it of items) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    return map;
  }, [items]);
  const recentItems = prefs.recents.map((id) => byId(id)).filter(Boolean) as RegistryItem[];
  const starredItems = prefs.starred.map((id) => byId(id)).filter(Boolean) as RegistryItem[];
  const comps = comparatorsAllowed(state);
  const leftIsText = comps.some((c) => c.applies === "text");
  const topFrame = state.stack[state.stack.length - 1];

  const itemRow = (item: RegistryItem, key?: string) => (
    <CommandItem
      key={key ?? item.id}
      value={`${item.label} ${CATEGORY_LABELS[item.category]} ${item.hint ?? ""} ${item.id}`}
      onSelect={() => pickItem(item)}
      className="gap-2"
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="text-[13px] font-medium">{item.label}</span>
        {item.hint && <span className="ml-2 text-[11px] text-muted-foreground">{item.hint}</span>}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">{item.tier}</span>
      <button
        type="button"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          prefs.toggleStar(item.id);
        }}
        className="px-0.5"
        aria-label={prefs.starred.includes(item.id) ? "Unstar" : "Star"}
      >
        <Star size={13} className={prefs.starred.includes(item.id) ? "fill-amber-400 text-amber-500" : "text-muted-foreground/40"} />
      </button>
    </CommandItem>
  );

  const operandPicker = (
    <Command loop shouldFilter={info.paramType !== "number"}>
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={cursorHint(state)}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && query === "") {
            e.preventDefault();
            dispatch({ a: "removeLast" });
          } else if (e.key === "Tab") {
            e.preventDefault();
            if (topFrame?.kind === "fn") dispatch({ a: "nextParam" });
          } else if (e.key === "Escape") {
            resetInternal();
          }
        }}
      />
      <CommandList className="max-h-[320px]">
        <CommandEmpty>Nothing matches “{query}” — try an indicator name, or pick Number.</CommandEmpty>

        {info.paramType === "number" ? (
          <CommandGroup heading={`Number — ${info.fnParamName ?? "value"}`}>
            <CommandItem value="type a number" onSelect={() => setMode("number")}>
              <Hash className="mr-2 size-3.5 text-muted-foreground" />
              <span>
                Type a value for <b>{info.fnParamName}</b>
                <span className="ml-2 text-[11px] text-muted-foreground">whole number</span>
              </span>
            </CommandItem>
          </CommandGroup>
        ) : (
          <>
            {recentItems.length > 0 && (
              <CommandGroup heading="Recent">
                {recentItems.map((it) => itemRow(it, `recent-${it.id}`))}
              </CommandGroup>
            )}
            {starredItems.length > 0 && (
              <CommandGroup heading="Starred">
                {starredItems.map((it) => itemRow(it, `star-${it.id}`))}
              </CommandGroup>
            )}
            <CommandGroup heading="Quick">
              <CommandItem value="number literal" onSelect={() => setMode("number")}>
                <Hash className="mr-2 size-3.5 text-muted-foreground" />
                <span>
                  Number…<span className="ml-2 text-[11px] text-muted-foreground">500 · 3cr · 50L · 1.5k</span>
                </span>
              </CommandItem>
              {state.phase === "right" && leftIsText && (
                <CommandItem value="text value" onSelect={() => setMode("text")}>
                  <Type className="mr-2 size-3.5 text-muted-foreground" />
                  <span>Text value…</span>
                </CommandItem>
              )}
              <CommandItem
                value="bracket"
                onSelect={() => {
                  dispatch({ a: "openBracket" });
                  resetInternal();
                }}
              >
                <Braces className="mr-2 size-3.5 text-muted-foreground" />
                <span>
                  Bracket ( … )<span className="ml-2 text-[11px] text-muted-foreground">group part of the expression</span>
                </span>
              </CommandItem>
              {topFrame?.kind === "fn" && (
                <CommandItem
                  value="next parameter"
                  onSelect={() => {
                    dispatch({ a: "nextParam" });
                    resetInternal();
                  }}
                >
                  <ArrowRight className="mr-2 size-3.5 text-muted-foreground" />
                  <span>
                    Next parameter →<span className="ml-2 text-[11px] text-muted-foreground">Tab works too</span>
                  </span>
                </CommandItem>
              )}
              {topFrame?.kind === "fn" && (
                <CommandItem
                  value="remove function"
                  onSelect={() => {
                    dispatch({ a: "removeFrame" });
                    resetInternal();
                  }}
                >
                  <X className="mr-2 size-3.5 text-destructive" />
                  <span className="text-destructive">Remove {info.fnName}</span>
                </CommandItem>
              )}
              {onInsertGroup && state.phase === "left" && state.stack.length === 0 && state.left.length === 0 && (
                <CommandItem
                  value="sub-filter group"
                  onSelect={() => {
                    onInsertGroup();
                    setOpen(false);
                    resetInternal();
                  }}
                >
                  <ListPlus className="mr-2 size-3.5 text-muted-foreground" />
                  <span>
                    Sub-filter / Group…<span className="ml-2 text-[11px] text-muted-foreground">nested all / any N / none</span>
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
            {CATEGORY_ORDER.map((cat) => {
              const arr = byCat.get(cat);
              if (!arr?.length) return null;
              const visible = info.fnName ? arr.filter((it) => it.kind !== "text") : arr;
              if (!visible.length) return null;
              return (
                <CommandGroup key={cat} heading={CATEGORY_LABELS[cat]}>
                  {visible.map((it) => itemRow(it))}
                </CommandGroup>
              );
            })}
          </>
        )}
      </CommandList>
    </Command>
  );

  const continuePicker = (
    <Command loop>
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={cursorHint(state)}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && query === "") {
            e.preventDefault();
            dispatch({ a: "removeLast" });
          } else if (e.key === "Tab") {
            e.preventDefault();
            if (topFrame?.kind === "fn") dispatch({ a: "nextParam" });
            else if (state.phase === "right" && state.expect === "continue") dispatch({ a: "finish" });
          } else if (e.key === "Escape") {
            resetInternal();
          }
        }}
      />
      <CommandList className="max-h-[300px]">
        <CommandEmpty>No match — Esc to cancel.</CommandEmpty>
        {(info.insideBracket || info.fnName) && (
          <CommandGroup heading="This expression">
            {info.insideBracket && (
              <CommandItem
                value="close bracket"
                onSelect={() => {
                  dispatch({ a: "closeBracket" });
                  resetInternal();
                }}
              >
                <span className="font-semibold">) Close bracket</span>
              </CommandItem>
            )}
            {info.fnName && (
              <CommandItem
                value="next parameter"
                onSelect={() => {
                  dispatch({ a: "nextParam" });
                  resetInternal();
                }}
              >
                <ArrowRight className="mr-2 size-3.5 text-muted-foreground" />
                <span>
                  Next parameter →<span className="ml-2 text-[11px] text-muted-foreground">{info.argIndex! + 1} of {info.argCount}</span>
                </span>
              </CommandItem>
            )}
          </CommandGroup>
        )}
        <CommandGroup heading="Math operators">
          {MATH_OPS.map((m) => (
            <CommandItem
              key={m.op}
              value={`${m.label} ${m.disp} ${m.op}`}
              onSelect={() => {
                dispatch({ a: "math", op: m.op });
                resetInternal();
              }}
            >
              <span className="w-6 text-center text-sm font-bold text-amber-600 dark:text-amber-400">{m.disp}</span>
              <span className="text-[13px]">{m.label}</span>
              {m.tier === "P1" && <span className="ml-1 text-[9px] uppercase text-muted-foreground/70">P1</span>}
            </CommandItem>
          ))}
        </CommandGroup>
        {state.phase === "left" && (
          <CommandGroup heading="Comparators">
            {comps.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.label} ${c.sym}`}
                onSelect={() => {
                  dispatch({ a: "comparator", cmp: c.id });
                  resetInternal();
                }}
              >
                <span className="w-10 text-center text-xs font-bold text-primary">{c.sym}</span>
                <span className="text-[13px]">{c.label}</span>
                {c.tier === "P1" && <span className="ml-1 text-[9px] uppercase text-muted-foreground/70">P1</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {state.phase === "right" && (
          <CommandGroup heading="Finish">
            <CommandItem
              value="done finish clause"
              onSelect={() => {
                dispatch({ a: "finish" });
                resetInternal();
                setOpen(false);
              }}
            >
              <Check className="mr-2 size-4 text-emerald-600" />
              <span className="text-[13px] font-semibold">Done — clause complete</span>
              <span className="ml-2 text-[11px] text-muted-foreground">Enter here, or Tab after an operand</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );

  const entryMode = (
    <div className="space-y-1.5 p-2">
      <Input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitVal();
          } else if (e.key === "Escape") {
            setMode("picker");
            setVal("");
          }
        }}
        placeholder={mode === "number" ? "e.g. 500 · 3cr · 50L · 1.5k" : "e.g. FMCG"}
        className="h-8 text-sm"
        inputMode={mode === "number" ? "decimal" : "text"}
      />
      <p className="text-[11px] text-muted-foreground">
        {mode === "number"
          ? info.paramType === "number"
            ? "Whole number — unit suffixes not valid for parameters"
            : "Accepts 3cr / 50L / 1.5k · Enter to commit · Esc to go back"
          : "Text value for the right side · Enter to commit"}
      </p>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetInternal();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={done}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs transition-colors",
            done
              ? "border-emerald-500/50 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
              : "border-muted-foreground/40 text-muted-foreground hover:border-primary/60 hover:bg-primary/5 hover:text-foreground",
            state.expect === "continue" && !done && "border-solid",
          )}
        >
          {done ? (
            <>
              <Check className="size-3.5" /> Clause complete
            </>
          ) : (
            <>
              <Plus className="size-3.5" /> {cursorHint(state)}
              <ChevronDown className="size-3.5 opacity-60" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        {mode !== "picker" ? entryMode : state.expect === "operand" ? operandPicker : continuePicker}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- full clause line

export function DraftSentence({
  state,
  dispatch,
  prefs,
  onInsertGroup,
  className,
}: {
  state: SMState;
  dispatch: (a: SMAction) => void;
  prefs: RegistryPrefs;
  onInsertGroup?: () => void;
  className?: string;
}) {
  const cursorArr = state.phase === "done" ? null : curExpr(state);
  const warn = unitWarning(state);
  const fin = canFinish(state);
  const baseCtx = { state, dispatch, prefs, cursorArr, onInsertGroup };
  return (
    <div className={cn("rounded-xl border bg-card p-3 shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <ExprChips expr={state.left} ctx={{ ...baseCtx, side: "left" }} path={[]} />
        {state.cmp && state.phase !== "left" && (
          <span
            className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
            title={COMPARATOR_BY_ID[state.cmp]?.label}
          >
            {comparatorLabel(state.cmp)}
          </span>
        )}
        {state.phase !== "left" && (
          <ExprChips expr={state.right} ctx={{ ...baseCtx, side: "right" }} path={[]} />
        )}
        {(state.phase === "right2" || state.right2.length > 0) && (
          <>
            <span className="px-0.5 text-xs text-muted-foreground">and</span>
            <ExprChips expr={state.right2} ctx={{ ...baseCtx, side: "right2" }} path={[]} />
          </>
        )}
        {state.pct != null && (
          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            ±{state.pct}%
          </span>
        )}
      </div>
      {state.error && <p className="mt-2 text-xs font-medium text-destructive">{state.error}</p>}
      {!state.error && warn && <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-500">⚠ {warn}</p>}
      {state.phase === "done" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-emerald-600" />
          <span className="italic">{clauseSentence({ ...state, cmp: state.cmp ?? "gt" })}</span>
          {fin.ok && <span className="ml-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">valid</span>}
        </p>
      )}
      {state.phase !== "done" && !fin.ok && state.phase !== "left" && (
        <p className="mt-2 text-[11px] text-muted-foreground/80">Run would be blocked: {fin.reason}</p>
      )}
    </div>
  );
}
