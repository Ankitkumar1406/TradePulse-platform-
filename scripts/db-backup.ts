/// <reference types="bun-types" />
/**
 * db-backup.ts — consistent online snapshot of the live SQLite database.
 * Uses SQLite's VACUUM INTO so it is safe to run while the dev server
 * keeps writing (WAL mode) — produces a compacted, self-contained .db file.
 *
 * Usage: bun scripts/db-backup.ts [outfile]
 */
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, statSync } from "node:fs";

const src = "/home/z/my-project/db/custom.db";
const stamp = new Date().toISOString().slice(0, 10);
const out = process.argv[2] ?? `/home/z/my-project/backups/custom-${stamp}.db`;

mkdirSync("/home/z/my-project/backups", { recursive: true });

const t0 = Date.now();
const source = new Database(src, { readonly: true });
try {
  rmSync(out, { force: true }); // VACUUM INTO refuses existing targets
  source.exec(`VACUUM INTO '${out}'`);
  const mb = (statSync(out).size / 1e6).toFixed(1);
  console.log(`backup ok: ${out} (${mb} MB, ${Date.now() - t0} ms)`);
} catch (e) {
  console.error("backup FAILED:", e);
  process.exit(1);
} finally {
  source.close();
}
