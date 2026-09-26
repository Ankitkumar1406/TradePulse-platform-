# TradePulse — Database Backups

`custom-2026-09-26.db.gz` is a consistent, compacted snapshot of the live
SQLite database (taken via `VACUUM INTO` while the app was running), containing:

- Stock universe (~3,5xx NSE symbols) with latest quotes & ratings
- DailyBar / WeeklyBar OHLCV history
- Sector taxonomy, financials (EPS, APS, AD rating inputs), earnings

## Restore on a new machine

```bash
# 1. gunzip into the db/ directory
mkdir -p db
gunzip -c backups/custom-2026-09-26.db.gz > db/custom.db

# 2. start the app — SQLite will create -shm/-wal automatically
bun run dev
```

The scheduler will pick up from the restored data and keep quotes/bars
fresh on its own (boot self-heal guard re-syncs any stale bars).

## Refresh the snapshot

```bash
bun scripts/db-backup.ts          # writes backups/custom-<today>.db
gzip backups/custom-<today>.db    # keep it under GitHub's 100 MB file limit
```
