"use client";

import {
  Area, AreaChart, Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * Breadth analytics for the Market breadth page — charts + breakdowns backed
 * by /api/market/breadth-history (bars-derived per-session breadth).
 */

export interface HistoryRow {
  date: string;
  adv: number;
  dec: number;
  above20: number;
  above50: number;
  above200: number;
  nh: number;
  nl: number;
}

export interface Breakdown {
  count: number;
  adv: number;
  dec: number;
  above20: number;
  above50: number;
  above200: number;
  pctAbove20: number;
  pctAbove50: number;
  pctAbove200: number;
}

export interface BreadthAnalytics {
  history: HistoryRow[];
  lastFullDate: string | null;
  asOf: string | null;
  sectors: (Breakdown & { sector: string })[];
  segments: { large: Breakdown; mid: Breakdown; small: Breakdown };
  fno: { fno: Breakdown; rest: Breakdown };
}

const EMERALD = "#34d399";
const RED = "#f87171";
const GRID = "#27272a";
const TEXT = "#71717a";

const fmtDay = (d: string) => d.slice(8) + "/" + d.slice(5, 7);
const fmtLong = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Tiny trend line for stat tiles (1-month window). */
export function Sparkline({ values, tone = "neutral" }: { values: number[]; tone?: "up" | "down" | "neutral" }) {
  if (values.length < 2) return <div className="h-[26px]" />;
  const data = values.map((v, i) => ({ i, v }));
  const color = tone === "up" ? EMERALD : tone === "down" ? RED : "#8b8b93";
  return (
    <div className="-mx-1 mt-1 h-[26px]" aria-hidden="true">
      <ResponsiveContainer width="100%" height={26}>
        <AreaChart data={data} margin={{ top: 3, right: 2, bottom: 0, left: 2 }}>
          <Area
            type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.14}
            strokeWidth={1.4} isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  fontSize: 11,
  color: "#e4e4e7",
  padding: "6px 10px",
} as const;

/** Cumulative Advance/Decline line over the available session history. */
export function ADLineCard({ history }: { history: HistoryRow[] }) {
  // Cumulative advances − declines per session (no callback mutation).
  const data: { date: string; cum: number; adv: number; dec: number }[] = [];
  let cum = 0;
  for (const h of history) {
    cum += h.adv - h.dec;
    data.push({ date: h.date, cum, adv: h.adv, dec: h.dec });
  }
  if (data.length < 3) return null;
  const last = data[data.length - 1];
  const monthStarts = new Set<string>();
  let prevMonth = "";
  for (const d of data) {
    const m = d.date.slice(0, 7);
    if (m !== prevMonth) { monthStarts.add(d.date); prevMonth = m; }
  }

  return (
    <Card padding>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-zinc-200">Advance / Decline line</div>
          <div className="text-[10px] text-zinc-500">Cumulative advances − declines · last {data.length} sessions</div>
        </div>
        <div className="text-right">
          <span className={`font-mono text-sm font-semibold ${last.cum >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {last.cum >= 0 ? "+" : ""}{last.cum.toLocaleString("en-IN")}
          </span>
          <span className="block text-[10px] text-zinc-600">
            {fmtLong(last.date)} · {last.adv.toLocaleString("en-IN")} ▲ / {last.dec.toLocaleString("en-IN")} ▼
          </span>
        </div>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="adFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3} />
                <stop offset="100%" stopColor={EMERALD} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date" tickFormatter={(v: string) => (monthStarts.has(v) ? v.slice(5, 7) : "")}
              tick={{ fill: TEXT, fontSize: 9 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" minTickGap={8}
            />
            <YAxis
              width={52} tick={{ fill: TEXT, fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => v.toLocaleString("en-IN")} domain={["auto", "auto"]}
            />
            <ReferenceLine y={0} stroke="#52525b" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => fmtLong(String(v))}
              formatter={(value, name) =>
                name === "cum"
                  ? [(Number(value) >= 0 ? "+" : "") + Number(value).toLocaleString("en-IN"), "cumulative A/D"]
                  : [value, name]
              }
            />
            <Area
              type="monotone" dataKey="cum" name="cum" stroke={EMERALD} strokeWidth={1.6}
              fill="url(#adFill)" isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/** New highs vs new lows — 21-session differential bars + streak caption. */
export function NhNlCard({ history }: { history: HistoryRow[] }) {
  if (history.length < 4) return null;
  const tail = history.slice(-21);
  const data = tail.map((h) => ({ date: h.date, diff: h.nh - h.nl, nh: h.nh, nl: h.nl }));
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const rising = last.diff > prev.diff;
  // Consecutive sessions (ending at the latest) where the differential moved
  // the same direction as it did most recently.
  let streak = 0;
  for (let i = data.length - 1; i > 0; i--) {
    const wentUp = data[i].diff > data[i - 1].diff;
    if (wentUp === rising) streak++;
    else break;
  }
  const weeks = `${fmtLong(data[0].date)} – ${fmtLong(last.date)}`;

  return (
    <Card padding>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-zinc-200">New highs vs lows</div>
          <div className="text-[10px] text-zinc-500">52-week high − low count · {weeks}</div>
        </div>
        <div className="text-right">
          <span className={`font-mono text-sm font-semibold ${last.diff >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {last.diff >= 0 ? "+" : ""}{last.diff.toLocaleString("en-IN")}
          </span>
          <span className="block text-[10px] text-zinc-600">
            {last.nh.toLocaleString("en-IN")} NH / {last.nl.toLocaleString("en-IN")} NL
          </span>
        </div>
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date" tickFormatter={(v: string) => (v === data[0].date || v === data[data.length - 1].date ? fmtDay(v) : "")}
              tick={{ fill: TEXT, fontSize: 9 }} axisLine={{ stroke: GRID }} tickLine={false}
            />
            <YAxis width={40} tick={{ fill: TEXT, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v.toLocaleString("en-IN")} />
            <ReferenceLine y={0} stroke="#52525b" />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => fmtLong(String(v))}
              formatter={(value, _name, item) => [
                `+${Number(item?.payload?.nh ?? 0).toLocaleString("en-IN")} / −${Number(item?.payload?.nl ?? 0).toLocaleString("en-IN")}`,
                "NH / NL",
              ]}
            />
            <Bar dataKey="diff" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.date} fill={d.diff >= 0 ? EMERALD : RED} fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className={`mt-1.5 text-[10px] ${rising ? "text-emerald-400" : "text-red-400"}`}>
        {rising ? "▲" : "▼"} differential {rising ? "rising" : "falling"} for {streak} session{streak === 1 ? "" : "s"}
        <span className="text-zinc-600"> — participation {rising ? "improving" : "weakening"}</span>
      </p>
    </Card>
  );
}

/** Sector-wise breadth heatmap — % of stocks above their 50 SMA. */
export function SectorBreadthGrid({ sectors }: { sectors: BreadthAnalytics["sectors"] }) {
  const tone = (pct: number) =>
    pct >= 60 ? "text-emerald-400" : pct >= 45 ? "text-zinc-100" : pct >= 30 ? "text-amber-400" : "text-red-400";
  const barTone = (pct: number) =>
    pct >= 60 ? "bg-emerald-500/80" : pct >= 45 ? "bg-zinc-400/80" : pct >= 30 ? "bg-amber-500/80" : "bg-red-500/80";

  return (
    <Card padding>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-zinc-200">Sector breadth</div>
          <div className="text-[10px] text-zinc-500">% of stocks above 50 SMA per sector — for rotation decisions</div>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-zinc-600">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/80" /> ≥60%
          <span className="inline-block h-2 w-2 rounded-sm bg-zinc-400/80" /> 45-59
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-500/80" /> 30-44
          <span className="inline-block h-2 w-2 rounded-sm bg-red-500/80" /> &lt;30%
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {sectors.map((s) => (
          <div
            key={s.sector}
            title={`${s.sector}: ${s.above50}/${s.count} above 50 SMA · ${s.above20}/${s.count} above 20 SMA · today ${s.adv}▲ / ${s.dec}▼`}
            className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-2"
          >
            <div className="truncate text-[10px] font-medium text-zinc-400">{s.sector}</div>
            <div className={`font-mono text-lg font-bold leading-tight ${tone(s.pctAbove50)}`}>
              {s.pctAbove50}<span className="text-[10px] text-zinc-600">%</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className={`h-full ${barTone(s.pctAbove50)}`} style={{ width: `${s.pctAbove50}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[9px] text-zinc-600">
              <span className="font-mono">
                <span className="text-emerald-500">{s.adv}</span>/<span className="text-red-500">{s.dec}</span>
              </span>
              <span>20D {s.pctAbove20}%</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Market-cap segmented breadth (AMFI ranks) + F&O vs non-F&O split. */
export function SegmentCards({ segments, fno }: { segments: BreadthAnalytics["segments"]; fno: BreadthAnalytics["fno"] }) {
  const rows = [
    { label: "Large cap", hint: "top 100 by mcap", d: segments.large },
    { label: "Mid cap", hint: "rank 101–250", d: segments.mid },
    { label: "Small cap", hint: "rank 250+", d: segments.small },
  ];
  const fnoRows = [
    { label: "F&O universe", hint: "derivatives-eligible (approx.)", d: fno.fno },
    { label: "Non-F&O", hint: "rest of the universe", d: fno.rest },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card padding>
        <div className="mb-2">
          <div className="text-xs font-semibold text-zinc-200">Breadth by market cap</div>
          <div className="text-[10px] text-zinc-500">Large vs small divergence — hidden in headline numbers</div>
        </div>
        <SegmentRows rows={rows} />
      </Card>
      <Card padding>
        <div className="mb-2">
          <div className="text-xs font-semibold text-zinc-200">F&O vs non-F&O</div>
          <div className="text-[10px] text-zinc-500">Tradeable-with-leverage universe vs the rest</div>
        </div>
        <SegmentRows rows={fnoRows} />
        <p className="mt-2 text-[9px] text-zinc-600">
          F&O membership is an approximated list of long-standing derivatives names — verify on nseindia.com before trading.
        </p>
      </Card>
    </div>
  );
}

function SegmentRows({ rows }: { rows: { label: string; hint: string; d: Breakdown }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.d.count));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="font-medium text-zinc-300">
              {r.label} <span className="text-[9px] text-zinc-600">{r.hint}</span>
            </span>
            <span className="font-mono text-zinc-500">
              <span className="text-emerald-500">{r.d.adv.toLocaleString("en-IN")}▲</span>
              {" / "}
              <span className="text-red-500">{r.d.dec.toLocaleString("en-IN")}▼</span>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={r.d.pctAbove50 >= 50 ? "h-full bg-emerald-500/80" : r.d.pctAbove50 >= 35 ? "h-full bg-amber-500/80" : "h-full bg-red-500/80"}
                style={{ width: `${r.d.pctAbove50}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right font-mono text-[10px] text-zinc-500">
              {r.d.pctAbove50}% &gt;50SMA
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-[10px] text-zinc-600">
              {r.d.count.toLocaleString("en-IN")}{r.d.count >= max ? "" : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({ children, padding }: { children: React.ReactNode; padding?: boolean }) {
  return (
    <div className={padding ? "rounded-lg border border-zinc-800 bg-zinc-900/60 p-4" : "rounded-lg border border-zinc-800 bg-zinc-900/60"}>
      {children}
    </div>
  );
}
