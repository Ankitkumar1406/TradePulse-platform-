# TradePulse — Database Backups

## Current: PostgreSQL (Task 46)

The app database is PostgreSQL 17 since Task 46. In this sandbox it runs as a
**userspace cluster** (no root needed): binaries in `vendor/pgsql`, data in
`pgdata/`, controlled by `scripts/pg-ctl.sh` / auto-started by
`scripts/pg-ensure.sh` (wired into `predev` and `src/instrumentation.ts`).

`custom-2026-09-26.db.gz` is the final SQLite snapshot taken right before the
PostgreSQL migration — it is the **seed source** for the migration, not the
live database.

### Fresh-machine bootstrap (from the SQLite snapshot)

```bash
# 1. start PostgreSQL (downloads binaries + initdb + start if missing)
bash scripts/pg-ensure.sh

# 2. restore the SQLite snapshot into db/
mkdir -p db
gunzip -c backups/custom-2026-09-26.db.gz > db/custom.db

# 3. migrate SQLite → PostgreSQL (truncates + copies all tables, ~60s)
bun run scripts/migrate-sqlite-to-pg.ts

# 4. build the precomputed tables for the current EOD session
bun run scripts/precompute-now.ts
```

`bun run dev` then boots normally: quotes/closes/bars sync on the 4 pm IST
cron, and the 10-minute sweeper keeps `stock_metrics` + `scan_results` in
lock-step with the latest session.

### What the pipeline stores

| Table | Content | Written by |
|---|---|---|
| `Stock`, `DailyBar` | raw quotes + raw OHLCV bars | nightly ingest (Step 1) |
| `StockMetrics` | one row per symbol per session — SMA/EMA/RSI/MACD/BB/ATR, mom 1-12M, 52w positioning, volume health, flags, ratings | `computeStockMetrics` (Step 2) |
| `ScanResult` | full wire payload of all 39 scanners per session | `precomputeAllScans` (Step 3) |

Read paths (scanners, screener, breadth) only touch the precomputed tables +
the Stock snapshot; the Condition Builder keeps live computation by design.

### SQLite snapshot refresh (optional, legacy)

```bash
bun scripts/db-backup.ts          # writes backups/custom-<today>.db (VACUUM INTO)
gzip backups/custom-<today>.db    # keep it under GitHub's 100 MB file limit
```
