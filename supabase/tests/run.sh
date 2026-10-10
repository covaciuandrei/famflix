#!/usr/bin/env bash
# Database tests: builds a throwaway database from setup.sql, a defaults_*.sql file and ../db_init.sql, then runs
# every NN_*.sql file here in order, in that one database (later files build on earlier ones). Each check prints
# "NOTICE:  ok: ..."; the first failure stops the run with a non-zero exit.
# Everything runs twice, because Supabase hands out privileges differently depending on the project: once as it
# did until 2026 (defaults_older.sql) and once as it does for new projects, and for every project from 30 October
# 2026 (defaults_newer.sql). db_init.sql has to come out right both ways.
#
#   supabase/tests/run.sh                 # starts a temporary local PostgreSQL 17 (needs initdb, pg_ctl, psql)
#   PGHOST=... PGUSER=... supabase/tests/run.sh   # or uses that server (CI), creating and dropping a database
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
init="$here/../db_init.sql"

if [ -z "${PGHOST:-}" ]; then
  for tool in initdb pg_ctl psql; do
    command -v "$tool" >/dev/null || { echo "Needs PostgreSQL 17 ($tool not found), or set PGHOST to an existing server."; exit 1; }
  done
  tmp="$(mktemp -d)"
  # A valid locale in the environment: on macOS the server refuses to start without one.
  export LC_ALL=C
  initdb -D "$tmp/data" -U postgres --auth=trust --locale=C --encoding=UTF8 >/dev/null
  pg_ctl -D "$tmp/data" -o "-c listen_addresses='' -k $tmp -p 54399" -l "$tmp/server.log" -w start >/dev/null
  trap 'pg_ctl -D "$tmp/data" -m fast -w stop >/dev/null 2>&1; rm -rf "$tmp"' EXIT
  export PGHOST="$tmp" PGPORT=54399 PGUSER=postgres
fi

run() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$1" 2>&1; }

total=0
for regime in older newer; do
  db="famflix_test_$$_$regime"
  psql -X -q -d postgres -c "create database $db" >/dev/null
  cleanup_db() { psql -X -q -d postgres -c "drop database if exists $db" >/dev/null 2>&1 || true; }
  trap 'cleanup_db; [ -n "${tmp:-}" ] && { pg_ctl -D "$tmp/data" -m fast -w stop >/dev/null 2>&1; rm -rf "$tmp"; }' EXIT

  if ! out="$(run "$here/setup.sql" && run "$here/defaults_$regime.sql" && run "$init")"; then
    echo "Building the database from db_init.sql failed ($regime Supabase defaults):"
    echo "$out" | tail -5
    exit 1
  fi
  echo "Built from db_init.sql, Supabase defaults: $regime"

  for file in "$here"/[0-9][0-9]_*.sql; do
    name="$(basename "$file")"
    if out="$(run "$file")"; then
      ok="$(grep -c "NOTICE:  ok" <<<"$out" || true)"
      total=$((total + ok))
      printf "  pass  %-32s %3s checks\n" "$name" "$ok"
    else
      printf "  FAIL  %s (%s Supabase defaults)\n" "$name" "$regime"
      grep -E "ERROR|FAILED" <<<"$out" | head -5 | sed 's/^/        /'
      exit 1
    fi
  done
  cleanup_db
done
echo "All database tests passed ($total checks, both ways)"
