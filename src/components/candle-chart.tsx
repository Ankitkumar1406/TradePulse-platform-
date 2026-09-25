"use client";

import dynamic from "next/dynamic";

/**
 * SSR-safe wrapper for the KLineChart implementation. klinecharts touches
 * `window` at module evaluation, so the real component lives in
 * kline-chart.tsx and is loaded browser-side only.
 */

export type { Candle, CandleChartProps } from "./kline-chart";
export type { ChartTimeframe } from "./kline-chart";

const CandleChart = dynamic(() => import("./kline-chart").then((m) => m.CandleChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-600">
      Loading chart…
    </div>
  ),
});

export { CandleChart };
