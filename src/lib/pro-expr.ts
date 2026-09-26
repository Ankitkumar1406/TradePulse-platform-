/**
 * Chartink-style pro expression language for the screener condition builder.
 *
 * One side of a pro condition row is an arithmetic expression over market
 * series. Grammar (recursive descent, standard + - * / precedence):
 *
 *   expr      := term (( "+" | "-" ) term)*
 *   term      := unary (( "*" | "/" ) unary)*
 *   unary     := "-" unary | atom
 *   atom      := NUMBER
 *              | "(" expr ")"            — grouping
 *              | '"' expr '"'            — quotes group like parens (Chartink paste)
 *              | "abs" "(" expr ")"
 *              | prefixes ( window | series-field | scalar-field )
 *
 *   prefixes  := ( "daily" | "weekly" | N "candle(s) ago" | N "week(s) ago" )*
 *   window    := "sma" "(" series "," N ")"          — moving average, N bars
 *              | "min" "(" N "," series ")"          — lowest value over N bars
 *              | "max" "(" N "," series ")"          — highest value over N bars
 *   series    := prefixes series-field               — one of open/high/low/close/volume
 *
 * Series semantics (the base scan timeframe is DAILY):
 *   - bare field          → daily series, 0 bars back        e.g. `close`
 *   - "N candles ago f"   → daily series, N bars back        e.g. `1 candle ago close`
 *   - "weekly f"          → weekly series (current week)     e.g. `weekly high`
 *   - "N weeks ago f"     → weekly series, N weeks back      e.g. `2 weeks ago high`
 *   - inside "N weeks ago ( … )" the whole group evaluates N weekly candles
 *     back, and "1 candle ago" inside that context means 1 weekly candle —
 *     so `1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100)`
 *     is the weekly change %, one week back (Chartink's weekly-calm pattern).
 *   - "daily"/"weekly" prefixes reset the shift to 0 for what follows.
 *
 * Constant (non-series) fields — marketCap, peTTM, rsi14 … — come from the
 * Stock snapshot table and reject timeframe prefixes/offsets.
 *
 * This module is isomorphic: imported by the browser (live validation +
 * canonical preview) and by the server (AST → SQL compilation in pro-sql.ts).
 */

export type TF = "d" | "w";

export const SERIES_FIELDS = ["open", "high", "low", "close", "volume"] as const;
export type SeriesField = (typeof SERIES_FIELDS)[number];

/** Constant fields from the Stock snapshot — usable inside expressions. */
export const SCALAR_FIELDS: { f: string; label: string }[] = [
  { f: "marketCap", label: "Market cap (₹)" },
  { f: "avgVol3M", label: "Avg volume 3M (shares)" },
  { f: "changePct", label: "Day change %" },
  { f: "peTTM", label: "P/E (TTM)" },
  { f: "pbRatio", label: "P/B ratio" },
  { f: "divYield", label: "Dividend yield %" },
  { f: "rsi14", label: "RSI (14) daily" },
  { f: "wRsi14", label: "RSI (14) weekly" },
  { f: "macdHist", label: "MACD histogram daily" },
  { f: "wMacdHist", label: "MACD histogram weekly" },
  { f: "mom1M", label: "1M return %" },
  { f: "mom3M", label: "3M return %" },
  { f: "mom6M", label: "6M return %" },
  { f: "fromHighPct", label: "% below 52W high" },
  { f: "fromLowPct", label: "% above 52W low" },
  { f: "atr14Pct", label: "ATR % (volatility)" },
  { f: "bbPctB", label: "Bollinger %B" },
  { f: "bbWidthPct", label: "Bollinger width %" },
  { f: "distSma20Pct", label: "Price vs SMA 20 %" },
  { f: "distSma50Pct", label: "Price vs SMA 50 %" },
  { f: "distSma100Pct", label: "Price vs SMA 100 %" },
  { f: "distSma200Pct", label: "Price vs SMA 200 %" },
  { f: "distEma20Pct", label: "Price vs EMA 20 %" },
  { f: "distEma50Pct", label: "Price vs EMA 50 %" },
  { f: "distEma100Pct", label: "Price vs EMA 100 %" },
  { f: "distEma200Pct", label: "Price vs EMA 200 %" },
  { f: "rsRating", label: "RS Rating (1–99)" },
  { f: "epsScore", label: "EPS Score (1–99)" },
];

const SCALAR_KEYS: Record<string, string> = Object.fromEntries(
  SCALAR_FIELDS.map((x) => [x.f.toLowerCase(), x.f])
);

export interface SeriesAtom {
  s: TF;
  f: SeriesField;
  shift: number; // bars back from the latest bar of the series
}

export type ExprNode =
  | { k: "num"; v: number }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; a: ExprNode; b: ExprNode }
  | { k: "neg"; a: ExprNode }
  | { k: "abs"; a: ExprNode }
  | { k: "ser"; s: TF; f: SeriesField; shift: number }
  | { k: "win"; fn: "sma" | "min" | "max"; ser: SeriesAtom; n: number }
  | { k: "scalar"; f: string };

export type ParseOk = { ok: true; node: ExprNode; text: string };
export type ParseFail = { ok: false; error: string };
export type ParseResult = ParseOk | ParseFail;

// ---------------------------------------------------------------- limits

export const EXPR_MAX_LEN = 400;
export const EXPR_MAX_NODES = 80;
const MAX_DEPTH = 16;
const WIN_MAX_N = 500;
const SHIFT_MAX = 600;

// ---------------------------------------------------------------- tokenizer

interface Tok {
  t: "num" | "ident" | "op" | "str";
  v: string;
  pos: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_BODY = /[A-Za-z0-9_]/;

function tokenize(src: string, basePos: number, errs: string[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
      if (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")) {
        i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      toks.push({ t: "num", v: src.slice(start, i), pos: basePos + start });
      continue;
    }
    if (IDENT_START.test(c)) {
      const start = i;
      i++;
      while (i < src.length && IDENT_BODY.test(src[i])) i++;
      toks.push({ t: "ident", v: src.slice(start, i), pos: basePos + start });
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end === -1) { errs.push(`Unclosed quote at position ${basePos + i}`); break; }
      toks.push({ t: "str", v: src.slice(i + 1, end), pos: basePos + i });
      i = end + 1;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      toks.push({ t: "op", v: c, pos: basePos + i });
      i++;
      continue;
    }
    if ("<>=!≤≥≠".includes(c)) {
      errs.push(
        `Unexpected "${c}" at position ${basePos + i} — comparisons belong in the row's operator selector, not inside the expression`
      );
      break;
    }
    errs.push(`Unexpected character "${c}" at position ${basePos + i}`);
    break;
  }
  return toks;
}

// ---------------------------------------------------------------- parser

interface Ctx {
  s: TF;
  shift: number;
  explicit: boolean; // a daily/weekly prefix was applied at this level
}

const BASE_CTX: Ctx = { s: "d", shift: 0, explicit: false };

class Parser {
  private toks: Tok[] = [];
  private i = 0;
  private nodes = 0;
  private depth = 0;
  private errs: string[] = [];

  private fail(msg: string): never {
    throw new Error(msg);
  }

  private peek(o = 0): Tok | null {
    return this.toks[this.i + o] ?? null;
  }

  private next(): Tok {
    const t = this.toks[this.i];
    if (!t) this.fail("Unexpected end of expression");
    this.i++;
    return t;
  }

  private expectOp(op: string): void {
    const t = this.next();
    if (t.t !== "op" || t.v !== op) {
      this.fail(`Expected "${op}" at position ${t.pos} (got "${t.v}")`);
    }
  }

  private budget(): void {
    this.nodes++;
    if (this.nodes > EXPR_MAX_NODES) {
      this.fail(`Expression too complex (over ${EXPR_MAX_NODES} parts)`);
    }
  }

  /** Entry: parse a full expression source. */
  parseSource(src: string): ExprNode {
    if (src.length > EXPR_MAX_LEN) {
      this.fail(`Expression too long (max ${EXPR_MAX_LEN} characters)`);
    }
    // Chartink-friendly alias: "market cap" → the marketCap snapshot field
    const normalized = src.replace(/\bmarket\s+cap\b/gi, "marketCap");
    this.toks = tokenize(normalized, 0, this.errs);
    if (this.errs.length > 0) this.fail(this.errs[0]);
    if (this.toks.length === 0) this.fail("Expression is empty");
    const node = this.parseExpr(BASE_CTX);
    const rest = this.peek();
    if (rest) this.fail(`Unexpected "${rest.v}" at position ${rest.pos}`);
    return node;
  }

  private parseExpr(ctx: Ctx): ExprNode {
    let left = this.parseTerm(ctx);
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && (t.v === "+" || t.v === "-")) {
        this.i++;
        const right = this.parseTerm(ctx);
        this.budget();
        left = { k: "bin", op: t.v as "+" | "-", a: left, b: right };
      } else return left;
    }
  }

  private parseTerm(ctx: Ctx): ExprNode {
    let left = this.parseUnary(ctx);
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
        this.i++;
        const right = this.parseUnary(ctx);
        this.budget();
        left = { k: "bin", op: t.v as "*" | "/", a: left, b: right };
      } else return left;
    }
  }

  private parseUnary(ctx: Ctx): ExprNode {
    const t = this.peek();
    if (t && t.t === "op" && t.v === "-") {
      this.i++;
      const inner = this.parseUnary(ctx);
      this.budget();
      return { k: "neg", a: inner };
    }
    if (t && t.t === "op" && t.v === "+") {
      this.i++;
      return this.parseUnary(ctx);
    }
    return this.parsePrefixed(ctx);
  }

  /** Consume any series prefixes (offsets / timeframe), then the primary. */
  private parsePrefixed(ctx: Ctx): ExprNode {
    let cur = ctx;
    for (;;) {
      const t = this.peek();
      if (!t) break;
      // N candles/weeks ago …
      if (t.t === "num" && this.peek(1)?.t === "ident") {
        const unitTok = this.peek(1)!;
        const unit = unitTok.v.toLowerCase();
        const isCandle = unit === "candle" || unit === "candles";
        const isWeek = unit === "week" || unit === "weeks";
        if (isCandle || isWeek) {
          const after = this.peek(2);
          const agoOk = after?.t === "ident" && after.v.toLowerCase() === "ago";
          if (!agoOk) {
            this.fail(`Expected "ago" after "${unit}" at position ${unitTok.pos}`);
          }
          const n = Number(t.v);
          if (!Number.isFinite(n) || n < 1 || n > SHIFT_MAX) {
            this.fail(`Offset "${t.v} ${unit}" out of range (1–${SHIFT_MAX})`);
          }
          this.i += 3;
          if (isCandle) {
            // "candle" = one bar of the current context timeframe
            cur = { ...cur, shift: cur.shift + n };
          } else {
            const base = cur.s === "w" ? cur.shift : 0;
            cur = { s: "w", shift: base + n, explicit: true };
          }
          continue;
        }
      }
      if (t.t === "ident") {
        const kw = t.v.toLowerCase();
        if (kw === "daily" || kw === "weekly") {
          this.i++;
          cur = { s: kw === "daily" ? "d" : "w", shift: 0, explicit: true };
          continue;
        }
      }
      break;
    }
    return this.parsePrimary(cur);
  }

  private parsePrimary(ctx: Ctx): ExprNode {
    this.depth++;
    if (this.depth > MAX_DEPTH) this.fail("Expression nested too deeply");
    try {
      const t = this.next();
      if (t.t === "num") {
        const v = Number(t.v);
        if (!Number.isFinite(v)) this.fail(`Bad number "${t.v}" at position ${t.pos}`);
        this.budget();
        return { k: "num", v };
      }
      if (t.t === "op" && t.v === "(") {
        const inner = this.parseExpr(ctx);
        this.expectOp(")");
        return inner;
      }
      if (t.t === "str") {
        // Quoted group — same as parens (accepts Chartink-style pastes).
        const sub = tokenize(t.v, t.pos + 1, this.errs);
        if (this.errs.length > 0) this.fail(this.errs[0]);
        const savedToks = this.toks;
        const savedI = this.i;
        this.toks = sub;
        this.i = 0;
        if (this.toks.length === 0) this.fail(`Empty quoted expression at position ${t.pos}`);
        const inner = this.parseExpr(ctx);
        const rest = this.peek();
        if (rest) this.fail(`Unexpected "${rest.v}" inside quotes at position ${rest.pos}`);
        this.toks = savedToks;
        this.i = savedI;
        return inner;
      }
      if (t.t === "ident") {
        return this.parseIdent(t, ctx);
      }
      this.fail(`Unexpected "${t.v}" at position ${t.pos}`);
    } finally {
      this.depth--;
    }
  }

  private parseIdent(t: Tok, ctx: Ctx): ExprNode {
    const kw = t.v.toLowerCase();
    switch (kw) {
      case "abs": {
        this.expectOp("(");
        const inner = this.parseExpr(ctx);
        this.expectOp(")");
        this.budget();
        return { k: "abs", a: inner };
      }
      case "sma":
      case "min":
      case "max":
        return this.parseWindow(kw as "sma" | "min" | "max", ctx);
      case "close":
      case "open":
      case "high":
      case "low":
      case "volume": {
        this.budget();
        const f = kw as SeriesField;
        return { k: "ser", s: ctx.s, f, shift: ctx.shift };
      }
      default: {
        if (kw === "and" || kw === "or") {
          this.fail(
            `"${kw.toUpperCase()}" at position ${t.pos} — logic connectors belong in the row selector, not inside an expression`
          );
        }
        if (["ago", "candle", "candles", "week", "weeks"].includes(kw)) {
          this.fail(`Unexpected "${t.v}" at position ${t.pos} — offsets look like "1 week ago close"`);
        }
        const scalar = SCALAR_KEYS[kw];
        if (scalar) {
          if (ctx.shift !== 0 || ctx.explicit) {
            this.fail(`"${scalar}" is a snapshot constant — timeframe prefixes and "ago" offsets don't apply to it`);
          }
          this.budget();
          return { k: "scalar", f: scalar };
        }
        this.fail(`Unknown name "${t.v}" at position ${t.pos}`);
      }
    }
  }

  /** sma(series, n) · min(n, series) · max(n, series) — both arg orders accepted for min/max. */
  private parseWindow(fn: "sma" | "min" | "max", ctx: Ctx): ExprNode {
    this.expectOp("(");
    // Chartink order for min/max: min(N, series). Detect leading number.
    if (fn !== "sma") {
      const first = this.peek();
      const second = this.peek(1);
      if (first?.t === "num" && second?.t === "op" && second.v === ",") {
        const nTok = this.next();
        this.expectOp(",");
        const ser = this.parseSeriesRef(ctx);
        this.expectOp(")");
        return this.makeWindow(fn, ser, Number(nTok.v), nTok.pos);
      }
    }
    const ser = this.parseSeriesRef(ctx);
    this.expectOp(",");
    const nTok = this.next();
    if (nTok.t !== "num") this.fail(`Expected a bar count at position ${nTok.pos} — e.g. ${fn}(close, 20)`);
    this.expectOp(")");
    return this.makeWindow(fn, ser, Number(nTok.v), nTok.pos);
  }

  private makeWindow(fn: "sma" | "min" | "max", ser: SeriesAtom, n: number, pos: number): ExprNode {
    if (!Number.isInteger(n) || n < 1 || n > WIN_MAX_N) {
      this.fail(`Window length "${n}" out of range (1–${WIN_MAX_N}) at position ${pos}`);
    }
    this.budget();
    return { k: "win", fn, ser, n };
  }

  /** The series argument of a window fn: prefixes then exactly one OHLCV field. */
  private parseSeriesRef(ctx: Ctx): SeriesAtom {
    let cur: Ctx = { ...ctx };
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.t === "num" && this.peek(1)?.t === "ident") {
        const unit = this.peek(1)!.v.toLowerCase();
        const isCandle = unit === "candle" || unit === "candles";
        const isWeek = unit === "week" || unit === "weeks";
        if (isCandle || isWeek) {
          const after = this.peek(2);
          if (!(after?.t === "ident" && after.v.toLowerCase() === "ago")) {
            this.fail(`Expected "ago" after "${unit}" at position ${this.peek(1)!.pos}`);
          }
          const n = Number(t.v);
          if (!Number.isFinite(n) || n < 1 || n > SHIFT_MAX) {
            this.fail(`Offset "${t.v} ${unit}" out of range (1–${SHIFT_MAX})`);
          }
          this.i += 3;
          cur = isCandle
            ? { ...cur, shift: cur.shift + n }
            : { s: "w", shift: (cur.s === "w" ? cur.shift : 0) + n, explicit: true };
          continue;
        }
      }
      if (t.t === "ident") {
        const kw = t.v.toLowerCase();
        if (kw === "daily" || kw === "weekly") {
          this.i++;
          cur = { s: kw === "daily" ? "d" : "w", shift: 0, explicit: true };
          continue;
        }
        break;
      }
      break;
    }
    const fieldTok = this.next();
    if (fieldTok.t !== "ident") {
      this.fail(`Expected a series field at position ${fieldTok.pos}`);
    }
    const kw = fieldTok.v.toLowerCase();
    if (!(SERIES_FIELDS as readonly string[]).includes(kw)) {
      this.fail(
        `"${fieldTok.v}" is not a candle series — sma/min/max take open, high, low, close or volume (position ${fieldTok.pos})`
      );
    }
    return { s: cur.s, f: kw as SeriesField, shift: cur.shift };
  }
}

// ---------------------------------------------------------------- public api

/** Parse a pro expression. Returns the AST plus a canonical serialization. */
export function parseProExpr(src: string): ParseResult {
  try {
    const node = new Parser().parseSource(src);
    return { ok: true, node, text: serializeExpr(node) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid expression" };
  }
}

function prec(n: ExprNode): number {
  return n.k === "bin" && (n.op === "+" || n.op === "-") ? 1 : 2;
}

function serText(ser: SeriesAtom): string {
  const prefix =
    ser.s === "w"
      ? ser.shift > 0
        ? `${ser.shift} week${ser.shift > 1 ? "s" : ""} ago `
        : "weekly "
      : ser.shift > 0
        ? `${ser.shift} candle${ser.shift > 1 ? "s" : ""} ago `
        : "";
  return `${prefix}${ser.f}`;
}

/** Canonical text for previews / saved-screen display. */
export function serializeExpr(n: ExprNode): string {
  switch (n.k) {
    case "num":
      return String(n.v);
    case "neg":
      return `-${wrap(n.a, 3)}`;
    case "abs":
      return `abs(${serializeExpr(n.a)})`;
    case "ser":
      return serText({ s: n.s, f: n.f, shift: n.shift });
    case "scalar":
      return n.f;
    case "win":
      return n.fn === "sma"
        ? `sma(${serText(n.ser)}, ${n.n})`
        : `${n.fn}(${n.n}, ${serText(n.ser)})`;
    case "bin": {
      const p = prec(n);
      // Left-assoc: right operand needs parens at equal precedence (a / (b * c)).
      return `${wrap(n.a, p)} ${n.op} ${wrap(n.b, p + 1)}`;
    }
  }
}

function wrap(n: ExprNode, minPrec: number): string {
  const s = serializeExpr(n);
  if (n.k === "bin" && prec(n) < minPrec) return `(${s})`;
  if (n.k === "neg" && minPrec >= 2) return `(${s})`;
  return s;
}

/** True when the node only references snapshot constants (no candle series). */
export function isScalarOnly(n: ExprNode): boolean {
  switch (n.k) {
    case "num":
    case "scalar":
      return true;
    case "neg":
    case "abs":
      return isScalarOnly(n.a);
    case "bin":
      return isScalarOnly(n.a) && isScalarOnly(n.b);
    default:
      return false;
  }
}
