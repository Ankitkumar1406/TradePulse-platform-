#!/usr/bin/env bash
# TradePulse userspace PostgreSQL control (no root required).
#   scripts/pg-ctl.sh start|stop|status|restart
set -u
cd "$(dirname "$0")/.."

PG_BIN="vendor/pgsql/bin"
PGDATA="pgdata"
LOG="pg-logs/pg.log"

if [ ! -x "$PG_BIN/pg_ctl" ]; then
  echo "PostgreSQL binaries missing at $PG_BIN — run scripts/pg-ensure.sh first" >&2
  exit 1
fi

case "${1:-status}" in
  start)
    if "$PG_BIN/pg_ctl" -D "$PGDATA" status > /dev/null 2>&1; then
      echo "postgres already running"
    else
      "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOG" start
    fi
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PGDATA" stop -m fast || true
    ;;
  restart)
    "$PG_BIN/pg_ctl" -D "$PGDATA" restart -m fast -l "$LOG"
    ;;
  status)
    "$PG_BIN/pg_ctl" -D "$PGDATA" status
    ;;
  *)
    echo "usage: $0 start|stop|status|restart" >&2
    exit 2
    ;;
esac
