/**
 * Scan builder — scan-tree reducer.
 *
 * The scan is an immutable tree; nodes are addressed by a path of child
 * indexes (e.g. [1, 0, 2] = root.children[1].children[0].children[2]).
 * Updates clone through structuredClone (the trees are small JSON) so undo
 * history stays trivially cheap to add later.
 */
import type { Clause, Group, Scan } from "./expr-model";
import { newClause, newGroup, uid } from "./expr-model";

export type ScanPath = number[];

export function nodeAt(scan: Scan, path: ScanPath): Clause | Group | null {
  let cur: Clause | Group = scan.root;
  for (const idx of path) {
    if (cur.kind !== "group") return null;
    const next = cur.children[idx];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

function parentOf(scan: Scan, path: ScanPath): Group | null {
  if (path.length === 0) return null;
  const parent = nodeAt(scan, path.slice(0, -1));
  return parent && parent.kind === "group" ? parent : null;
}

function reassignIds(node: Clause | Group): Clause | Group {
  if (node.kind === "clause") return { ...node, id: uid("c") };
  return { ...node, id: uid("g"), children: node.children.map(reassignIds) };
}

export type ScanAction =
  | { a: "load"; scan: Scan }
  | { a: "addClause"; parentPath: ScanPath; clause?: Clause }
  | { a: "addGroup"; parentPath: ScanPath }
  | { a: "updateClause"; path: ScanPath; clause: Clause }
  | { a: "removeNode"; path: ScanPath }
  | { a: "duplicateNode"; path: ScanPath }
  | { a: "toggleEnabled"; path: ScanPath }
  | { a: "setMode"; path: ScanPath; mode: Group["mode"] }
  | { a: "setAnyCount"; path: ScanPath; n: number }
  | { a: "setComment"; path: ScanPath; comment: string | null }
  | { a: "setCollapsed"; path: ScanPath; collapsed: boolean }
  | { a: "moveNode"; fromPath: ScanPath; toIndex: number };

export interface ScanUI {
  scan: Scan;
  /** informational only — reducer output is a fresh state object */
  rev: number;
}

export function initScanUI(scan?: Scan): ScanUI {
  return { scan: scan ?? { segment: "cash", root: newGroup("all") }, rev: 0 };
}

export function reduceScan(state: ScanUI, action: ScanAction): ScanUI {
  const scan: Scan = structuredClone(state.scan);
  const bump = (next: Scan): ScanUI => ({ scan: next, rev: state.rev + 1 });

  switch (action.a) {
    case "load":
      return bump(action.scan);

    case "addClause": {
      const parent = nodeAt(scan, action.parentPath);
      if (!parent || parent.kind !== "group") return state;
      if (parent.children.length >= 50) return state;
      parent.children.push(action.clause ?? newClause());
      return bump(scan);
    }

    case "addGroup": {
      const parent = nodeAt(scan, action.parentPath);
      if (!parent || parent.kind !== "group") return state;
      if (parent.children.length >= 50) return state;
      parent.children.push(newGroup("any", [newClause()]));
      return bump(scan);
    }

    case "updateClause": {
      const node = nodeAt(scan, action.path);
      if (!node || node.kind !== "clause") return state;
      const parent = parentOf(scan, action.path);
      if (!parent) return state;
      parent.children[action.path[action.path.length - 1]] = action.clause;
      return bump(scan);
    }

    case "removeNode": {
      const parent = parentOf(scan, action.path);
      if (!parent) {
        // removing the only child of root is allowed; root itself stays
        return state;
      }
      parent.children.splice(action.path[action.path.length - 1], 1);
      return bump(scan);
    }

    case "duplicateNode": {
      const node = nodeAt(scan, action.path);
      const parent = parentOf(scan, action.path);
      if (!node || !parent) return state;
      if (parent.children.length >= 50) return state;
      parent.children.splice(action.path[action.path.length - 1] + 1, 0, reassignIds(node));
      return bump(scan);
    }

    case "toggleEnabled": {
      const node = nodeAt(scan, action.path);
      if (!node) return state;
      node.enabled = !node.enabled;
      return bump(scan);
    }

    case "setMode": {
      const node = nodeAt(scan, action.path);
      if (!node || node.kind !== "group") return state;
      node.mode = action.mode;
      if (action.mode === "any" && node.anyCount == null) node.anyCount = 1;
      return bump(scan);
    }

    case "setAnyCount": {
      const node = nodeAt(scan, action.path);
      if (!node || node.kind !== "group") return state;
      node.anyCount = Math.max(1, Math.min(action.n, Math.max(1, node.children.length)));
      return bump(scan);
    }

    case "setComment": {
      const node = nodeAt(scan, action.path);
      if (!node) return state;
      if (action.comment == null || !action.comment.trim()) delete node.comment;
      else node.comment = action.comment.trim();
      return bump(scan);
    }

    case "setCollapsed": {
      const node = nodeAt(scan, action.path);
      if (!node || node.kind !== "group") return state;
      if (action.collapsed) node.collapsed = true;
      else delete node.collapsed;
      return bump(scan);
    }

    case "moveNode": {
      const parent = parentOf(scan, action.fromPath);
      if (!parent) return state;
      const from = action.fromPath[action.fromPath.length - 1];
      const [moved] = parent.children.splice(from, 1);
      const to = Math.max(0, Math.min(action.toIndex, parent.children.length));
      parent.children.splice(to, 0, moved);
      return bump(scan);
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------- completeness

/** True when every enabled clause is fully built (both sides complete). */
export function scanComplete(scan: Scan): boolean {
  const walk = (g: Group): boolean => {
    for (const c of g.children) {
      if (c.kind === "group") {
        if (c.enabled && !walk(c)) return false;
      } else if (c.enabled) {
        if (!c.left.length || !c.right.length) return false;
        if (c.left[c.left.length - 1].t === "op") return false;
        if (c.right[c.right.length - 1].t === "op") return false;
        if (c.cmp === "between" && (!c.right2 || !c.right2.length || c.right2[c.right2.length - 1].t === "op")) return false;
      }
    }
    return true;
  };
  return walk(scan.root);
}

export function countEnabledClauses(tree: Scan | Group): number {
  let count = 0;
  const walk = (g: Group): void => {
    for (const c of g.children) {
      if (c.kind === "group") walk(c);
      else if (c.enabled) count++;
    }
  };
  const root = (tree as Scan).root ?? (tree as Group);
  walk(root);
  return count;
}
