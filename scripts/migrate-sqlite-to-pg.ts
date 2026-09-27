/// <reference types="bun-types" />
/**
 * One-time migration: SQLite (db/custom.db) → PostgreSQL.
 *
 * Copies every table with explicit booleans/DateTime coercion (Prisma stores
 * SQLite DateTime as ISO text and Boolean as 0/1; the PG side wants real
 * Date/boolean values). DailyBar (~1.22M rows) is streamed by rowid pages and
 * inserted with createMany batches of 2,500 rows (~20k bind params per
 * statement, well under PostgreSQL's 65,535 limit).
 *
 *   bun run scripts/migrate-sqlite-to-pg.ts [--source db/custom.db] [--batch 2500]
 *
 * Idempotent: truncates the PG tables first. The SQLite file is left
 * untouched (it stays as a backup artifact).
 */
import { Database } from "bun:sqlite";
import { toPgSql } from "../src/lib/db";

// The platform shell exports a legacy file: DATABASE_URL; the shared client
// in src/lib/db resolves the project .env — reuse it so we hit PostgreSQL.
import { db as pg } from "../src/lib/db";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const SOURCE = arg("source", "db/custom.db");
const BATCH = Number(arg("batch", "2500"));

/** Tables in FK-safe order (User before its referencing children). */
const TABLES = [
  "User",
  "Payment",
  "SavedScreen",
  "JournalEntry",
  "WatchlistItem",
  "PriceAlert",
  "SyncState",
  "MarketEvent",
  "Stock",
  "DailyBar",
] as const;

/** Booleans per table — SQLite stores them as 0/1 integers. */
const BOOLS: Record<string, string[]> = {
  User: ["onboarded", "autoRenew"],
  Payment: ["renewal"],
  PriceAlert: ["active"],
  Stock: ["aboveSma20", "aboveSma50", "aboveSma200", "goldenCross", "emaCross", "volSpike"],
  StockMetrics: ["aboveSma20", "aboveSma50", "aboveSma200", "goldenCross", "emaCross", "volSpike"],
  ScanResult: [],
};

/** DateTime columns per table — coerce ISO text / epoch ints into Date. */
const DATES: Record<string, string[]> = {
  User: ["planExpiresAt", "trialEndsAt", "createdAt", "updatedAt"],
  Payment: ["paidAt", "createdAt", "updatedAt"],
  SavedScreen: ["createdAt"],
  JournalEntry: ["createdAt", "updatedAt"],
  WatchlistItem: ["createdAt"],
  PriceAlert: ["triggeredAt", "createdAt"],
  SyncState: ["ratingsSynced", "startedAt", "lastIngestAt", "lastQuoteTime", "metricsSyncedAt", "scansSyncedAt", "updatedAt"],
  MarketEvent: [],
  Stock: ["closesSynced", "barsSynced", "earningsDate", "earningsSynced", "sectorSynced", "financialsSynced", "quoteTime", "universeSynced", "createdAt", "updatedAt"],
  DailyBar: [],
};

function coerce(table: string, row: Record<string, unknown>): Record<string, unknown> {
  for (const f of BOOLS[table] ?? []) {
    const v = row[f];
    if (v === 1) row[f] = true;
    else if (v === 0) row[f] = false;
    // null stays null
  }
  for (const f of DATES[table] ?? []) {
    const v = row[f];
    if (v == null) continue;
    const d = v instanceof Date ? v : typeof v === "number" ? new Date(v) : new Date(String(v));
    if (Number.isNaN(d.getTime())) {
      console.warn(`  ! ${table}.${f} unparsable "${v}" → null`);
      row[f] = null;
    } else row[f] = d;
  }
  return row;
}

async function copyTable(sqlite: Database, table: string): Promise<number> {
  const cols = sqlite.query(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).all() as { name: string }[];
  const colList = cols.map((c) => `"${c.name}"`).join(", ");
  const total = (sqlite.query(`SELECT COUNT(*) AS n FROM "${table}"`).all() as { n: number }[])[0].n;
  if (total === 0) {
    console.log(`${table}: 0 rows (skip)`);
    return 0;
  }

  let copied = 0;
  if (table === "DailyBar") {
    // Streamed by rowid — stable ordering, no OFFSET cost.
    let lastRowid = 0;
    for (;;) {
      const rows = sqlite
        .query(`SELECT rowid AS _rid, ${colList} FROM "DailyBar" WHERE rowid > ? ORDER BY rowid LIMIT ?`)
        .all(lastRowid, BATCH) as Record<string, unknown>[];
      if (rows.length === 0) break;
      lastRowid = Number(rows[rows.length - 1]._rid);
      const payload = rows.map((r) => {
        const { _rid, ...rest } = r;
        return coerce(table, rest);
      });
      await pg.dailyBar.createMany({ data: payload as never, skipDuplicates: true });
      copied += payload.length;
      if (copied % 100_000 < BATCH) {
        const pct = ((copied / total) * 100).toFixed(0);
        console.log(`  DailyBar ${copied}/${total} (${pct}%)`);
      }
    }
  } else {
    const rows = sqlite.query(`SELECT ${colList} FROM "${table}"`).all() as Record<string, unknown>[];
    // Wide tables (Stock ~70 cols) must respect Prisma's 32,767 bind-param
    // assertion — cap the batch accordingly.
    const perBatch = Math.max(1, Math.min(BATCH, Math.floor(30000 / cols.length)));
    for (let i = 0; i < rows.length; i += perBatch) {
      const page = rows.slice(i, i + perBatch).map((r) => coerce(table, r));
      const { sql, params } = buildInsert(table, cols.map((c) => c.name), page);
      await pg.$executeRawUnsafe(sql, ...params);
      copied += page.length;
    }
  }
  console.log(`${table}: ${copied}/${total} rows copied`);
  return copied;
}

/** Multi-row INSERT with $n placeholders (Prisma PG wire protocol). */
function buildInsert(table: string, cols: string[], rows: Record<string, unknown>[]): { sql: string; params: unknown[] } {
  const per = cols.length;
  const values = rows
    .map(
      (_, r) =>
        `(${Array.from({ length: per }, (_, c) => `$${r * per + c + 1}`).join(", ")})`
    )
    .join(", ");
  const flat = rows.flatMap((row) => cols.map((c) => row[c] ?? null));
  const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${values}`;
  return { sql, params: flat };
}

async function main() {
  const t0 = Date.now();
  const sqlite = new Database(SOURCE, { readonly: true });
  console.log(`source: ${SOURCE} (sqlite)  →  target: postgresql://${"…"}/tradepulse`);

  // FK-safe wipe — one statement, restarts identity sequences.
  await pg.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
  console.log("target truncated");

  for (const table of TABLES) {
    await copyTable(sqlite, table);
  }
  sqlite.close();

  // ---- verification -----------------------------------------------------
  console.log("\n--- verify ---");
  for (const table of TABLES) {
    const [r] = (await pg.$queryRawUnsafe(toPgSql(`SELECT COUNT(*) AS n FROM "${table}"`))) as { n: bigint }[];
    console.log(`PG ${table}: ${Number(r.n)}`);
  }
  const spot = (await pg.$queryRawUnsafe(
    `SELECT "date", close FROM "DailyBar" WHERE symbol = 'RELIANCE.NS' ORDER BY "date" DESC LIMIT 1`
  )) as { date: string; close: number }[];
  console.log(`RELIANCE latest bar: ${spot[0]?.date} close ${spot[0]?.close}`);
  const sm = (await pg.$queryRawUnsafe(
    `SELECT SUM(LENGTH("closes")) AS b FROM "Stock"`
  )) as { b: bigint | null }[];
  console.log(`closes JSON bytes migrated: ${Number(sm[0]?.b ?? 0)}`);
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pg.$disconnect();
}

main().catch((e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
