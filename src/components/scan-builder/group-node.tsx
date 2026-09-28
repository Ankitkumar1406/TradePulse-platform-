"use client";

/**
 * Scan builder — group node (recursive).
 *
 * A group renders its mode (Match ALL / ANY N / NONE of), then its children
 * — clauses and nested groups — and the two add buttons ("Condition" /
 * "Sub-filter"). Children reorder within the group through dnd-kit; nested
 * groups carry their own mode chip and + buttons.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, GripVertical, Layers, MessageSquare, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Clause, Group } from "@/lib/scan/expr-model";
import { countEnabledClauses, type ScanAction, type ScanPath } from "@/lib/scan/scan-reducer";
import type { RegistryPrefs } from "./slot-input";
import { ClauseNode } from "./clause-node";
import { useDragWiring } from "./drag-ctx";

const MODE_LABEL: Record<Group["mode"], string> = { all: "ALL of", any: "ANY of", none: "NONE of" };

function ModeSelector({
  group,
  path,
  treeDispatch,
}: {
  group: Group;
  path: ScanPath;
  treeDispatch: (a: ScanAction) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <div className="flex items-center gap-0.5 rounded-md border bg-background p-0.5">
        {(["all", "any", "none"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => treeDispatch({ a: "setMode", path, mode: m })}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10.5px] font-semibold transition-colors",
              group.mode === m
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={
              m === "all"
                ? "Match every condition below"
                : m === "any"
                  ? "Match at least N of the conditions below"
                  : "Match none of the conditions below"
            }
          >
            {m === "all" ? "ALL" : m === "any" ? "ANY" : "NONE"}
          </button>
        ))}
      </div>
      {group.mode === "any" && (
        <label className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
          at least
          <select
            value={String(group.anyCount ?? 1)}
            onChange={(e) => treeDispatch({ a: "setAnyCount", path, n: +e.target.value })}
            className="h-6 rounded border bg-background px-1 text-[11px] font-semibold text-foreground"
            aria-label="How many conditions must match"
          >
            {Array.from({ length: Math.max(1, group.children.filter((c) => c.enabled).length) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function GroupActions({
  group,
  path,
  treeDispatch,
}: {
  group: Group;
  path: ScanPath;
  treeDispatch: (a: ScanAction) => void;
}) {
  const [commentOpen, setCommentOpen] = useState(false);
  const btn = "rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground";
  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/group:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        onClick={() => treeDispatch({ a: "setCollapsed", path, collapsed: !group.collapsed })}
        title={group.collapsed ? "Expand group" : "Collapse group"}
        className={cn(btn, "md:hidden")}
      >
        {group.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => treeDispatch({ a: "toggleEnabled", path })}
        title={group.enabled ? "Disable the whole group" : "Enable the whole group"}
        className={btn}
      >
        {group.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => treeDispatch({ a: "duplicateNode", path })}
        title="Duplicate group"
        className={btn}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => treeDispatch({ a: "setComment", path, comment: group.comment ? null : " " })}
        title="Comment"
        className={cn(btn, group.comment && "text-primary")}
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => treeDispatch({ a: "removeNode", path })}
        title="Delete group"
        className={cn(btn, "hover:bg-destructive/10 hover:text-destructive")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function GroupNode({
  group,
  path,
  treeDispatch,
  prefs,
  onDebug,
  isRoot = false,
}: {
  group: Group;
  path: ScanPath;
  treeDispatch: (a: ScanAction) => void;
  prefs: RegistryPrefs;
  onDebug: (clause: Clause) => void;
  isRoot?: boolean;
}) {
  const drag = useDragWiring();
  const active = group.children.filter((c) => c.enabled);
  const enabledCount = countEnabledClauses(group);

  const body = (
    <div className="space-y-1.5">
      {group.children.map((child, i) =>
        child.kind === "group" ? (
          <GroupNode
            key={child.id}
            group={child}
            path={[...path, i]}
            treeDispatch={treeDispatch}
            prefs={prefs}
            onDebug={onDebug}
          />
        ) : (
          <ClauseNode
            key={child.id}
            clause={child}
            path={[...path, i]}
            treeDispatch={treeDispatch}
            prefs={prefs}
            onDebug={onDebug}
          />
        ),
      )}
    </div>
  );

  const addButtons = group.enabled && (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      <button
        type="button"
        onClick={() => treeDispatch({ a: "addClause", parentPath: path })}
        className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        <Plus className="h-3 w-3" /> Condition
      </button>
      <button
        type="button"
        onClick={() => treeDispatch({ a: "addGroup", parentPath: path })}
        className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        <Layers className="h-3 w-3" /> Sub-filter
      </button>
    </div>
  );

  // ---- root: no card chrome, just the controls + children
  if (isRoot) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ModeSelector group={group} path={path} treeDispatch={treeDispatch} />
          <span className="text-[11px] text-muted-foreground">
            {group.mode === "all" && "a stock must satisfy every enabled condition"}
            {group.mode === "any" && `a stock must satisfy at least ${group.anyCount ?? 1} of ${active.length} conditions`}
            {group.mode === "none" && "a stock must satisfy none of these conditions"}
          </span>
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground/70">
            {enabledCount} condition{enabledCount === 1 ? "" : "s"}
          </span>
        </div>
        {group.children.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm font-medium">Build your first condition</p>
            <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
              One input, one clause at a time — pick an indicator, a comparator, then a number or another indicator.
            </p>
            {addButtons}
          </div>
        ) : (
          <>
            {body}
            {addButtons}
          </>
        )}
      </div>
    );
  }

  // ---- nested group: bordered card with its own header
  return (
    <div
      draggable
      onDragStart={() => drag.onDragStart(group.id)}
      onDragOver={(e) => { e.preventDefault(); drag.onDragOver(group.id); }}
      onDrop={(e) => { e.preventDefault(); drag.onDrop(group.id); }}
      onDragEnd={drag.onDragEnd}
      className={cn(
        "group/group rounded-xl border-l-4 border-y border-r bg-muted/30 px-2.5 py-2 transition-colors hover:border-y-primary/30 hover:border-r-primary/30",
        drag.dragOverId === group.id && "border-y-primary/60 border-r-primary/60 bg-primary/[0.03]",
        group.mode === "any" && "border-l-amber-500/60",
        group.mode === "none" && "border-l-rose-500/60",
        group.mode === "all" && "border-l-primary/50",
        !group.enabled && "opacity-50",
        group.collapsed && "py-1.5",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span aria-hidden className="cursor-grab rounded p-0.5 text-muted-foreground/50 hover:text-foreground">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <ModeSelector group={group} path={path} treeDispatch={treeDispatch} />
        {group.comment && <span className="text-[10.5px] italic text-muted-foreground/80">※ {group.comment}</span>}
        <div className="ml-auto flex items-center gap-1">
          <GroupActions group={group} path={path} treeDispatch={treeDispatch} />
        </div>
      </div>
      {!group.collapsed && (
        <>
          {body}
          {addButtons}
        </>
      )}
    </div>
  );
}
