#!/usr/bin/env bash
# Idempotent "make sure PostgreSQL is up" — safe to call before every dev boot.
#   1. binaries present?          (else download the official userspace build)
#   2. cluster initialised?       (else initdb ./pgdata)
#   3. server running?            (else start it)
#   4. tradepulse DB exists?      (else createdb + prisma db push)
set -u
cd "$(dirname "$0")/.."

PG_VERSION="17.5.0"
PG_DIR="vendor/pgsql"
PG_BIN="$PG_DIR/bin"
PGDATA="pgdata"
LOG="pg-logs/pg.log"
PG_URL="postgresql://tradepulse:tradepulse@127.0.0.1:5432/tradepulse"

mkdir -p pg-logs

if [ ! -x "$PG_BIN/postgres" ]; then
  echo "[pg-ensure] downloading PostgreSQL $PG_VERSION (userspace binaries)..."
  mkdir -p vendor
  curl -sL -o /tmp/pg.tar.gz \
    "https://github.com/theseus-rs/postgresql-binaries/releases/download/${PG_VERSION}/postgresql-${PG_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    || { echo "[pg-ensure] download failed" >&2; exit 1; }
  tar xzf /tmp/pg.tar.gz -C vendor
  mv "vendor/postgresql-${PG_VERSION}-x86_64-unknown-linux-gnu" "$PG_DIR"
  rm -f /tmp/pg.tar.gz
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[pg-ensure] initialising cluster at $PGDATA..."
  "$PG_BIN/initdb" -D "$PGDATA" -U tradepulse --auth=trust --encoding=UTF8 --locale=C > /dev/null
  cat >> "$PGDATA/postgresql.conf" << 'EOF'
listen_addresses = '127.0.0.1'
port = 5432
unix_socket_directories = '/home/z/my-project/pgdata'
max_connections = 30
shared_buffers = 128MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB
wal_buffers = 8MB
min_wal_size = 64MB
max_wal_size = 1GB
checkpoint_completion_target = 0.9
random_page_cost = 1.1
effective_io_concurrency = 200
log_min_duration_statement = 2000
EOF
fi

if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status > /dev/null 2>&1; then
  echo "[pg-ensure] starting postgres..."
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOG" start > /dev/null
  for i in $(seq 1 30); do
    "$PG_BIN/pg_isready" -h 127.0.0.1 -p 5432 > /dev/null 2>&1 && break
    sleep 0.5
  done
fi

if ! "$PG_BIN/psql" -h 127.0.0.1 -p 5432 -U tradepulse -d postgres -tAc \
     "SELECT 1 FROM pg_database WHERE datname='tradepulse'" | grep -q 1; then
  echo "[pg-ensure] creating tradepulse database..."
  "$PG_BIN/createdb" -h 127.0.0.1 -p 5432 -U tradepulse tradepulse
  bunx prisma db push --skip-generate
fi

echo "[pg-ensure] postgres ready ($PG_URL)"
