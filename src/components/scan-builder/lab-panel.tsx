"use client";

/**
 * Builder Lab — REVIEW HARNESS for Deliverables 1–2 (registry + SlotInput
 * state machine). Deliberately separate from the Screener tab so the shipped
 * v2 builder stays untouched until the new flow is approved (step 3 wires it
 * into ScanBuilder / ClauseNode / GroupNode).
 *
 * Includes scripted demos that replay the acceptance-test clauses through the
 * exact same action list a user's clicks/keys would produce.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RotateCcw } from "lucide-react";
import { REGISTRY_ITEMS } from "@/lib/scan/registry-items";
import { CATEGORY_LABELS, CATEGORY_ORDER, byId } from "@/lib/scan/registry";
import {
  applyActions,
  initMachine,
  reduceMachine,
  slotInfo,
  type SMAction,
  type SMState,
} from "@/lib/scan/slot-machine";
import { DraftSentence, useRegistryPrefs } from "@/components/scan-builder/slot-input";

type Item = ReturnType<typeof byId>;

const item = (id: string): NonNullable<Item> => {
  const it = byId(id);
  if (!it) throw new Error(`registry missing ${id}`);
  return it;
};

// ---------------------------------------------------------------- scripted demos

const DEMO_SIMPLE: SMAction[] = [
  { a: "pick", item: item("mcap") },
  { a: "comparator", cmp: "gt" },
  { a: "number", raw: "3cr" },
  { a: "finish" },
];

const DEMO_MATH_RIGHT: SMAction[] = [
  { a: "pick", item: item("volume") },
  { a: "comparator", cmp: "gt" },
  { a: "pick", item: item("sma") }, // Sma(Close, 20) — arg0 pre-filled with Close
  { a: "removeLast" }, // clear Close
  { a: "pick", item: item("volume") }, // Sma(Volume, 20)
  { a: "nextParam" }, // → period slot (20)
  { a: "nextParam" }, // fn complete
  { a: "math", op: "*" },
  { a: "number", raw: "0.75" },
  { a: "finish" },
];

const DEMO_RANGE: SMAction[] = [
  // ( Max(7, 1 day ago High) − Min(7, 1 day ago Low) ) / Min(7, 1 day ago Low) × 100 < 12
  { a: "openBracket" },
  { a: "pick", item: item("winMax") },
  { a: "nextParam" }, // → x slot (Low)
  { a: "removeLast" },
  { a: "pick", item: item("high") },
  { a: "patchTerm", side: "left", path: [{ i: 0 }, { i: 0, arg: 1 }, { i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "nextParam" }, // Max done → still inside the bracket
  { a: "math", op: "-" }, // − Min stays INSIDE the brackets
  { a: "pick", item: item("winMin") },
  { a: "nextParam" },
  { a: "removeLast" },
  { a: "pick", item: item("low") },
  { a: "patchTerm", side: "left", path: [{ i: 0 }, { i: 2, arg: 1 }, { i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "nextParam" },
  { a: "closeBracket" }, // ( Max − Min ) complete
  { a: "math", op: "/" },
  { a: "pick", item: item("winMin") },
  { a: "nextParam" },
  { a: "removeLast" },
  { a: "pick", item: item("low") },
  { a: "patchTerm", side: "left", path: [{ i: 2, arg: 1 }, { i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "nextParam" },
  { a: "math", op: "*" },
  { a: "number", raw: "100" },
  { a: "comparator", cmp: "lt" },
  { a: "number", raw: "12" },
  { a: "finish" },
];

const DEMO_NESTED: SMAction[] = [
  // 1 day ago ATR(14) < 1 day ago Sma(ATR(14), 20) — nested fn param + fn-level offset
  { a: "pick", item: item("atr") },
  { a: "nextParam" },
  { a: "patchTerm", side: "left", path: [{ i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "comparator", cmp: "lt" },
  { a: "pick", item: item("sma") },
  { a: "removeLast" }, // drop Close source
  { a: "pick", item: item("atr") }, // nested function as a parameter
  { a: "nextParam" }, // ATR(14) done → back in Sma source slot
  { a: "nextParam" }, // → period 20
  { a: "nextParam" }, // Sma done
  { a: "patchTerm", side: "right", path: [{ i: 0 }], patch: { offset: { n: 1, unit: "day" } } },
  { a: "finish" },
];

const DEMO_UNIT_WARN: SMAction[] = [
  { a: "pick", item: item("close") },
  { a: "comparator", cmp: "gt" },
  { a: "pick", item: item("changePct") }, // Rs vs % → amber warning
];

const DEMOS: { label: string; actions: SMAction[]; note: string }[] = [
  { label: "Fundamental + 3cr", actions: DEMO_SIMPLE, note: "Market cap > 3cr — unit shortcut, fundamentals period chip" },
  { label: "Math on right", actions: DEMO_MATH_RIGHT, note: "Volume > Sma(Volume, 20) × 0.75 — fn param overwrite + math loop" },
  { label: "Range % (brackets)", actions: DEMO_RANGE, note: "acceptance clause — brackets, window fns, 1-day-ago offsets on params" },
  { label: "Nested fn + offset", actions: DEMO_NESTED, note: "1 day ago ATR(14) < 1 day ago Sma(ATR(14), 20) — fn inside param" },
  { label: "Unit warning", actions: DEMO_UNIT_WARN, note: "Close (₹) vs Change % — amber unit-mismatch warning" },
];

// ---------------------------------------------------------------- panel

export default function LabPanel() {
  const [state, dispatchRaw] = useState<SMState>(initMachine);
  const prefs = useRegistryPrefs();
  const [lastDemo, setLastDemo] = useState<string | null>(null);

  const dispatch = (a: SMAction) => dispatchRaw((s) => reduceMachine(s, a));

  const runDemo = (label: string, actions: SMAction[]) => {
    setLastDemo(label);
    dispatchRaw((s) => applyActions(s, actions));
  };

  const info = slotInfo(state);
  const stats = useMemo(() => {
    const byTier = { P0: 0, P1: 0, P2: 0 } as Record<string, number>;
    const byCat = new Map<string, number>();
    for (const it of REGISTRY_ITEMS) {
      byTier[it.tier] = (byTier[it.tier] ?? 0) + 1;
      byCat.set(it.category, (byCat.get(it.category) ?? 0) + 1);
    }
    return { total: REGISTRY_ITEMS.length, byTier, byCat };
  }, []);

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">Condition Builder — Lab</h1>
            <Badge variant="outline">Deliverable 1: Registry</Badge>
            <Badge variant="outline">Deliverable 2: SlotInput state machine</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Review harness for the single-input, sentence-style builder. Type to search, Enter commits,
            Tab moves to the next parameter, Backspace on an empty input removes the last token, Esc cancels.
            Click any <span className="font-medium text-foreground">Daily · Latest</span> prefix to edit
            timeframe/offset without blocking the flow.
          </p>
        </header>

        <DraftSentence
          state={state}
          dispatch={dispatch}
          prefs={prefs}
          onInsertGroup={() => setLastDemo("group insert requested (wired in step 3)")}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => dispatchRaw(initMachine())}>
            <RotateCcw className="mr-1.5 size-3.5" /> Reset
          </Button>
          <span className="font-mono text-[11px] text-muted-foreground">
            phase={state.phase} · expect={state.expect} · depth={state.stack.length} · cmp={state.cmp ?? "—"}
            {info.fnName ? ` · in ${info.fnName}#${(info.argIndex ?? 0) + 1}/${info.argCount}` : ""}
          </span>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Scripted demos (replay real action sequences)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {DEMOS.map((d) => (
              <div key={d.label} className="flex items-center gap-3">
                <Button size="sm" variant={lastDemo === d.label ? "default" : "secondary"} className="w-44 shrink-0" onClick={() => runDemo(d.label, d.actions)}>
                  {d.label}
                </Button>
                <span className="text-xs text-muted-foreground">{d.note}</span>
              </div>
            ))}
            {lastDemo && (
              <p className="pt-1 text-[11px] text-muted-foreground/80">
                last script: <b>{lastDemo}</b> — press Reset, then try the same flow by hand through the input.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Registry — {stats.total} items ({stats.byTier.P0} P0 · {stats.byTier.P1} P1 · {stats.byTier.P2 ?? 0} P2)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_ORDER.map((cat) => {
                const n = stats.byCat.get(cat) ?? 0;
                if (!n) return null;
                return (
                  <Badge key={cat} variant="secondary" className="font-normal">
                    {CATEGORY_LABELS[cat]} <span className="ml-1 font-semibold tabular-nums">{n}</span>
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
