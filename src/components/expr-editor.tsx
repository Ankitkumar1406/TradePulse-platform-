"use client";

import { useMemo } from "react";
import { parseProExpr } from "@/lib/pro-expr";
import { cn } from "@/lib/utils";

/**
 * Expression editor for pro condition rows — Chartink-style. Validates the
 * expression live (shared parser), shows the canonical form when valid and
 * the parser error when not. Registers its input element so the ƒx cheat
 * sheet can insert tokens at the caret.
 */
export function ExprEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  inputKey,
  registerInput,
  onFocusKey,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  inputKey: string; // "${rowId}:${side}"
  registerInput?: (key: string, el: HTMLInputElement | null) => void;
  onFocusKey?: (key: string) => void;
}) {
  const parsed = useMemo(
    () => (value.trim() ? parseProExpr(value) : null),
    [value]
  );
  const invalid = parsed != null && !parsed.ok;
  const valid = parsed != null && parsed.ok;

  return (
    <div className="min-w-0 flex-1">
      <input
        ref={(el) => registerInput?.(inputKey, el)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onFocusKey?.(inputKey)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "h-8 w-full min-w-32 rounded-md border bg-zinc-900 px-2 font-mono text-xs text-zinc-100 outline-none transition-colors focus:border-brand/60",
          invalid ? "border-loss/70" : "border-zinc-700"
        )}
      />
      {invalid && (
        <p className="mt-0.5 text-[10px] leading-tight text-loss">{parsed.error}</p>
      )}
      {valid && parsed.text !== value.trim() && (
        <p className="mt-0.5 truncate font-mono text-[10px] leading-tight text-zinc-600" title={parsed.text}>
          {parsed.text}
        </p>
      )}
    </div>
  );
}

/** ƒx cheat-sheet content — every entry is directly insertable. */
export const CHEAT_SHEET: { group: string; items: { code: string; note: string }[] }[] = [
  {
    group: "Candle series — daily by default",
    items: [
      { code: "close", note: "Latest daily close · also open / high / low / volume" },
      { code: "1 candle ago close", note: "Previous daily candle" },
      { code: "weekly close", note: "Current week's candle (forms as the week trades)" },
      { code: "2 weeks ago high", note: "Weekly high, 2 weekly candles back" },
    ],
  },
  {
    group: "Functions",
    items: [
      { code: "sma(close, 20)", note: "Simple moving average over the last N bars of the series" },
      { code: "min(66, low)", note: "Lowest low over the last N bars (also max)" },
      { code: "max(20, high)", note: "Highest high over the last N bars" },
      { code: "abs(close - 1 candle ago close)", note: "Absolute value of an expression" },
    ],
  },
  {
    group: "Snapshot constants — no timeframe",
    items: [
      { code: "marketCap", note: "Market cap in ₹ (1 Cr = 100000000)" },
      { code: "rsi14", note: "Daily RSI(14) · wRsi14 for weekly" },
      { code: "peTTM", note: "P/E · also pbRatio, divYield, mom1M/3M/6M, fromHighPct, rsRating…" },
    ],
  },
  {
    group: "Pro combos",
    items: [
      { code: "close / min(66, low)", note: "How far above the 66-day low (1.30 = +30%)" },
      { code: "close * sma(volume, 20)", note: "Traded value vs its 20-day norm (30000000 ≈ ₹3 Cr)" },
      {
        code: "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))",
        note: "Weekly change %, one week back — keep |value| ≤ 6 for calm weekly bars",
      },
    ],
  },
];
