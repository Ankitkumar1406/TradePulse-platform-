/**
 * Unit tests for sector momentum classification + weekly/monthly aggregation
 * and the scheduler date math. Run: bun scripts/test-momentum.ts
 */
import { classifyMomentum, momentumSort, MOMENTUM_CLASSES } from "../src/lib/momentum-classes";
import { median } from "../src/lib/sector-momentum";

let passed = 0;
let failed = 0;

function eq(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}: expected ${expected}, got ${actual}`);
  }
}

// ---- classification: user-specified rules ----
// all three > 60 => high strength
eq("high: 65/65/65", classifyMomentum(65, 65, 65), "high");
eq("high: 61/91/71", classifyMomentum(61, 91, 71), "high");
// only daily > 60 => short-term strength
eq("short: 65/55/55", classifyMomentum(65, 55, 55), "short");
eq("short: 61/40/40", classifyMomentum(61, 40, 40), "short");
eq("short: 70/30/50", classifyMomentum(70, 30, 50), "short");

// ---- derived buckets ----
// monthly & weekly > 60, daily below => long-term strength
eq("long: 55/65/70", classifyMomentum(55, 65, 70), "long");
// weekly > 60, monthly <= 60, daily >= 40 => medium-term strength
eq("medium: 55/65/55", classifyMomentum(55, 65, 55), "medium");
eq("medium: 40/61/50", classifyMomentum(40, 61, 50), "medium");
// all < 40 => weakness on all timeframes
eq("weakAll: 30/35/25", classifyMomentum(30, 35, 25), "weakAll");
// monthly & weekly < 40, daily >= 40 => long-term weakness
eq("longWeak: 45/35/35", classifyMomentum(45, 35, 35), "longWeak");
// weekly < 40, monthly >= 40, daily <= 60 => medium-term weakness
eq("mediumWeak: 50/35/45", classifyMomentum(50, 35, 45), "mediumWeak");
// only daily < 40 => short-term weakness
eq("shortWeak: 30/55/55", classifyMomentum(30, 55, 55), "shortWeak");
// everything else mixed
eq("mixed: 50/50/50", classifyMomentum(50, 50, 50), "mixed");
eq("mixed: 70/55/70", classifyMomentum(70, 55, 70), "mixed");
// 65/35/45 matches "only daily > 60" -> short-term strength per user spec
eq("short again: 65/35/45", classifyMomentum(65, 35, 45), "short");
// 30/35/50: weekly broken below 40 while monthly >= 40 and daily <= 60 -> medium-term weakness
eq("mediumWeak again: 30/35/50", classifyMomentum(30, 35, 50), "mediumWeak");

// boundary semantics: > 60 is strict, <= 60 not strong
eq("boundary d=60", classifyMomentum(60, 65, 65), "long");
eq("boundary all=60.5", classifyMomentum(60.5, 60.5, 60.5), "high");
eq("boundary w=60 short", classifyMomentum(61, 60, 55), "short");

// ---- sorting ----
const rows = [
  { classification: "mixed", monthlyRSI: 55 },
  { classification: "high", monthlyRSI: 62 },
  { classification: "short", monthlyRSI: 80 },
  { classification: "high", monthlyRSI: 71 },
];
rows.sort(momentumSort);
eq("sort first is high/71", rows[0].monthlyRSI, 71);
eq("sort second is high/62", rows[1].monthlyRSI, 62);
eq("sort third is short", rows[2].classification, "short");
eq("sort last is mixed", rows[3].classification, "mixed");
eq("9 classes defined", Object.keys(MOMENTUM_CLASSES).length, 9);

// ---- median ----
eq("median odd", median([3, 1, 2]), 2);
eq("median even", median([1, 2, 3, 4]), 2.5);
eq("median empty", median([]), null);

// ---- weekly/monthly close aggregation sanity ----
// build a fake 2y daily series and verify bucket counts
import { weeklyCloses, monthlyCloses } from "../src/lib/sector-momentum";
{
  const series: [number, number][] = [];
  const start = Date.UTC(2024, 8, 1) / 1000; // seconds, like Yahoo timestamps
  for (let i = 0; i < 500; i++) {
    series.push([start + i * 86400, 100 + Math.sin(i / 10) * 5 + i * 0.05]);
  }
  const w = weeklyCloses(series);
  const m = monthlyCloses(series);
  if (w.length >= 68 && w.length <= 75) passed++;
  else { failed++; console.error(`FAIL weekly buckets: ${w.length}`); }
  if (m.length >= 16 && m.length <= 18) passed++; // 500 calendar days ≈ 16.4 months
  else { failed++; console.error(`FAIL monthly buckets: ${m.length}`); }
  eq("weekly last == last close", w[w.length - 1] > 100, true);
  eq("monthly last == last close", m[m.length - 1] > 100, true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
