/**
 * Scheduler date-math unit tests. Run: bun scripts/test-scheduler.ts
 */
import { nextRunAt, lastRunBoundary, shouldCatchUp } from "../src/lib/scheduler";

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

// 16:00 IST == 10:30 UTC
function utc(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(Date.UTC(y, m, d, h, min));
}
function isMonFri16ist(d: Date): boolean {
  return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && d.getUTCHours() === 10 && d.getUTCMinutes() === 30;
}

// Wednesday 2026-09-23 08:00 UTC (1:30 pm IST) -> same day 10:30 UTC
eq("midday weekday -> same day", nextRunAt(utc(2026, 8, 23, 8, 0)).toISOString(), "2026-09-23T10:30:00.000Z");
// Wednesday 2026-09-23 11:00 UTC (after 4 pm) -> Thursday
eq("after fire weekday -> next day", nextRunAt(utc(2026, 8, 23, 11, 0)).toISOString(), "2026-09-24T10:30:00.000Z");
// Friday 2026-09-25 11:00 UTC -> Monday
eq("friday after fire -> monday", nextRunAt(utc(2026, 8, 25, 11, 0)).toISOString(), "2026-09-28T10:30:00.000Z");
// Saturday -> Monday
eq("saturday -> monday", nextRunAt(utc(2026, 8, 26, 5, 0)).toISOString(), "2026-09-28T10:30:00.000Z");
// Sunday -> Monday
eq("sunday -> monday", nextRunAt(utc(2026, 8, 27, 5, 0)).toISOString(), "2026-09-28T10:30:00.000Z");
// exactly at fire time -> next day (strictly after now)
eq("at fire -> next day", nextRunAt(utc(2026, 8, 23, 10, 30)).toISOString(), "2026-09-24T10:30:00.000Z");

// every next run is a valid Mon-Fri 16:00 IST instant
for (let i = 0; i < 30; i++) {
  const now = new Date(Date.UTC(2026, 8, 1 + i, 3, 15));
  if (!isMonFri16ist(nextRunAt(now))) {
    eq(`nextRunAt valid for day ${i + 1}`, false, true);
  }
}
passed++; // validity sweep

// lastRunBoundary
eq("boundary midday", lastRunBoundary(utc(2026, 8, 23, 8, 0)).toISOString(), "2026-09-22T10:30:00.000Z");
eq("boundary after fire", lastRunBoundary(utc(2026, 8, 23, 11, 0)).toISOString(), "2026-09-23T10:30:00.000Z");
eq("boundary saturday", lastRunBoundary(utc(2026, 8, 26, 5, 0)).toISOString(), "2026-09-25T10:30:00.000Z");
eq("boundary sunday", lastRunBoundary(utc(2026, 8, 27, 12, 0)).toISOString(), "2026-09-25T10:30:00.000Z");

// shouldCatchUp
const boundary = utc(2026, 8, 23, 10, 30); // Wed 4pm IST
eq("catch-up: stale data + old sync", shouldCatchUp(utc(2026, 8, 23, 12, 0), utc(2026, 8, 22, 10, 0), utc(2026, 8, 22, 9, 0)), true);
eq("catch-up: fresh data", shouldCatchUp(utc(2026, 8, 23, 12, 0), utc(2026, 8, 23, 10, 45), utc(2026, 8, 22, 9, 0)), false);
eq("catch-up: sync already ran after boundary", shouldCatchUp(utc(2026, 8, 23, 12, 0), utc(2026, 8, 22, 10, 0), utc(2026, 8, 23, 10, 45)), false);
eq("catch-up: no data yet", shouldCatchUp(utc(2026, 8, 23, 12, 0), null, utc(2026, 8, 22, 9, 0)), false);
eq("catch-up: no sync state", shouldCatchUp(utc(2026, 8, 23, 12, 0), utc(2026, 8, 22, 10, 0), null), false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
