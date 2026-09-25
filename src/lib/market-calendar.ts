/**
 * Market calendar seed: NSE holidays, special sessions, F&O monthly expiries
 * (holiday-aware), macro events (RBI MPC, FOMC, Union Budget) and
 * earnings-season windows. Idempotent — upsert-once per key per boot.
 *
 * Lunar-tied holidays and unannounced dates are flagged `tentative` and
 * surface in the UI as "(expected)" until NSE/RBI circulars confirm them.
 */

import { db } from "@/lib/db";

export interface SeedEvent {
  key: string;
  date: string; // YYYY-MM-DD
  endDate?: string;
  title: string;
  category: "holiday" | "market" | "expiry" | "macro" | "earnings" | "other";
  impact: "high" | "medium" | "low";
  source?: string;
  tentative?: boolean;
  description?: string;
  details?: string;
}

const HOLIDAY = (
  key: string,
  date: string,
  title: string,
  description: string,
  details: string,
  tentative = false
): SeedEvent => ({
  key,
  date,
  title,
  category: "holiday",
  impact: "high",
  source: "NSE",
  tentative,
  description,
  details,
});

function seedEvents(): SeedEvent[] {
  const events: SeedEvent[] = [];

  // ---- Remaining 2026 NSE holidays (per NSE list) ----
  events.push(
    HOLIDAY(
      "nse-holiday-2026-10-02",
      "2026-10-02",
      "Gandhi Jayanti",
      "Market closed — national holiday.",
      "No trading on NSE/BSE. Plan positions around the long weekend; gaps on reopen can be larger than usual after a two-day information break."
    ),
    HOLIDAY(
      "nse-holiday-2026-10-20",
      "2026-10-20",
      "Dussehra",
      "Market closed — national holiday.",
      "Listed in the NSE holiday calendar. Reduced global sessions behind you on reopen — check Friday-close-to-Tuesday-open gaps before holding aggressive overnight risk."
    ),
    HOLIDAY(
      "nse-muhurat-2026-11-08",
      "2026-11-08",
      "Diwali Muhurat trading",
      "Special evening session for Diwali (Lakshmi Pujan) — tentative timing, usually ~1.5 h after sunset.",
      "Symbolic session with live settlement. Liquidity is thinner than a normal session; most participants do token longs. Confirm exact slot from the NSE circular.",
      true
    ),
    HOLIDAY(
      "nse-holiday-2026-11-09",
      "2026-11-09",
      "Balipratipada (Diwali)",
      "Market closed — Diwali observance.",
      "Back-to-back with the Muhurat session — the effective trading week is broken. Adjust swing stops and option expiry risk around the gap."
    ),
    HOLIDAY(
      "nse-holiday-2026-11-24",
      "2026-11-24",
      "Gurunanak Jayanti",
      "Market closed — national holiday.",
      "No trading. November F&O expiry moves a day earlier when expiry day is a holiday."
    ),
    HOLIDAY(
      "nse-holiday-2026-12-25",
      "2026-12-25",
      "Christmas",
      "Market closed — national holiday.",
      "Year-end liquidity thins out globally too — position sizes deserve a haircut into the last week."
    )
  );

  // ---- 2027 fixed-date holidays announced in the NSE list ----
  events.push(
    HOLIDAY(
      "nse-holiday-2027-01-26",
      "2027-01-26",
      "Republic Day",
      "Market closed — national holiday.",
      "Falls on a Tuesday in 2027 — weekly F&O expiry shifts to the previous trading day; plan expiry-week trades accordingly."
    ),
    HOLIDAY(
      "nse-holiday-2027-03-26",
      "2027-03-26",
      "Good Friday",
      "Market closed — religious observance.",
      "Long weekend for Indian markets while US markets trade normally — review global positions before the break."
    ),
    HOLIDAY(
      "nse-holiday-2027-04-14",
      "2027-04-14",
      "Dr. Ambedkar Jayanti",
      "Market closed — observance.",
      "Mid-week break; earnings-season activity usually peaks around this window."
    )
  );

  // ---- Macro events ----
  events.push(
    {
      key: "rbi-mpc-2026-dec",
      date: "2026-12-09",
      endDate: "2026-12-11",
      title: "RBI Monetary Policy Committee",
      category: "macro",
      impact: "high",
      source: "RBI",
      tentative: true,
      description: "Bi-monthly rate decision + Governor press conference.",
      details: "Banks, NBFCs and rate-sensitive sectors (auto, realty, metals) reprice on the statement. Expect volatility in NIFTY BANK around the decision hour — avoid fresh leverage into the announcement."
    },
    {
      key: "rbi-mpc-2027-feb",
      date: "2027-02-03",
      endDate: "2027-02-05",
      title: "RBI Monetary Policy Committee",
      category: "macro",
      impact: "high",
      source: "RBI",
      tentative: true,
      description: "Bi-monthly rate decision + Governor press conference.",
      details: "First MPC of the calendar year. Watch liquidity commentary and growth-inflation projections — bond yields and bank Nifty react first."
    },
    {
      key: "fomc-2026-oct",
      date: "2026-10-27",
      endDate: "2026-10-28",
      title: "US Federal Reserve — FOMC meeting",
      category: "macro",
      impact: "high",
      source: "Federal Reserve",
      description: "US rate decision and presser (published schedule).",
      details: "Nifty opens gap against the Fed outcome the next morning. If you hold leveraged overnight positions through FOMC, know your gap risk in advance."
    },
    {
      key: "fomc-2026-dec",
      date: "2026-12-08",
      endDate: "2026-12-09",
      title: "US Federal Reserve — FOMC meeting",
      category: "macro",
      impact: "high",
      source: "Federal Reserve",
      description: "US rate decision with updated dot plot (published schedule).",
      details: "December FOMC carries the Summary of Economic Projections — the dots move global markets. Nifty IT and metals are the most sensitive NSE segments."
    },
    {
      key: "union-budget-2027",
      date: "2027-02-01",
      title: "Union Budget 2027-28",
      category: "macro",
      impact: "high",
      source: "Ministry of Finance",
      tentative: true,
      description: "Annual financial statement + capital-market-relevant announcements.",
      details: "Intraday volatility is extreme on Budget day. Prepare a scenario plan (duty changes, capex thrust, tax tweaks) instead of predicting — trade the reaction, not the guess."
    }
  );

  // ---- Earnings-season windows ----
  events.push(
    {
      key: "earnings-q2-fy27",
      date: "2026-10-08",
      endDate: "2026-10-24",
      title: "Q2 FY27 earnings season",
      category: "earnings",
      impact: "high",
      source: "TradePulse",
      description: "September-quarter results window — IT kicks off, banks and autos follow.",
      details: "Check the earnings calendar before holding any swing through a result date. Post-result gap risk cuts both ways; the EOD routine is where you decide hold vs exit before the print."
    },
    {
      key: "earnings-q3-fy27",
      date: "2027-01-08",
      endDate: "2027-01-30",
      title: "Q3 FY27 earnings season",
      category: "earnings",
      impact: "high",
      source: "TradePulse",
      description: "December-quarter results — the season that decides FMCG/consumer narratives.",
      details: "Management commentary on demand and margins moves mid-caps more than the headline numbers do. Scan for post-earnings drift setups the day AFTER results."
    },
    {
      key: "earnings-q4-fy27",
      date: "2027-04-08",
      endDate: "2027-04-30",
      title: "Q4 FY27 earnings season",
      category: "earnings",
      impact: "high",
      source: "TradePulse",
      description: "March-quarter + full-year results — dividend and bonus announcements cluster here.",
      details: "Year-end prints set the tone for the new fiscal. Watch for ex-dividend dates and guidance resets; they create the cleanest EOD watchlist candidates."
    }
  );

  // ---- Monthly F&O expiries (holiday-aware, generated) ----
  // NSE moved monthly expiry to the last Tuesday of the month (2025 onwards);
  // when the last Tuesday is a holiday the expiry walks back a day.
  const holidayDates = new Set(events.filter((e) => e.category === "holiday").map((e) => e.date));
  let cursor = new Date("2026-10-01T00:00:00Z");
  const end = new Date("2027-12-31T00:00:00Z");
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    // last Tuesday of the month
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let tuesday = lastDay;
    while (new Date(Date.UTC(y, m, tuesday)).getUTCDay() !== 2) tuesday--;
    let expiryDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(tuesday).padStart(2, "0")}`;
    let shiftNote = "";
    // walk back over holidays
    while (holidayDates.has(expiryDate)) {
      let d = tuesday - 1;
      tuesday = d;
      expiryDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      shiftNote = " (shifted — expiry day is a trading holiday)";
    }
    const key = `fno-expiry-${y}-${String(m + 1).padStart(2, "0")}`;
    if (!events.some((e) => e.key === key)) {
      events.push({
        key,
        date: expiryDate,
        title: `Monthly F&O expiry — ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${y}${shiftNote}`,
        category: "expiry",
        impact: "medium",
        source: "NSE",
        description: "Monthly futures & options contract expiry (last Tuesday; walks back over holidays).",
        details: "Expiry-day theta burns option buyers; expect elevated whipsaw in the last trading hour. If you sell options, respect margin spikes; if you trade the underlying, wait for the first 30 minutes to settle."
      });
    }
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }

  return events;
}

let seededThisBoot = false;

/** Idempotent seed — upserts every event by its stable key. */
export async function ensureCalendarSeed(): Promise<void> {
  if (seededThisBoot) return;
  seededThisBoot = true;
  try {
    const events = seedEvents();
    for (const e of events) {
      const data = {
        date: e.date,
        endDate: e.endDate ?? null,
        title: e.title,
        category: e.category,
        impact: e.impact,
        source: e.source ?? null,
        tentative: e.tentative ?? false,
        description: e.description ?? null,
        details: e.details ?? null,
      };
      const existing = await db.marketEvent.findUnique({ where: { key: e.key } });
      if (!existing) {
        await db.marketEvent.create({ data: { key: e.key, ...data } });
      } else if (existing.tentative && !e.tentative) {
        // a previously expected date got confirmed — refresh it
        await db.marketEvent.update({ where: { key: e.key }, data });
      }
    }
    console.log(`[calendar] seeded ${events.length} market events`);
  } catch (e) {
    seededThisBoot = false;
    console.error("[calendar] seed failed:", e instanceof Error ? e.message : e);
  }
}
