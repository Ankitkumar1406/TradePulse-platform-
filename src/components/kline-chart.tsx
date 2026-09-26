"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { init, dispose, registerOverlay, registerIndicator, type Chart, type KLineData, type Period } from "klinecharts";
import { cn } from "@/lib/utils";
import { detectBase, type BaseRange } from "@/lib/base";

/**
 * TradePulse technical chart (client-only module; see candle-chart.tsx wrapper) —
 * built on KLineChart, laid out for post-close research: a candlestick main pane
 * with a single MA 20 overlay BY DEFAULT (MA 5/10/20/60,
 * any-length EMA or no overlay selectable via `maMode`), VOLUME drawn INSIDE
 * the main pane (bottom-anchored bars behind the candles — no separate pane,
 * so the price action keeps the full height), and optional MACD / RSI /
 * Bollinger(20,2) panes that live behind the indicator filter — default view
 * is just candles + 20 MA + volume + base overlay. A
 * live OHLCV readout follows the crosshair, D/W/M timeframes switch, zoom &
 * pan are free, and the BASE OVERLAY draws a dashed rectangle over the current
 * consolidation with its formation duration. Colors resolve from the theme's
 * CSS variables so light and dark both look native.
 */

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type ChartTimeframe = "day" | "week" | "month";

const TIMEFRAMES: { id: ChartTimeframe; label: string }[] = [
  { id: "day", label: "D" },
  { id: "week", label: "W" },
  { id: "month", label: "M" },
];

function toMillis(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function aggregate(candles: Candle[], tf: ChartTimeframe): KLineData[] {
  if (tf === "day") {
    return candles.map((c) => ({
      timestamp: toMillis(c.date), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0,
    }));
  }
  const buckets = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = new Date(`${c.date}T00:00:00Z`);
    let key: string;
    if (tf === "month") {
      key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    } else {
      // week bucket anchored to Monday
      const day = d.getUTCDay();
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    }
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }
  return [...buckets.values()].map((group) => ({
    timestamp: toMillis(group[0].date),
    open: group[0].open,
    high: Math.max(...group.map((c) => c.high)),
    low: Math.min(...group.map((c) => c.low)),
    close: group[group.length - 1].close,
    volume: group.reduce((a, c) => a + (c.volume ?? 0), 0),
  }));
}

interface ThemeColors {
  grid: string; axisText: string; axisLine: string; crosshair: string; crosshairText: string;
  up: string; down: string; flat: string; bg: string; text: string; ma: string[]; base: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// cached candle colors for the in-pane volume overlay — the custom draw runs
// every frame, so it reads these instead of hitting getComputedStyle each time
let volumeColors = { up: "#0b8043", down: "#c73a3a" };

function readTheme(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    grid: v("--tp-chart-grid", "#e4e7eb"),
    axisText: v("--tp-chart-axis", "#878c93"),
    axisLine: v("--tp-z800", "#e4e7eb"),
    crosshair: v("--tp-z600", "#9aa0a6"),
    crosshairText: v("--tp-z900", "#ffffff"),
    up: v("--profit", "#0b8043"),
    down: v("--loss", "#c73a3a"),
    flat: v("--tp-z600", "#9aa0a6"),
    bg: "transparent",
    text: v("--tp-z400", "#4a4a4a"),
    ma: [
      v("--brand", "#0b6e4f"),
      v("--tp-sky-300", "#0369a1"),
      v("--tp-chart-sma20", "#a87d12"),
      v("--tp-chart-sma50", "#6b7076"),
    ],
    base: v("--gold", "#d4a72c"),
  };
}

function buildStyles(t: ThemeColors) {
  // keep the volume overlay's candle colors in sync with the theme
  volumeColors = { up: t.up, down: t.down };
  return {
    grid: {
      horizontal: { color: t.grid },
      vertical: { show: false },
    },
    candle: {
      type: "candle_solid" as const,
      bar: {
        upColor: t.up, downColor: t.down, noChangeColor: t.flat,
        upBorderColor: t.up, downBorderColor: t.down, noChangeBorderColor: t.flat,
        upWickColor: t.up, downWickColor: t.down, noChangeWickColor: t.flat,
      },
      priceMark: { high: { color: t.axisText }, low: { color: t.axisText }, last: { text: { color: t.crosshairText } } },
      tooltip: {
        title: { show: false },
        legend: { color: t.text, size: 10 },
        text: { color: t.text, size: 10 },
      },
    },
    indicator: {
      bars: [{ upColor: t.up, downColor: t.down, noChangeColor: t.flat }],
      lines: [{ color: t.ma[0] }, { color: t.ma[1] }, { color: t.ma[2] }, { color: t.ma[3] }, { color: t.flat }, { color: t.flat }],
      text: { color: t.axisText, size: 10 },
      tooltip: { legend: { color: t.text, size: 10 } },
      lastValueMark: { text: { color: t.axisText, size: 10 } },
    },
    crosshair: {
      horizontal: { line: { color: t.crosshair }, text: { backgroundColor: t.crosshair, color: t.crosshairText } },
      vertical: { line: { color: t.crosshair }, text: { backgroundColor: t.crosshair, color: t.crosshairText } },
    },
    axis: {
      axisLine: { color: t.axisLine },
      tickText: { color: t.axisText, size: 10 },
      tickLine: { color: t.axisLine },
    },
    separator: { color: t.grid },
  };
}

const CHART_INDICATORS = ["MA", "VOL", "MACD", "RSI", "BOLL"] as const;
type PaneKey = (typeof CHART_INDICATORS)[number];

const PANE_IDS: Record<PaneKey, string> = {
  MA: "candle_pane",
  VOL: "candle_pane", // volume lives INSIDE the main pane — no separate pane
  MACD: "tp_macd",
  RSI: "tp_rsi",
  BOLL: "candle_pane",
};

/** Indicators that own a dedicated sub-pane (everything but MA/VOL/BOLL overlays). */
const SUB_PANE_KEYS: PaneKey[] = ["MACD", "RSI"];

const PANE_HEIGHTS: Partial<Record<PaneKey, number>> = { MACD: 84, RSI: 72 };

// Custom overlay template for the base overlay — klinecharts ships 'rect' only
// as a low-level figure, not a drawable overlay, so we register one that maps
// two points (pivot high → latest bar) onto a dashed rectangle figure.
let baseRectRegistered = false;
function ensureBaseRectOverlay() {
  if (baseRectRegistered) return;
  registerOverlay({
    name: "baseRect",
    totalStep: 3,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length !== 2) return [];
      const a = coordinates[0], b = coordinates[1];
      return [
        {
          type: "rect",
          attrs: {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            width: Math.abs(a.x - b.x),
            height: Math.abs(a.y - b.y),
          },
          styles: (overlay as { styles?: { rect?: Record<string, unknown> } })?.styles?.rect,
        },
      ];
    },
  });
  baseRectRegistered = true;
}

/**
 * In-pane volume overlay — a custom indicator drawn INSIDE the candle pane so
 * volume never steals height from the price action. Three details make it safe:
 *  · `figures: []` — klinecharts scales the pane's y-axis from figure values,
 *    so an empty figure list keeps the price axis untouched by volume numbers;
 *  · `zLevel: -1` — drawn 'destination-over', i.e. BEHIND the candles;
 *  · custom `draw` — bottom-anchored bars, max 18% of pane height, scaled to
 *    the max volume across the VISIBLE bars (stays proportional while panning).
 */
let volMainRegistered = false;
function ensureVolMainIndicator() {
  if (volMainRegistered) return;
  registerIndicator({
    name: "TP_VOL_MAIN",
    shortName: "VOL",
    precision: 0,
    zLevel: -1,
    figures: [],
    calc: (dataList: KLineData[]) => dataList.map((k) => ({ vol: k.volume ?? 0 })),
    draw: ({ ctx, chart, bounding, xAxis }) => {
      const dataList = chart.getDataList();
      const { realFrom, realTo } = chart.getVisibleRange();
      let maxVol = 0;
      for (let i = realFrom; i <= realTo; i++) {
        const vol = dataList[i]?.volume ?? 0;
        if (vol > maxVol) maxVol = vol;
      }
      if (maxVol <= 0) return true;
      const maxH = Math.max(6, bounding.height * 0.18);
      const barW = Math.max(1, chart.getBarSpace().halfGapBar * 2);
      ctx.globalAlpha = 0.32;
      for (let i = realFrom; i <= realTo; i++) {
        const k = dataList[i];
        const vol = k?.volume ?? 0;
        if (!k || vol <= 0) continue;
        const h = Math.max(1, (vol / maxVol) * maxH);
        const x = xAxis.convertToPixel(i);
        ctx.fillStyle = k.close >= k.open ? volumeColors.up : volumeColors.down;
        ctx.fillRect(x - barW / 2, bounding.height - h, barW, h);
      }
      ctx.globalAlpha = 1;
      return true;
    },
  });
  volMainRegistered = true;
}

/** Moving-average overlay mode: "default" = single MA 20 · "set" = MA 5/10/20/60 · number = EMA of that length · "none". */
export type MaMode = "default" | "set" | "none" | number;

/** Sub/overlay indicator switches (controlled from the chart filter settings). */
export interface ChartIndicatorFlags { VOL: boolean; MACD: boolean; RSI: boolean; BOLL: boolean }

export interface CandleChartProps {
  candles: Candle[];
  height?: number;
  className?: string;
  /** Controlled timeframe — when set, the D/W/M switcher reflects and follows it. */
  timeframe?: ChartTimeframe;
  /** Notify parent when the user flips the D/W/M switcher. */
  onTimeframeChange?: (tf: ChartTimeframe) => void;
  /** Main-pane moving average: default single MA 20; "set", a number (EMA) or "none" opt out. */
  maMode?: MaMode;
  /** Controlled indicator panes (chart-card grid). Unset = internal toolbar chips (full variant). */
  indicators?: Partial<ChartIndicatorFlags>;
  /** Draw the consolidation base rectangle + duration on the chart. */
  showBase?: boolean;
  /** Show the base-formation chip below the canvas (off when the host card renders it in its own footer strip). */
  baseChip?: boolean;
  /** "card" = clean reference-style grid card (no toolbar / no OHLCV readout); "full" = complete layout. */
  variant?: "full" | "card";
}

export function CandleChart({
  candles, height = 440, className, timeframe, onTimeframeChange, maMode = "default", indicators, showBase = false, baseChip = true, variant = "full",
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const candlesRef = useRef<Candle[]>(candles);
  const indicatorIdsRef = useRef<Partial<Record<PaneKey, string>>>({});
  const overlayIdRef = useRef<string | null>(null);
  const maKeyRef = useRef<string | null>(null);
  const prevPeriodRef = useRef<ChartTimeframe | null>(null);
  const [internalTf, setInternalTf] = useState<ChartTimeframe>("day");
  // Default view per spec: candles + 20 MA + Volume (+ base overlay when on).
  // MACD / RSI / Bollinger stay behind the indicator filter until selected.
  const [panes, setPanes] = useState<Record<PaneKey, boolean>>(() => ({
    MA: true, VOL: true, MACD: false, RSI: false, BOLL: false,
  }));
  // Bumped on theme flips so the inline-styled MA overlay rebuilds with fresh colors.
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [readout, setReadout] = useState<Candle | null>(null);
  // Controlled when the parent passes `timeframe` (chart filter bar); uncontrolled otherwise.
  const tf = timeframe ?? internalTf;

  // Effective indicator panes — the chart-filter grid controls them from the
  // settings popover; the tall dialog chart drives them with the toolbar chips.
  const effPanes: Record<PaneKey, boolean> = useMemo(
    () =>
      indicators
        ? {
            MA: true,
            VOL: indicators.VOL ?? true,
            MACD: indicators.MACD ?? false,
            RSI: indicators.RSI ?? false,
            BOLL: indicators.BOLL ?? false,
          }
        : panes,
    [indicators, panes],
  );

  // Base detection — memoized so the overlay only rebuilds when data flips
  const base: BaseRange | null = useMemo(
    () => (showBase && candles.length > 20 ? detectBase(candles) : null),
    [candles, showBase],
  );

  // Keep the freshest candles reachable from the chart's data loader
  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  // The canvas container only exists once bars arrive (until then the early-return
  // placeholder renders with no ref), so chart creation is gated on `ready`:
  // without it the init effect fires once against the placeholder and any card
  // whose bars load after mount would stay blank forever. Data itself is applied
  // synchronously in the effect below, so indicators never race the data.
  const ready = candles.length >= 5;

  // Create the chart once; rebuild indicators & styles per theme
  useEffect(() => {
    const el = containerRef.current;
    if (!el || chartRef.current) return;
    const ro = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    ro.observe(el);

    const chart = init(el, {
      styles: buildStyles(readTheme()),
    });
    if (!chart) return;
    chartRef.current = chart;

    chart.setSymbol({ ticker: "STOCK", shortName: "STOCK", pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod({ type: "day", span: 1 });
    prevPeriodRef.current = "day";
    chart.setOffsetRightDistance(70);
    ensureVolMainIndicator();

    // The loader's sync callback means data lands in the chart store DURING
    // setDataLoader — before the indicator effect below creates the overlays.
    const loader = {
      getBars: ({ type, period, callback }: { type: string; period: Period; callback: (data: KLineData[]) => void }) => {
        if (type === "forward" || type === "backward") {
          callback([]);
          return;
        }
        const t: ChartTimeframe = period.type === "week" ? "week" : period.type === "month" ? "month" : "day";
        callback(aggregate(candlesRef.current, t));
      },
    };
    chart.setDataLoader(loader);

    // crosshair-following OHLCV readout
    chart.subscribeAction("onCrosshairChange", (raw?: unknown) => {
      const data = raw as { kLineData?: KLineData } | undefined;
      const kd = data?.kLineData;
      if (!kd) return;
      setReadout((prev) => {
        const ts = new Date(kd.timestamp).toISOString().slice(0, 10);
        if (prev && prev.date === ts && prev.close === kd.close) return prev;
        return {
          date: ts, open: kd.open, high: kd.high, low: kd.low, close: kd.close, volume: kd.volume ?? 0,
        };
      });
    });

    return () => {
      ro.disconnect();
      dispose(chart);
      chartRef.current = null;
      indicatorIdsRef.current = {};
      overlayIdRef.current = null;
      maKeyRef.current = null;
      prevPeriodRef.current = null;
    };
  }, [height, ready]);

  // Data + period sync — resetData re-invokes the loader, which also covers
  // the async-arrival case (bars fetched after mount) that left cards blank.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (prevPeriodRef.current !== tf) {
      prevPeriodRef.current = tf;
      chart.setPeriod({ type: tf, span: 1 });
    } else {
      chart.resetData();
    }
  }, [candles, tf]);

  // Re-apply styles when the theme flips (html class changes) — and bump the
  // epoch so the inline-styled MA overlay rebuilds with the fresh palette.
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      chartRef.current?.setStyles(buildStyles(readTheme()));
      setStyleEpoch((e) => e + 1);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Sync indicator panes with toggles — and swap the MA overlay per maMode.
  // `ready` is a dependency on purpose: when bars arrive asynchronously the
  // chart is only created on the ready-flip, and this effect must re-run after
  // that or the default MA/EMA (and volume) indicators never get created —
  // the "line missing on first load" bug.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const mode = maMode ?? "default";

    // main-pane moving average: MA 20 (default) / MA 5-10-20-60 set / EMA n / none
    const spec: { name: "MA" | "EMA"; calcParams: number[] } | null =
      mode === "none" || !effPanes.MA
        ? null
        : typeof mode === "number"
          ? { name: "EMA", calcParams: [mode] }
          : mode === "set"
            ? { name: "MA", calcParams: [5, 10, 20, 60] }
            : { name: "MA", calcParams: [20] };
    // the epoch prefix forces a rebuild after a theme flip so inline colors stay fresh
    const key = `${styleEpoch}|${spec ? `${spec.name}:${spec.calcParams.join(",")}` : "none"}`;
    if (key !== maKeyRef.current) {
      const existing = indicatorIdsRef.current.MA;
      if (existing) {
        chart.removeIndicator({ id: existing });
        delete indicatorIdsRef.current.MA;
      }
      maKeyRef.current = key;
      if (spec) {
        // single MA 20 renders gold — the reference-site convention for the 20 MA
        const styles =
          spec.name === "MA" && spec.calcParams.length === 1
            ? { lines: [{ color: readTheme().ma[2] }] }
            : undefined;
        // isStack=true — klinecharts 10 wipes every other indicator in the
        // pane when stacking is off, which silently deleted the EMA/MA (and
        // the volume overlay) whenever a sibling candle-pane indicator was
        // created after it. The MA/EMA line “missing on load” bug.
        const id =
          chart.createIndicator({ name: spec.name, paneId: PANE_IDS.MA, calcParams: spec.calcParams, styles }, true) ?? undefined;
        indicatorIdsRef.current.MA = id;
      }
    }

    const opts: Record<PaneKey, { name: string; paneId: string; calcParams?: number[] }> = {
      MA: { name: "MA", paneId: PANE_IDS.MA },
      VOL: { name: "TP_VOL_MAIN", paneId: PANE_IDS.VOL },
      MACD: { name: "MACD", paneId: PANE_IDS.MACD },
      RSI: { name: "RSI", paneId: PANE_IDS.RSI, calcParams: [14] },
      BOLL: { name: "BOLL", paneId: PANE_IDS.BOLL, calcParams: [20, 2] },
    };
    // Fixed sub-pane heights only fit the tall dialog chart. Compact grid cards
    // need explicit proportional heights — klinecharts otherwise takes space for
    // new panes out of the candle pane, which can collapse it to zero. Only true
    // sub-pane indicators (MACD/RSI) participate; VOL and BOLL are main-pane
    // overlays and must never trigger a candle-pane resize.
    const fixedPanes = height >= 320;
    const activeSubs = SUB_PANE_KEYS.filter((k) => effPanes[k]);
    const subH = fixedPanes ? null : Math.max(42, Math.floor((height - 28) / (1.6 + activeSubs.length)));
    for (const k of CHART_INDICATORS) {
      if (k === "MA") continue; // handled above
      const existingSub = indicatorIdsRef.current[k];
      if (effPanes[k]) {
        if (!existingSub) {
          // isStack=true — see the MA creation note above: without it each new
          // candle-pane indicator (VOL/BOLL) wipes the ones created before it.
          const id = chart.createIndicator(opts[k], true) ?? undefined;
          indicatorIdsRef.current[k] = id;
        }
        if (!SUB_PANE_KEYS.includes(k)) continue; // in-pane overlays take no extra height
        const ph = fixedPanes ? PANE_HEIGHTS[k] : subH;
        if (ph) chart.setPaneOptions({ id: PANE_IDS[k], height: ph });
      } else if (existingSub) {
        chart.removeIndicator({ id: existingSub });
        delete indicatorIdsRef.current[k];
      }
    }
  }, [panes, maMode, indicators, effPanes, styleEpoch, height, ready]);

  // Base overlay — dashed rectangle over the consolidation range
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (overlayIdRef.current != null) {
      chart.removeOverlay({ id: overlayIdRef.current });
      overlayIdRef.current = null;
    }
    if (!base) return;
    const t = readTheme();
    ensureBaseRectOverlay();
    const created = chart.createOverlay({
      name: "baseRect",
      points: [
        { timestamp: toMillis(base.startDate), value: base.high },
        { timestamp: toMillis(base.endDate), value: base.low },
      ],
      styles: {
        rect: {
          style: "fill",
          color: hexToRgba(t.base, 0.08),
          borderColor: t.base,
          borderSize: 1,
          borderStyle: "dashed",
          borderDashedValue: [4, 4],
        },
      },
    });
    // createOverlay's typings allow an array overload — narrow to a single id
    overlayIdRef.current = typeof created === "string" ? created : null;
  }, [base]);

  const fmtNum = (v: number | undefined, digits = 2) =>
    v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtVol = (v: number | undefined) => {
    if (v == null) return "—";
    if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
    return v.toFixed(0);
  };

  if (candles.length < 5) {
    return (
      <div className={cn("flex h-40 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-600", className)} style={variant === "card" ? { height } : undefined}>
        Chart unavailable — bars are still syncing in the background.
      </div>
    );
  }

  const switchTf = (next: ChartTimeframe) => {
    setInternalTf(next);
    onTimeframeChange?.(next);
  };

  // Default readout = latest bar (derived); a crosshair hover overrides it
  const lastCandle = candles.length ? candles[candles.length - 1] : null;
  const shown = readout ?? lastCandle;
  const chg = shown ? shown.close - shown.open : 0;
  const chgPct = shown && shown.open ? (chg / shown.open) * 100 : 0;
  const up = chg >= 0;

  return (
    <div className={cn("relative w-full select-none", className)}>
      {/* toolbar — reference-style: timeframe + pane toggles (hidden on clean grid cards) */}
      {variant === "full" && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex overflow-hidden rounded-md border border-zinc-800">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.id}
                onClick={() => switchTf(t.id)}
                aria-pressed={tf === t.id}
                className={cn(
                  "cursor-pointer px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  tf === t.id ? "bg-brand text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {CHART_INDICATORS.map((key) => (
              <button
                key={key}
                onClick={() => setPanes((p) => ({ ...p, [key]: !p[key] }))}
                aria-pressed={panes[key]}
                className={cn(
                  "cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  panes[key] ? "border-brand/40 bg-brand/10 text-brand-text" : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                )}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* live OHLCV readout — follows the crosshair like the reference site (full variant only) */}
      {variant === "full" && (
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px]">
          {shown ? (
            <>
              <span className="text-zinc-500">{shown.date}</span>
              <span className="text-zinc-400">O <span className="text-zinc-200">{fmtNum(shown.open)}</span></span>
              <span className="text-zinc-400">H <span className="text-zinc-200">{fmtNum(shown.high)}</span></span>
              <span className="text-zinc-400">L <span className="text-zinc-200">{fmtNum(shown.low)}</span></span>
              <span className="text-zinc-400">C <span className="text-zinc-200">{fmtNum(shown.close)}</span></span>
              <span className={up ? "text-profit" : "text-loss"}>
                {up ? "+" : ""}{fmtNum(chg)} ({up ? "+" : ""}{chgPct.toFixed(2)}%)
              </span>
              <span className="text-zinc-400">Vol <span className="text-zinc-200">{fmtVol(shown.volume)}</span></span>
            </>
          ) : (
            <span className="text-zinc-600">Hover the chart for OHLCV details</span>
          )}
        </div>
      )}

      <div ref={containerRef} style={{ height }} className="relative w-full select-none overflow-hidden" />

      {/* base formation duration — the overlay's companion readout */}
      {showBase && base && baseChip && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 font-medium"
            style={{ borderColor: "var(--gold, #d4a72c)", color: "var(--gold-text, #8a6512)" }}
          >
            <span className="inline-block h-2 w-3 rounded-sm" style={{ border: "1px dashed var(--gold, #d4a72c)", background: "rgba(212,167,44,0.15)" }} />
            {base.status === "in-base" ? "Base forming" : "Breakout"} · {base.days} sessions · {base.depthPct}% deep
          </span>
          <span className="text-zinc-600">since {base.startDate}</span>
        </div>
      )}
    </div>
  );
}
