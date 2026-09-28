/**
 * Scan builder — SlotInput state machine (Deliverable 2).
 *
 * Pure reducer that implements the input flow schematic:
 *
 *   [LEFT OPERAND] ── math op ──▶ back to LEFT OPERAND
 *        │ comparator
 *        ▼
 *   [RIGHT OPERAND] ── math op ──▶ back to RIGHT OPERAND
 *        │ finish (Enter)
 *        ▼
 *   [CLAUSE DONE]
 *
 * The cursor always knows what it expects (`expect: operand | continue`),
 * functions open one Expr slot per parameter (recursing through the frame
 * stack), brackets push/pop frames, and comparators / finish auto-close any
 * open frames — the "auto-inserted closing bracket" rule. Timeframe/offset is
 * deliberately NOT part of the flow: operands are inserted with defaults and
 * edited later through the token popover (non-blocking).
 *
 * No eval, no strings compiled here — this only shapes tokens.
 */
import { parseNumWithUnits } from "@/lib/pro-expr";
import type { ComparatorId, Expr, FundPeriod, MathOp, Offset, Term, Timeframe } from "./expr-model";
import { exprComplete, isOp, isTerm } from "./expr-model";
import {
  byId,
  comparatorsFor,
  COMPARATORS,
  OFFSET_UNITS_BY_TF,
  termFromItem,
  unitsCompatible,
  type ComparatorDef,
  type RegistryItem,
} from "./registry";

export type Side = "left" | "right";

/**
 * Clause-level phase. `right2` = the upper bound of `between`;
 * `pct` = the % width of `within % of`.
 */
export type Phase = "left" | "right" | "right2" | "pct" | "done";

/** Open bracket / function-parameter the cursor is inside of. */
export interface Frame {
  kind: "bracket" | "fn";
  /** index of the bracket/fn term inside its parent expr */
  tokIndex: number;
  /** fn only — which parameter slot the cursor is in */
  argIndex?: number;
}

export interface SMState {
  phase: Phase;
  cmp: ComparatorId | null;
  left: Expr;
  right: Expr;
  right2: Expr;
  pct: number | null;
  stack: Frame[];
  /** what the cursor expects next */
  expect: "operand" | "continue";
  error: string | null;
}

export type SMAction =
  | { a: "pick"; item: RegistryItem; period?: FundPeriod }
  | { a: "number"; raw: string }
  | { a: "text"; value: string }
  | { a: "math"; op: MathOp }
  | { a: "comparator"; cmp: ComparatorId }
  | { a: "openBracket" }
  | { a: "closeBracket" }
  | { a: "nextParam" }
  | { a: "removeFrame" }
  | { a: "finish" }
  | { a: "removeLast" }
  | { a: "reset" }
  /** edit a committed token in place (timeframe popover, param editor) */
  | { a: "patchTerm"; side: PatchSide; path: PathStep[]; patch: TermPatch };

export type PatchSide = "left" | "right" | "right2";

/** Address of a token: token index within the current expr; `arg` descends into a fn parameter. */
export interface PathStep {
  i: number;
  arg?: number;
}

export interface TermPatch {
  tf?: Timeframe;
  offset?: Offset;
  period?: FundPeriod | null;
  value?: number;
}

export function initMachine(): SMState {
  return { phase: "left", cmp: null, left: [], right: [], right2: [], pct: null, stack: [], expect: "operand", error: null };
}

// ---------------------------------------------------------------- cursor plumbing

function sideOf(s: SMState): "left" | "right" | "right2" | "pct" {
  if (s.phase === "left") return "left";
  if (s.phase === "right" || s.phase === "pct") return "right";
  if (s.phase === "right2") return "right2";
  return "right"; // done — nothing active
}

/** The expr the cursor is currently filling (descends the frame stack). */
export function curExpr(s: SMState): Expr {
  let cur: Expr;
  if (s.phase === "left") cur = s.left;
  else if (s.phase === "right2") cur = s.right2;
  else cur = s.right;
  for (const f of s.stack) {
    const t = cur[f.tokIndex];
    if (!t || t.t === "op" || t.t === "number" || t.t === "text" || t.t === "saved" || t.t === "attr") break;
    cur = t.t === "bracket" ? t.inner : t.args[f.argIndex ?? 0];
  }
  return cur;
}

/** Expr addressed by a (possibly partial) stack — parent lookups need this. */
function exprByStack(s: SMState, stack: Frame[]): Expr {
  let cur: Expr = s.phase === "left" ? s.left : s.phase === "right2" ? s.right2 : s.right;
  for (const f of stack) {
    const t = cur[f.tokIndex];
    if (!t || t.t === "op" || t.t === "number" || t.t === "text" || t.t === "saved" || t.t === "attr") break;
    cur = t.t === "bracket" ? t.inner : t.args[f.argIndex ?? 0];
  }
  return cur;
}

function tailExpect(arr: Expr): SMState["expect"] {
  if (arr.length === 0) return "operand";
  return isOp(arr[arr.length - 1]) ? "operand" : "continue";
}

function err(s: SMState, msg: string): SMState {
  s.error = msg;
  return s;
}

/** Registry item of an operand term (attr / fn / flag / saved), if known. */
function itemOfTerm(t: Term): RegistryItem | undefined {
  if (t.t === "attr" || t.t === "fn") return byId(t.name);
  if (t.t === "saved") return byId(`saved:${t.id}`);
  return undefined;
}

/** Auto-close every open frame (comparator / finish leave brackets & fns). */
function autoClose(s: SMState) {
  s.stack = [];
}

// ---------------------------------------------------------------- reducer

export function reduceMachine(state: SMState, action: SMAction): SMState {
  const s: SMState = structuredClone(state);
  s.error = null;

  switch (action.a) {
    // ------------------------------------------------------------ operands
    case "pick": {
      const item = action.item;
      if (s.phase === "done") return err(s, "Clause is complete — reset to edit.");
      if (s.phase === "pct") return err(s, "Enter the % width as a number.");
      if (s.expect !== "operand") return err(s, "Pick a math operator or comparator first.");

      if (item.kind === "group") return err(s, "Groups are added from the clause list, not inside an expression.");
      if (item.kind === "number") return err(s, "Use the number pad for values.");
      if (item.kind === "bracket") return reduceMachine(state, { a: "openBracket" });

      const arr = curExpr(s);
      const tokIndex = arr.length;
      if (item.kind === "fn") {
        const term = termFromItem(item);
        if (term.t !== "fn") return err(s, "Registry misconfiguration for fn item.");
        arr.push(term);
        s.stack.push({ kind: "fn", tokIndex, argIndex: 0 });
        s.expect = term.args[0]?.length ? "continue" : "operand";
        return s;
      }
      // attr / flag / text / saved
      const term = termFromItem(item, action.period);
      arr.push(term);
      s.expect = "continue";
      return s;
    }

    case "number": {
      if (s.phase === "done") return err(s, "Clause is complete — reset to edit.");
      if (s.phase === "pct") {
        const v = parseNumWithUnits(action.raw);
        if (v == null || v <= 0) return err(s, "Enter a % width like 2 (meaning ±2%).");
        s.pct = v;
        s.phase = "done";
        return s;
      }
      if (s.expect !== "operand") return err(s, "Pick a math operator or comparator first.");
      const v = parseNumWithUnits(action.raw);
      if (v == null || !Number.isFinite(v)) return err(s, "Enter a number — 500, 3cr, 50L, 1.5k.");
      // fn number parameters carry registry constraints (int, min/max) — a
      // period like "3cr" is rejected here rather than at evaluation time.
      const p = paramAt(s);
      if (p) {
        if (p.int && !Number.isInteger(v)) return err(s, `${p.name} must be a whole number.`);
        if (p.min != null && v < p.min) return err(s, `${p.name} must be ≥ ${p.min}.`);
        if (p.max != null && v > p.max) return err(s, `${p.name} must be ≤ ${p.max}.`);
      }
      curExpr(s).push({ t: "number", value: v });
      s.expect = "continue";
      return s;
    }

    case "text": {
      if (s.phase === "done" || s.phase === "pct") return err(s, "Text values only apply to a clause side.");
      if (s.expect !== "operand") return err(s, "Pick a math operator or comparator first.");
      if (!action.value.trim()) return err(s, "Enter a value.");
      curExpr(s).push({ t: "text", value: action.value.trim() });
      s.expect = "continue";
      return s;
    }

    case "openBracket": {
      if (s.phase === "done" || s.phase === "pct") return err(s, "Brackets apply to a clause side.");
      if (s.expect !== "operand") return err(s, "An operand is already pending — commit it first.");
      const arr = curExpr(s);
      const tokIndex = arr.length;
      arr.push({ t: "bracket", inner: [] });
      s.stack.push({ kind: "bracket", tokIndex });
      s.expect = "operand";
      return s;
    }

    // ------------------------------------------------------------ continuing an expression
    case "math": {
      if (s.phase === "done" || s.phase === "pct") return err(s, "Math operators apply to a clause side.");
      if (s.expect !== "continue") return err(s, "Pick an operand first.");
      curExpr(s).push({ t: "op", op: action.op });
      s.expect = "operand";
      return s;
    }

    case "closeBracket": {
      const top = s.stack[s.stack.length - 1];
      if (!top || top.kind !== "bracket") return err(s, "No open bracket here.");
      const arr = curExpr(s);
      if (arr.length === 0 || !isTerm(arr[arr.length - 1])) return err(s, "The bracket needs at least one operand.");
      s.stack.pop();
      s.expect = "continue";
      return s;
    }

    case "nextParam": {
      const top = s.stack[s.stack.length - 1];
      if (!top || top.kind !== "fn") return err(s, "Not inside a function parameter.");
      const arr = curExpr(s);
      if (!exprComplete(arr)) return err(s, "Finish this parameter first — it can't end with an operator.");
      const fnTerm = exprByStack(s, s.stack.slice(0, -1))[top.tokIndex];
      if (fnTerm.t !== "fn") return err(s, "Cursor invariant broken.");
      const next = (top.argIndex ?? 0) + 1;
      if (next < fnTerm.args.length) {
        top.argIndex = next;
        s.expect = fnTerm.args[next].length ? "continue" : "operand";
        return s;
      }
      s.stack.pop();
      s.expect = "continue";
      return s;
    }

    case "removeFrame": {
      if (s.phase === "done" || s.phase === "pct") return err(s, "Nothing open to remove here.");
      const top = s.stack[s.stack.length - 1];
      if (!top) return err(s, "Nothing open to remove.");
      const parent = exprByStack(s, s.stack.slice(0, -1));
      parent.splice(top.tokIndex, 1);
      s.stack.pop();
      s.expect = tailExpect(curExpr(s));
      return s;
    }

    // ------------------------------------------------------------ clause-level moves
    case "comparator": {
      if (s.phase === "done") return err(s, "Clause is complete — reset to edit.");
      if (s.phase === "pct") return err(s, "Enter the % width as a number first.");
      // auto-close open frames, then the left side must be complete
      autoClose(s);
      if (!exprComplete(s.left)) return err(s, "Finish the left side first — it can't end with an operator.");
      const leftTail = s.left[s.left.length - 1];
      const leftItem = isTerm(leftTail) ? itemOfTerm(leftTail) : undefined;
      const allowed = leftItem ? comparatorsFor(leftItem.returns) : COMPARATORS;
      if (!allowed.some((c) => c.id === action.cmp)) {
        return err(s, `That comparator doesn't apply to ${leftItem?.label ?? "this operand"}.`);
      }
      s.cmp = action.cmp;
      s.phase = "right";
      s.expect = "operand";
      s.right2 = [];
      s.pct = null;
      return s;
    }

    case "finish": {
      if (s.phase === "left") return err(s, "Pick a comparator first.");
      if (s.phase === "pct") return err(s, "Enter the % width as a number first.");
      autoClose(s);
      const flagCmp = s.cmp === "isTrue" || s.cmp === "isFalse"; // flags need no right side
      if (s.phase === "right") {
        if (!flagCmp && !exprComplete(s.right)) return err(s, "Finish the right side first — it can't end with an operator.");
        if (s.cmp === "between") {
          s.phase = "right2";
          s.expect = "operand";
          return s;
        }
        if (s.cmp === "withinPct") {
          s.phase = "pct";
          s.expect = "operand";
          return s;
        }
        s.phase = "done";
        return s;
      }
      if (s.phase === "right2") {
        if (!exprComplete(s.right2)) return err(s, "Finish the upper bound first.");
        s.phase = "done";
        return s;
      }
      return s;
    }

    // ------------------------------------------------------------ correction
    case "removeLast": {
      if (s.phase === "pct") {
        s.pct = null;
        s.phase = "right";
        s.expect = tailExpect(s.right);
        return s;
      }
      if (s.phase === "done") {
        s.phase = "right";
        s.expect = tailExpect(s.right);
        return s;
      }
      const arr = curExpr(s);
      if (arr.length > 0) {
        arr.pop();
        if (arr.length === 0 && s.stack.length > 0) {
          const top = s.stack[s.stack.length - 1];
          if (top.kind === "bracket") {
            // emptied bracket → dissolve it entirely
            const parent = exprByStack(s, s.stack.slice(0, -1));
            parent.splice(top.tokIndex, 1);
            s.stack.pop();
          }
          // fn frames KEEP the (now empty) parameter slot — the dashed-red
          // empty-slot state — so clearing a pre-filled param never destroys
          // the function. Explicit removal goes through `removeFrame`.
        }
        s.expect = tailExpect(curExpr(s));
        return s;
      }
      // current expr already empty
      if (s.stack.length > 0) {
        const top = s.stack[s.stack.length - 1];
        if (top.kind === "bracket") {
          const parent = exprByStack(s, s.stack.slice(0, -1));
          parent.splice(top.tokIndex, 1);
          s.stack.pop();
          s.expect = tailExpect(curExpr(s));
        }
        // empty fn slot: Backspace is a no-op — the picker offers "Remove function"
        return s;
      }
      if (s.phase === "right2" && s.right2.length === 0) {
        s.phase = "right";
        s.expect = tailExpect(s.right);
        return s;
      }
      if (s.phase === "right" && s.right.length === 0 && s.cmp) {
        s.cmp = null;
        s.phase = "left";
        s.expect = tailExpect(s.left);
        return s;
      }
      return s; // empty left — nothing to remove
    }

    // ------------------------------------------------------------ token editing (non-blocking)
    case "patchTerm": {
      let cur: Expr = action.side === "left" ? s.left : action.side === "right2" ? s.right2 : s.right;
      let target: Term | null = null;
      for (let k = 0; k < action.path.length; k++) {
        const step = action.path[k];
        const t = cur[step.i];
        if (!t || t.t === "op") return err(s, "That token no longer exists.");
        if (k === action.path.length - 1) {
          target = t;
          break;
        }
        if (step.arg != null && t.t === "fn") cur = t.args[step.arg];
        else if (t.t === "bracket") cur = t.inner;
        else return err(s, "That token can't be addressed.");
      }
      if (!target) return err(s, "That token no longer exists.");
      const p = action.patch;
      if (target.t === "number") {
        if (p.value != null && Number.isFinite(p.value)) target.value = p.value;
        return s;
      }
      if (target.t === "attr" || target.t === "fn" || target.t === "saved") {
        if (p.tf) {
          target.tf = p.tf;
          // offset units must stay valid for the new timeframe
          if (target.offset && !OFFSET_UNITS_BY_TF[p.tf].includes(target.offset.unit)) target.offset = null;
        }
        if (p.offset !== undefined) target.offset = p.offset;
        if (target.t === "attr" && p.period !== undefined) {
          const item = byId(target.name);
          if (p.period == null) delete target.period;
          else if (!item?.periodSelector || item.periodSelector.includes(p.period)) target.period = p.period;
        }
        return s;
      }
      return err(s, "That token has no editable settings.");
    }

    case "reset":
      return initMachine();

    default:
      return s;
  }
}

/** Run a scripted list of actions (used by demos, tests and paste-import). */
export function applyActions(state: SMState, actions: SMAction[]): SMState {
  return actions.reduce(reduceMachine, state);
}

// ---------------------------------------------------------------- cursor introspection (drives the UI)

export interface SlotInfo {
  phase: Phase;
  /** which side the cursor is filling */
  side: "left" | "right" | "right2" | "pct";
  expect: "operand" | "continue";
  /** when inside a fn parameter: its type from the registry */
  paramType: "expr" | "number" | null;
  fnName: string | null;
  fnParamName: string | null;
  argIndex: number | null;
  argCount: number | null;
  insideBracket: boolean;
  depth: number;
}

/** Registry param the cursor currently sits in (fn number/expr constraints). */
export function paramAt(s: SMState): { name: string; type: "expr" | "number"; min?: number; max?: number; int?: boolean } | null {
  const top = s.stack[s.stack.length - 1];
  if (!top || top.kind !== "fn") return null;
  const fnTerm = exprByStack(s, s.stack.slice(0, -1))[top.tokIndex];
  if (fnTerm.t !== "fn") return null;
  const item = byId(fnTerm.name);
  return item?.params?.[top.argIndex ?? 0] ?? null;
}

export function slotInfo(s: SMState): SlotInfo {
  const top = s.stack[s.stack.length - 1];
  let paramType: SlotInfo["paramType"] = null;
  let fnName: string | null = null;
  let fnParamName: string | null = null;
  let argIndex: number | null = null;
  let argCount: number | null = null;
  if (top?.kind === "fn") {
    const fnTerm = exprByStack(s, s.stack.slice(0, -1))[top.tokIndex];
    if (fnTerm.t === "fn") {
      const item = byId(fnTerm.name);
      const p = item?.params?.[top.argIndex ?? 0];
      paramType = p?.type ?? "expr";
      fnParamName = p?.name ?? null;
      fnName = item?.label ?? fnTerm.name;
      argIndex = top.argIndex ?? 0;
      argCount = fnTerm.args.length;
    }
  }
  return {
    phase: s.phase,
    side: sideOf(s),
    expect: s.expect,
    paramType,
    fnName,
    fnParamName,
    argIndex,
    argCount,
    insideBracket: top?.kind === "bracket",
    depth: s.stack.length,
  };
}

/** Comparators currently allowed (left operand kind drives the list). */
export function comparatorsAllowed(s: SMState): ComparatorDef[] {
  const tail = s.left[s.left.length - 1];
  const item = isTerm(tail) ? itemOfTerm(tail) : undefined;
  return item ? comparatorsFor(item.returns) : COMPARATORS;
}

function trailingUnit(arr: Expr): string | null {
  const tail = arr[arr.length - 1];
  if (!tail || !isTerm(tail)) return null;
  if (tail.t === "number") return null;
  if (tail.t === "text") return "text";
  const item = itemOfTerm(tail);
  return item?.unit ?? null;
}

/** Rs-vs-% style warning; null when sides are compatible or unknown. */
export function unitWarning(s: SMState): string | null {
  if (!s.cmp || !exprComplete(s.right)) return null;
  const lu = trailingUnit(s.left);
  const ru = trailingUnit(s.right);
  if (!lu || !ru || lu === ru || lu === "text" || ru === "text") return null;
  if (unitsCompatible(lu as never, ru as never)) return null;
  return `Unit mismatch — ${lu} compared against ${ru}. This clause will likely never match.`;
}

/** Can the user finish here? Returns a human reason when not. */
export function canFinish(s: SMState): { ok: boolean; reason?: string } {
  if (s.phase === "left") return { ok: false, reason: "Pick a comparator first" };
  if (s.phase === "pct") return { ok: false, reason: "Enter the % width first" };
  if (s.phase === "done") return { ok: true };
  if (!exprComplete(s.left)) return { ok: false, reason: "Left side is incomplete" };
  const flagCmp = s.cmp === "isTrue" || s.cmp === "isFalse";
  if (!flagCmp && !exprComplete(s.right)) return { ok: false, reason: "Right side is incomplete" };
  if (s.cmp === "between" && s.phase === "right") return { ok: false, reason: "Between needs an upper bound" };
  return { ok: true };
}

/** Input placeholder that mirrors what the cursor expects. */
export function cursorHint(s: SMState): string {
  const info = slotInfo(s);
  if (s.phase === "pct") return "Enter % width — e.g. 2";
  if (s.phase === "done") return "Clause complete";
  if (info.expect === "operand") {
    if (info.paramType === "number") return `Value for ${info.fnParamName ?? "parameter"}…`;
    if (info.fnName) return `${info.fnName} · parameter ${info.argIndex! + 1} of ${info.argCount} — pick an operand…`;
    if (s.phase === "right2") return "Upper bound — pick an indicator or number…";
    if (s.phase === "right") return "Select the right side — number or indicator…";
    return "Select an indicator or formula…";
  }
  if (info.insideBracket) return "Math operator, ) to close, or comparator…";
  if (info.fnName) return "Next parameter (Tab / Enter)…";
  if (s.phase === "right") return "Math operator — or press Enter to finish…";
  return "Math operator, or a comparator…";
}
