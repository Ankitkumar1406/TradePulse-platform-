"use client";

/**
 * Scan builder — one clause row.
 *
 * A clause renders as a sentence of token chips. Fresh clauses (added via
 * "+ Condition") open straight into the editor — the SlotInput state machine
 * drives the sentence; ✓ commits it back into the scan tree, ✕ reverts.
 * Row actions live in a dropdown: edit, duplicate, comment, debug, delete,
 * plus an enable/disable toggle and the drag handle (wired by GroupNode).
 */
import { useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  MessageSquare,
  Pencil,
  Trash2,
  X,
  Bug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Clause } from "@/lib/scan/expr-model";
import {
  applyActions,
  canFinish,
  initMachine,
  reduceMachine,
  slotInfo,
  type SMAction,
  type SMState,
} from "@/lib/scan/slot-machine";
import { clauseSentence } from "@/lib/scan/expr-display";
import { COMPARATOR_BY_ID } from "@/lib/scan/registry";
import { DraftSentence, ExprChips, useRegistryPrefs, type ChipCtx } from "./slot-input";
import { useDragWiring } from "./drag-ctx";
import type { ScanPath, ScanAction } from "@/lib/scan/scan-reducer";
import type { RegistryPrefs } from "./slot-input";

function machineFromClause(c: Clause): SMState {
  if (c.left.length === 0 && c.right.length === 0) return initMachine(); // fresh: start at the picker
  const s = initMachine();
  const seeded: SMState = {
    ...s,
    phase: "done",
    cmp: c.cmp,
    left: structuredClone(c.left),
    right: structuredClone(c.right),
    right2: structuredClone(c.right2 ?? []),
    pct: c.pct ?? null,
    expect: "continue",
  };
  return seeded;
}

const isFresh = (c: Clause) => c.left.length === 0 && c.right.length === 0;

export function ClauseNode({
  clause,
  path,
  treeDispatch,
  prefs,
  onDebug,
}: {
  clause: Clause;
  path: ScanPath;
  treeDispatch: (a: ScanAction) => void;
  prefs: RegistryPrefs;
  onDebug: (clause: Clause) => void;
}) {
  const drag = useDragWiring();
  const [editing, setEditing] = useState(isFresh(clause));
  const [state, setState] = useState<SMState>(() => machineFromClause(clause));
  const [commentOpen, setCommentOpen] = useState(false);

  const startEdit = () => {
    setState(machineFromClause(clause));
    setEditing(true);
  };
  const cancelEdit = () => {
    if (isFresh(clause)) {
      treeDispatch({ a: "removeNode", path });
    } else {
      setEditing(false);
    }
  };
  const commitEdit = () => {
    const fin = canFinish(state);
    if (!fin.ok || state.phase !== "done" || !state.cmp) return;
    const next: Clause = {
      ...clause,
      left: state.left,
      cmp: state.cmp,
      right: state.right,
      ...(state.right2.length ? { right2: state.right2 } : { right2: undefined }),
      ...(state.pct != null ? { pct: state.pct } : { pct: undefined }),
    };
    treeDispatch({ a: "updateClause", path, clause: next });
    setEditing(false);
  };

  const dispatch = (a: SMAction) => setState((s) => reduceMachine(s, a));

  // view-mode chip context — chips route clicks back into edit mode
  const ctx: ChipCtx = {
    side: "left",
    dispatch: () => startEdit(),
    state: initMachine(),
    prefs,
    cursorArr: null,
  };

  if (editing) {
    const fin = canFinish(state);
    const done = state.phase === "done";
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/[0.04] p-2 shadow-sm">
        <DraftSentence state={state} dispatch={dispatch} prefs={prefs} />
        <div className="mt-2 flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 bg-brand px-3 text-xs text-white hover:bg-brand-hover"
            disabled={!fin.ok || !done}
            onClick={commitEdit}
            title={fin.reason ?? "Commit this condition"}
          >
            <Check className="mr-1 h-3.5 w-3.5" /> {isFresh(clause) ? "Add condition" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={cancelEdit}>
            <X className="mr-1 h-3.5 w-3.5" /> Cancel
          </Button>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
            Enter commit · Tab next slot · Esc cancel · ⌫ undo token
          </span>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ view mode

  return (
    <div
      draggable
      onDragStart={() => drag.onDragStart(clause.id)}
      onDragOver={(e) => { e.preventDefault(); drag.onDragOver(clause.id); }}
      onDrop={(e) => { e.preventDefault(); drag.onDrop(clause.id); }}
      onDragEnd={drag.onDragEnd}
      className={cn(
        "group/clause flex items-start gap-1.5 rounded-lg border bg-card px-2 py-1.5 shadow-sm transition-colors hover:border-primary/30",
        drag.dragOverId === clause.id && "border-primary/60 bg-primary/[0.04]",
        !clause.enabled && "opacity-50",
      )}
    >
      <span aria-hidden className="mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover/clause:opacity-100">
        <GripVertical className="h-3.5 w-3.5" />
      </span>

      <button
        type="button"
        onClick={() => treeDispatch({ a: "toggleEnabled", path })}
        title={clause.enabled ? "Disable this condition (kept in the scan)" : "Enable this condition"}
        className="mt-0.5 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
      >
        {clause.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>

      <div className="min-w-0 flex-1">
        {clause.comment && (
          <p className="mb-0.5 text-[10.5px] italic text-muted-foreground/80">※ {clause.comment}</p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <ExprChips expr={clause.left} ctx={ctx} path={[]} />
          <span
            className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
            title={COMPARATOR_BY_ID[clause.cmp]?.label}
          >
            {COMPARATOR_BY_ID[clause.cmp]?.sym ?? clause.cmp}
          </span>
          <ExprChips expr={clause.right} ctx={ctx} path={[]} />
          {clause.cmp === "between" && (
            <>
              <span className="px-0.5 text-xs text-muted-foreground">and</span>
              <ExprChips expr={clause.right2 ?? []} ctx={ctx} path={[]} />
            </>
          )}
          {clause.cmp === "withinPct" && clause.pct != null && (
            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              ±{clause.pct}%
            </span>
          )}
        </div>
      </div>

      {/* row actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/clause:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={startEdit} title="Edit this condition" className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => treeDispatch({ a: "duplicateNode", path })}
          title="Duplicate"
          className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <Popover open={commentOpen} onOpenChange={setCommentOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Note / comment"
              className={cn(
                "rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground",
                clause.comment && "text-primary",
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end">
            <Textarea
              autoFocus
              defaultValue={clause.comment ?? ""}
              placeholder="Why does this condition exist?"
              className="min-h-[60px] text-xs"
              onBlur={(e) => {
                treeDispatch({ a: "setComment", path, comment: e.target.value || null });
                setCommentOpen(false);
              }}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Saved when you click away</p>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={() => onDebug(clause)}
          title="Debug — computed values for sample stocks"
          className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <Bug className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => treeDispatch({ a: "removeNode", path })}
          title="Delete"
          className="rounded p-1 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Read-only one-line sentence (tooltips / summary rows). */
export function clauseTooltip(c: Clause): string {
  return clauseSentence({ ...c, right2: c.right2 ?? [], pct: c.pct });
}

export { applyActions, slotInfo };
