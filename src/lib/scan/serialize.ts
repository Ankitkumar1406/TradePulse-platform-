/**
 * Scan builder — Chartink-style text serialisation (own wording).
 *
 * Copy/share format — one clause per line, `and` / `or` joins, nested groups
 * in brackets:
 *
 *   ( Daily Close / Daily Min(22, Daily Low) > 1.1
 *   and Market cap > 3cr
 *   and any 2 of (
 *       Daily Rsi(14) > 60
 *       or Daily Volume > Daily Sma(Daily Volume, 20) * 2
 *   ))
 *
 * Timeframes are prefixes (Daily / Weekly / Monthly), offsets read "1 day ago
 * Daily High", fundamentals carry a period suffix ("EPS (TTM) 1Q ago"), and
 * text literals are quoted. `parseScanText` is the exact inverse — import
 * scans shared as text.
 */
import type { Clause, ComparatorId, Expr, Group, MathOp, Offset, Scan, Term, Timeframe } from "./expr-model";
import { isOp, isTerm, newGroup, uid } from "./expr-model";
import { byId, allItems, COMPARATOR_BY_ID, FUND_PERIOD_LABELS, MATH_OPS, TF_LABELS, type RegistryItem } from "./registry";
import { parseNumWithUnits } from "@/lib/pro-expr";

// ---------------------------------------------------------------- build

const CMP_WORDS: Record<ComparatorId, string> = {
  gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", neq: "!=",
  crossAbove: "crossed above", crossBelow: "crossed below",
  between: "between", withinPct: "within",
  isTrue: "is true", isFalse: "is false",
  textEq: "is", textNeq: "is not", contains: "contains", inList: "in list",
};

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1e7 && Number.isInteger(n)) return `${n / 1e7}cr`;
  if (Math.abs(n) >= 1e5 && Number.isInteger(n)) return `${n / 1e5}L`;
  if (Math.abs(n) >= 1e3 && Number.isInteger(n)) return `${n / 1e3}k`;
  return String(Math.round(n * 1e6) / 1e6);
}

function offsetText(off: Offset): string {
  if (!off) return "";
  return `${off.n} ${off.unit}${off.n > 1 ? "s" : ""} ago `;
}

function termText(t: Term): string {
  switch (t.t) {
    case "number": return fmtNum(t.value);
    case "text": return `"${t.value}"`;
    case "bracket": return `( ${exprText(t.inner)} )`;
    case "saved": return `Saved(${t.id})`;
    case "attr": {
      const item = byId(t.name);
      const label = item && !/[(),]/.test(item.label) ? item.label : t.name;
      const tf = item && !item.supportsTimeframe ? "" : `${TF_LABELS[t.tf]} `;
      const off = item?.supportsOffset ? offsetText(t.offset) : "";
      const per = t.period && t.period !== "ttm" && item?.periodSelector ? ` ${FUND_PERIOD_LABELS[t.period]}` : "";
      return `${off}${tf}${label}${per}`;
    }
    case "fn": {
      const item = byId(t.name);
      // labels that contain parens/commas (Max (a, b)) would break the grammar
      const safeLabel = item && !/[(),]/.test(item.label) ? item.label : t.name;
      const tf = item && !item.supportsTimeframe ? "" : `${TF_LABELS[t.tf]} `;
      const off = item?.supportsOffset ? offsetText(t.offset) : "";
      const args = t.args.map(exprText).join(", ");
      return `${off}${tf}${safeLabel}(${args})`;
    }
  }
}

function opText(op: MathOp): string {
  return MATH_OPS.find((m) => m.op === op)?.disp ?? op;
}

export function exprText(expr: Expr): string {
  return expr
    .map((x) => (isOp(x) ? opText(x.op) : termText(x)))
    .join(" ");
}

function clauseText(c: Clause): string {
  const cmp = COMPARATOR_BY_ID[c.cmp];
  if (c.cmp === "isTrue" || c.cmp === "isFalse") return `${exprText(c.left)} ${CMP_WORDS[c.cmp]}`;
  if (c.cmp === "between") {
    return `${exprText(c.left)} between ${exprText(c.right)} and ${exprText(c.right2 ?? [])}`;
  }
  if (c.cmp === "withinPct") {
    return `${exprText(c.left)} within ${c.pct ?? 2}% of ${exprText(c.right)}`;
  }
  void cmp;
  return `${exprText(c.left)} ${CMP_WORDS[c.cmp]} ${exprText(c.right)}`;
}

function groupText(g: Group, indent: string, isRoot: boolean): string {
  const active = g.children.filter((c) => c.enabled);
  const joiner = g.mode === "any" ? "or" : "and";
  const lines = active.map((c, i) => {
    const body = c.kind === "group" ? groupText(c, indent, false) : indent + "  " + clauseText(c);
    return (i === 0 ? "" : indent + joiner + "\n") + body;
  });
  if (isRoot && g.mode === "all") return lines.join("\n");
  if (isRoot && g.mode === "none") return `none of (\n${lines.join("\n")}\n${indent})`;
  if (g.mode === "any") {
    const n = g.anyCount ?? 1;
    const prefix = n > 1 ? `any ${n} of (` : "any (";
    return `${prefix}\n${lines.join("\n")}\n${indent})`;
  }
  if (g.mode === "none") return `none of (\n${lines.join("\n")}\n${indent})`;
  return `(\n${lines.join("\n")}\n${indent})`;
}

export function scanToText(scan: Scan): string {
  return groupText(scan.root, "", true);
}

// ---------------------------------------------------------------- parse

interface Tok { v: string; pos: number }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(" || ch === ")" || ch === ",") { toks.push({ v: ch, pos: i }); i++; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      toks.push({ v: src.slice(i, j + 1), pos: i });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < src.length && !/[\s(),]/.test(src[j])) j++;
    toks.push({ v: src.slice(i, j), pos: i });
    i = j;
  }
  return toks;
}

export class ScanTextError extends Error {}

class P {
  toks: Tok[];
  i = 0;
  constructor(src: string) { this.toks = tokenize(src); }
  peek(): string | null { return this.toks[this.i]?.v ?? null; }
  peekLower(): string | null { const v = this.peek(); return v == null ? null : v.toLowerCase(); }
  next(): string | null { return this.toks[this.i++]?.v ?? null; }
  expect(v: string): void {
    const got = this.next();
    if (got?.toLowerCase() !== v.toLowerCase()) throw new ScanTextError(`Expected "${v}", found "${got ?? "end"}"`);
  }
  isKeyword(...kws: string[]): boolean {
    const v = this.peekLower();
    return v != null && kws.includes(v);
  }

  /** group / clause body until a closing bracket or end */
  parseGroup(mode: Group["mode"], anyCount: number | undefined, depth: number): Group {
    if (depth > 8) throw new ScanTextError("Groups nested too deep");
    const g = newGroup(mode, [], );
    if (anyCount != null) g.anyCount = anyCount;
    const joiner = mode === "any" ? "or" : "and";
    for (;;) {
      g.children.push(this.parseChild(depth + 1));
      const nx = this.peekLower();
      if (nx === joiner) { this.next(); continue; }
      if (nx === "and" || nx === "or") {
        throw new ScanTextError(`Mixed "and" / "or" inside one group — wrap one side in brackets`);
      }
      break;
    }
    return g;
  }

  parseChild(depth: number): Clause | Group {
    if (this.peek() === "(") {
      // "(" can open a nested GROUP or an EXPRESSION bracket that starts the
      // clause — try the clause first and roll back if it isn't one.
      const save = this.i;
      try {
        const clause = this.parseClause();
        const nx = this.peekLower();
        if (nx == null || nx === "and" || nx === "or") return clause;
      } catch {
        // fall through to the group path
      }
      this.i = save;
    }
    if (this.isKeyword("any", "none")) {
      const kw = this.next()!.toLowerCase();
      let anyCount: number | undefined;
      if (kw === "any") {
        const nx = this.peek();
        if (nx && /^\d+$/.test(nx) && this.toks[this.i + 1]?.v.toLowerCase() === "of") {
          anyCount = +this.next()!; this.next();
        }
      }
      if (kw === "none") { if (this.peekLower() === "of") this.next(); }
      this.expect("(");
      const g = this.parseGroup(kw === "any" ? "any" : "none", anyCount, depth);
      this.expect(")");
      return g;
    }
    if (this.peek() === "(") {
      this.next();
      const g = this.parseGroup("all", undefined, depth);
      this.expect(")");
      return g;
    }
    return this.parseClause();
  }

  parseClause(): Clause {
    const left = this.parseExpr();
    const cmp = this.parseComparator();
    const clause: Clause = { id: uid("c"), kind: "clause", left, cmp, right: [], enabled: true };
    if (cmp === "isTrue" || cmp === "isFalse") return clause;
    if (cmp === "between") {
      clause.right = this.parseExpr();
      this.expect("and");
      clause.right2 = this.parseExpr();
      return clause;
    }
    if (cmp === "withinPct") {
      const pctTok = this.next();
      const pct = pctTok ? parseFloat(pctTok.replace(/%$/, "")) : NaN;
      if (!Number.isFinite(pct)) throw new ScanTextError("within needs a % width");
      clause.pct = pct;
      if (this.peekLower() === "%") this.next();
      this.expect("of");
      clause.right = this.parseExpr();
      return clause;
    }
    clause.right = this.parseExpr();
    return clause;
  }

  parseComparator(): ComparatorId {
    const v = this.next();
    if (v == null) throw new ScanTextError("Clause is missing a comparator");
    switch (v) {
      case ">": return "gt";
      case ">=": return "gte";
      case "<": return "lt";
      case "<=": return "lte";
      case "=": return "eq";
      case "!=": return "neq";
      case "✓": return "isTrue";
      case "✗": return "isFalse";
    }
    const lv = v.toLowerCase();
    if (lv === "crossed" || lv === "crosses") {
      const dir = this.next()?.toLowerCase();
      if (dir === "above") return "crossAbove";
      if (dir === "below") return "crossBelow";
      throw new ScanTextError("crossed above / crossed below");
    }
    if (lv === "between") return "between";
    if (lv === "within") return "withinPct";
    if (lv === "is") {
      const nx = this.peekLower();
      if (nx === "true") { this.next(); return "isTrue"; }
      if (nx === "false") { this.next(); return "isFalse"; }
      if (nx === "not") { this.next(); return "textNeq"; }
      return "textEq";
    }
    if (lv === "contains") return "contains";
    if (lv === "in" || lv === "list") return "inList";
    throw new ScanTextError(`Unknown comparator "${v}"`);
  }

  parseExpr(): Expr {
    const out: Expr = [];
    let depth = 0;
    for (;;) {
      const t = this.parseTerm();
      out.push(t);
      const op = this.peek();
      const opDef = op ? MATH_OPS.find((m) => m.disp === op || m.op === op) : undefined;
      if (opDef) {
        this.next();
        out.push({ t: "op", op: opDef.op });
        continue;
      }
      break;
    }
    void depth;
    return out;
  }

  parseTerm(): Term {
    // expression-level brackets: ( High − Low )
    if (this.peek() === "(") {
      this.next();
      const inner = this.parseExpr();
      this.expect(")");
      return { t: "bracket", inner };
    }
    let off: Offset = null;
    let tf: Timeframe = "daily";
    let period: import("./expr-model").FundPeriod | undefined;
    // offset prefix: "1 day ago", "3 weeks ago", "2 candles ago", "1 month ago"
    for (;;) {
      const v = this.peek();
      if (v && /^\d+$/.test(v)) {
        const unitTok = this.toks[this.i + 1]?.v.toLowerCase();
        if (unitTok && ["day", "days", "week", "weeks", "month", "months", "candle", "candles"].includes(unitTok)) {
          const n = +this.next()!;
          const unitRaw = this.next()!;
          this.expect("ago");
          const unit = unitRaw.startsWith("day") ? "day" : unitRaw.startsWith("week") ? "week" : unitRaw.startsWith("month") ? "month" : "candle";
          off = { n, unit };
          continue;
        }
      }
      break;
    }
    // timeframe prefix
    const tv = this.peekLower();
    if (tv === "daily") { this.next(); tf = "daily"; }
    else if (tv === "weekly") { this.next(); tf = "weekly"; }
    else if (tv === "monthly") { this.next(); tf = "monthly"; }
    // fundamentals period suffix handled after the label

    // labels can be multi-word ("Market cap") — longest-match up to 4 tokens,
    // where the token after the match may be "(" (function call)
    let labelTok: string | null = null;
    let fnCall = false;
    let matchedItem: RegistryItem | undefined;
    for (let k = Math.min(4, this.toks.length - this.i); k >= 1; k--) {
      const parts: string[] = [];
      let hasCall = false;
      for (let j = 0; j < k; j++) {
        const tok = this.toks[this.i + j]?.v ?? "";
        if (tok === "(") { hasCall = true; break; }
        parts.push(tok);
      }
      const cand = parts.join(" ");
      const it = this.findItem(cand);
      if (it) {
        const callTok = this.toks[this.i + parts.length]?.v;
        if (callTok === "(") {
          labelTok = cand; matchedItem = it; fnCall = true;
          // consume label tokens; the "(" is consumed below
          this.i += parts.length;
          break;
        }
        if (k === 1 || this.toks[this.i + k] == null || this.toks[this.i + k].v !== "(") {
          labelTok = cand; matchedItem = it;
          this.i += parts.length;
          break;
        }
        // could be a longer non-fn label — keep trying shorter lengths only
        // if no longer candidate matches a label followed by "("
        if (!hasCall) { labelTok = cand; matchedItem = it; this.i += parts.length; break; }
      }
    }
    if (!labelTok) {
      const single = this.next();
      if (!single) throw new ScanTextError("Expected an operand");
      if (single.startsWith('"')) return { t: "text", value: single.slice(1, -1) };
      const numv = parseNumWithUnits(single);
      if (numv != null) return { t: "number", value: numv };
      throw new ScanTextError(`Unknown operand "${single}"`);
    }
    if (labelTok.startsWith('"')) {
      return { t: "text", value: labelTok.slice(1, -1) };
    }
    const numv = parseNumWithUnits(labelTok);
    if (numv != null) return { t: "number", value: numv };

    const item = matchedItem;
    if (this.peek() === "(") {
      if (!fnCall) this.next();
      else this.next(); // ( consumed either way; fnCall only affects label length
      const args: Expr[] = [];
      if (this.peek() !== ")") {
        for (;;) {
          args.push(this.parseExpr());
          if (this.peek() === ",") { this.next(); continue; }
          break;
        }
      }
      this.expect(")");
      if (item?.kind !== "fn" && labelTok.toLowerCase() !== "saved") {
        throw new ScanTextError(`"${labelTok}" is not a function`);
      }
      if (labelTok.toLowerCase() === "saved") {
        const id = args[0]?.[0];
        return { t: "saved", id: id && id.t === "number" ? String(id.value) : "0", tf, offset: off };
      }
      return { t: "fn", name: item!.id, tf, offset: off, args: applyDefaults(item!, args) };
    }
    if (!item) throw new ScanTextError(`Unknown operand "${labelTok}"`);
    if (item.kind === "number" || item.kind === "group" || item.kind === "bracket") {
      throw new ScanTextError(`"${labelTok}" can't be used inside a text scan`);
    }
    // fundamentals period suffix ("1Q ago", "latest Q", "2Y ago"…)
    if (item.periodSelector) {
      const nx = this.peek();
      const nx2 = this.toks[this.i + 1]?.v;
      if (nx && nx2) {
        const key = `${nx} ${nx2}`.toLowerCase();
        for (const p of item.periodSelector) {
          if (FUND_PERIOD_LABELS[p].toLowerCase() === key && p !== "ttm") {
            this.next(); this.next();
            period = p;
            break;
          }
        }
      }
    }
    return { t: "attr", name: item.id, tf, offset: item.supportsOffset ? off : null, ...(period ? { period } : {}) };
  }

  findItem(label: string): RegistryItem | undefined {
    const exact = byId(label);
    if (exact) return exact;
    const lower = label.toLowerCase();
    const id = allItemsLower().get(lower);
    return id ? byId(id) : byLabelLower(lower);
  }
}

let lowerMap: Map<string, string> | null = null; // lowercase id → id
let labelMap: Map<string, string> | null = null; // lowercase label → id
function allItemsLower(): Map<string, string> {
  if (!lowerMap) {
    lowerMap = new Map();
    for (const it of allItems()) lowerMap.set(it.id.toLowerCase(), it.id);
  }
  return lowerMap;
}
function byLabelLower(lower: string): RegistryItem | undefined {
  if (!labelMap) {
    labelMap = new Map();
    for (const it of allItems()) labelMap.set(it.label.toLowerCase(), it.id);
  }
  const id = labelMap.get(lower);
  return id ? byId(id) : undefined;
}

/** Fill omitted trailing fn args with their registry defaults. */
function applyDefaults(item: RegistryItem, args: Expr[]): Expr[] {
  const out: Expr[] = [];
  const params = item.params ?? [];
  for (let k = 0; k < params.length; k++) {
    if (k < args.length) out.push(args[k]);
    else {
      const d = params[k].default;
      out.push(params[k].type === "number" ? [{ t: "number", value: d as number }] : [{ t: "attr", name: String(d), tf: "daily", offset: null }]);
    }
  }
  return out;
}

export function parseScanText(src: string): { ok: true; scan: Scan } | { ok: false; error: string } {
  try {
    const p = new P(src);
    const first = p.parseChild(0);
    let root: Group;
    const joiner = p.peekLower();
    if (joiner === "and" || joiner === "or") {
      // bare clause chain at the top level — wrap in a group
      const g = newGroup(joiner === "and" ? "all" : "any");
      g.children.push(first);
      for (;;) {
        p.next(); // consume the joiner
        g.children.push(p.parseChild(1));
        const nx = p.peekLower();
        if (nx !== "and" && nx !== "or") break;
        if (nx !== joiner) throw new ScanTextError(`Mixed "and" / "or" at the top level — wrap one side in brackets`);
      }
      root = g;
    } else if (first.kind === "group") {
      root = first;
    } else {
      root = newGroup("all", [first]);
    }
    if (p.peek() != null) throw new ScanTextError(`Unexpected "${p.peek()}" after the scan`);
    return { ok: true, scan: { segment: "cash", root } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not parse the scan text" };
  }
}

// ---------------------------------------------------------------- helpers for row actions

export function clauseToText(c: Clause): string {
  return clauseText(c);
}

export { isTerm };
