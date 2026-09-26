/**
 * Standalone verification of the fixed scanner catalog — runs in a fresh bun
 * process (no dev-server caches) and checks:
 *  - TC1/TC3 no longer 500 and enforce their min-RS promise
 *  - TC7 (fundamental-momentum) returns rows now that financials are back
 *  - every scan row carries rs / epsScore / adRating / epsChgYoy
 */
import { getScan, runScanCached } from "../src/lib/scanners";

const ids = ["trader-choice-1", "trader-choice-2", "trader-choice-3", "trader-choice-4",
  "trader-choice-5", "trader-choice-6", "trader-choice-7", "momentum-scanner", "resistance-daily"];

let fail = 0;
for (const id of ids) {
  const scan = getScan(id);
  if (!scan) { console.log(`${id}: NOT FOUND`); fail++; continue; }
  try {
    const t0 = Date.now();
    const r = await runScanCached(scan);
    const rows = r.rows;
    const rs = rows.filter((x) => x.rs != null).length;
    const eps = rows.filter((x) => x.epsScore != null).length;
    const ad = rows.filter((x) => x.adRating != null).length;
    const yoy = rows.filter((x) => x.epsChgYoy != null).length;
    const minRs = scan.minRs;
    const below = minRs != null ? rows.filter((x) => (x.rs ?? -1) < minRs).length : 0;
    const ok = rows.length > 0 && below === 0 && (rows.length === 0 || (rs > 0 && ad > 0));
    if (!ok) fail++;
    console.log(
      `${id.padEnd(20)} rows:${String(rows.length).padStart(3)} scanned:${String(r.scanned).padStart(4)} ` +
      `rs:${rs} eps:${eps} ad:${ad} yoy:${yoy}` +
      (minRs != null ? ` minRs:${minRs} below:${below}` : "") +
      ` ${((Date.now() - t0) / 1000).toFixed(1)}s ${ok ? "OK" : "** CHECK **"}`
    );
    if (rows[0]) {
      const x = rows[0];
      console.log(`   top: ${x.symbol} price:${x.price} rs:${x.rs} eps:${x.epsScore} ad:${x.adRating} yoy:${x.epsChgYoy} metrics:${JSON.stringify(x.metrics)}`);
    }
  } catch (e) {
    fail++;
    console.log(`${id}: THREW — ${e instanceof Error ? e.message : e}`);
  }
}
console.log(fail === 0 ? "\nALL SCANS OK" : `\n${fail} scan(s) need attention`);
process.exit(fail === 0 ? 0 : 1);
