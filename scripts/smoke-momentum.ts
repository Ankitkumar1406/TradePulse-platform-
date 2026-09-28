/// <reference types="bun-types" />
/**
 * Smoke test: run the full sector-momentum engine (live indices + composites
 * + sector medians) against the live DB and print the ranked output.
 *   bun run scripts/smoke-momentum.ts [--force]
 */
import { getSectorMomentum } from "../src/lib/sector-momentum";

const force = process.argv.includes("--force");

async function main() {
  const t0 = Date.now();
  const data = await getSectorMomentum(force);
  console.log(`compute: ${((Date.now() - t0) / 1000).toFixed(1)}s · asOf=${data.asOf}\n`);

  console.log("== INDICES (ranked by composite strength) ==");
  for (const r of data.indices) {
    console.log(
      `#${String(r.rank).padStart(2)} ${r.name.padEnd(20)} ${r.source.padEnd(9)} d=${fmt(r.dailyRSI)}${arr(r.dDelta)} w=${fmt(r.weeklyRSI)}${arr(r.wDelta)} m=${fmt(r.monthlyRSI)}${arr(r.mDelta)} 1D=${fmt(r.change1D)} 5D=${fmt(r.change5D)} b50=${r.breadthAbove50 ?? "—"}% ${r.classification ?? "insuf"}`,
    );
  }
  console.log("\n== SECTORS (median of top-15 constituents) ==");
  for (const r of data.sectors) {
    console.log(
      `#${String(r.rank).padStart(2)} ${r.name.padEnd(22)} d=${fmt(r.dailyRSI)}${arr(r.dDelta)} w=${fmt(r.weeklyRSI)}${arr(r.wDelta)} m=${fmt(r.monthlyRSI)}${arr(r.mDelta)} 1D=${fmt(r.change1D)} b50=${r.breadthAbove50 ?? "—"}% ${r.classification ?? "insuf"} n=${r.constituents}`,
    );
  }

  const anyComposite = data.indices.find((r) => r.source === "composite");
  console.log("\nsample of", anyComposite?.name, ":", JSON.stringify(anyComposite?.sample?.slice(0, 3)));
  console.log("movers of", anyComposite?.name, ":", JSON.stringify(anyComposite?.movers));
  await (await import("../src/lib/db")).db.$disconnect();
}

const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const arr = (v: number | null) => (v == null ? "" : `(${v >= 0 ? "+" : ""}${v.toFixed(1)})`);

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
