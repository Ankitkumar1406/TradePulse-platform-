# TradePulse — NSE End-of-Day Research Platform

Research after the close. Execute with clarity.

TradePulse auto-updates every NSE-listed stock (3,545 symbols) at **4:00 pm IST** and turns
the finalized daily data into a complete end-of-day research workflow: 38 one-click scanners,
an advanced screener, annotated charts, sector analytics, watchlists, alerts, a trading
journal and a market calendar — all in one workspace.

> Not investment advice. TradePulse is a research tool; do your own research or consult a
> SEBI-registered investment adviser.

---

## Features

- **38 one-click scanners across 8 categories** — chart patterns (horizontal resistance, tight
  setups, inside bars, flags & pennants, VCP), gaps & earnings, volume scans, momentum & RS,
  specialty scans, six multi-condition **Trader Choice** templates and a multi-timeframe RSI extra.
  Every output is sortable by RS, change %, market cap and 1M/3M/6M performance, with List and
  Charts (candlestick tile grid) views.
- **Advanced screener** — a 15-condition builder with **AND/OR groups**: daily or weekly RSI and
  MACD, SMA/EMA at 20/50/100/200, Bollinger Bands, momentum, volume and valuation fields — all
  filtered in SQL over the whole universe. Plus multi-scan confluence (run up to 8 scans together),
  saved screens and CSV export.
- **Charts** — 2-year candlesticks with SMA overlays, in-pane volume, consolidation-base overlay
  (formation sessions & depth), MACD / Bollinger / RSI panes, timeframe & EMA-length filters and
  an RS-strength filter on scan charts.
- **Market analytics** — market breadth dashboard (advances, declines, 52-week stats,
  participation), sector rotation quadrant (RS × momentum), sector strength and sector momentum
  (daily/weekly/monthly RSI per index).
- **Watchlists & alerts** — star any stock from a scan or screener result, plan entry/stop/target,
  and let price alerts do the monitoring.
- **Trading journal** — every trade with auto-computed P&L, return %, R-multiple and win rate.
- **Market calendar** — NSE holidays, F&O expiries, RBI MPC, FOMC, Budget and earnings windows.
- **Plans** — free Basic tier and a Pro subscription (15-day card-free trial) with recurring
  payments via **Cashfree** (UPI Autopay / card e-mandate).

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) · React 19 · TypeScript
- Tailwind CSS 4 + shadcn/ui (light & dark themes)
- [Prisma](https://prisma.io) + SQLite
- NextAuth (credentials) · TanStack Query
- [klinecharts](https://klinecharts.com) 10 for candlestick charts
- Cashfree REST API for subscriptions

## Getting started

### 1. Prerequisites

- Node.js 20+ (or [bun](https://bun.sh))
- npm / bun

### 2. Install & configure

```bash
npm install
cp .env.example .env        # then edit values (see table below)
npm run db:push             # create the SQLite schema
```

### 3. Run

```bash
npm run dev                 # development on http://localhost:3000
```

Production build (standalone output):

```bash
npm run build
npm start
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | SQLite file path, e.g. `file:./db/custom.db` |
| `NEXTAUTH_URL` | yes | Public URL of the deployment |
| `NEXTAUTH_SECRET` | yes | Session signing secret (`openssl rand -base64 32`) |
| `CASHFREE_APP_ID` | no | Cashfree app id — enables live subscriptions |
| `CASHFREE_SECRET_KEY` | no | Cashfree secret key |
| `CASHFREE_API_DOMAIN` | no | `https://api.cashfree.com` (prod) or `https://api-sandbox.cashfree.com` |

## Data & scheduling

- On first run the database is empty — trigger **Sync** from the app header (or hit `/api/sync`)
  to pull EOD data for all NSE symbols and compute indicators.
- The app auto-syncs every trading day at **4:00 pm IST** (in-process scheduler), refreshing
  prices, indicators and scan inputs for the whole universe.

## Project scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build (standalone) and start |
| `npm run lint` / `tsc --noEmit` | ESLint / TypeScript checks |
| `npm run db:push` | Sync the Prisma schema to SQLite |
| `scripts/backfill-extended.ts` | Backfill weekly indicators / Bollinger / MA distances |
| `scripts/backfill-taxonomy.ts` | Backfill sector & industry taxonomy |
| `scripts/test-scheduler.ts` | Verify the EOD scheduler |

## Deployment notes

- The build produces a **standalone** server (`.next/standalone`) — run it behind any process
  manager (systemd, Docker, PM2) on a Node 20+ host. `npm run build` already copies
  `.next/static` and `public` into the standalone folder.
- SQLite keeps everything in one file: schedule off-site backups of `db/custom.db`.
- Set the Cashfree variables before enabling paid plans, and point `CASHFREE_API_DOMAIN`
  at the production API.
