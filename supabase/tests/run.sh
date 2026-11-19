#!/usr/bin/env bash
# Database tests for Jarvis: the security rules, the RPCs and the internal
# functions, run against a real PostgreSQL server.
#
#   supabase/tests/run.sh                    uses a throwaway database on the
#                                            local server below, then drops it
#   DATABASE_URL=postgres://… supabase/tests/run.sh
#                                            uses that EMPTY database instead
#                                            (never point it at a real project)
#
# Steps: load the Supabase stand-in (supabase_shim.sql), apply every
# migration, apply seed.sql twice, then run each sql/*.sql file inside a
# transaction that is rolled back, so the files do not affect each other.
# A broken expectation prints "FAIL: …" and the script exits non-zero.
# A second throwaway database checks the case where accounts already exist
# before the migration runs (only with the default server).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SERVER="${JARVIS_TEST_SERVER:-postgresql://postgres@127.0.0.1:54329}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -P pager=off)

throwaway=()
cleanup() {
  for db in "${throwaway[@]:-}"; do
    [ -n "$db" ] && "${PSQL[@]}" "$SERVER/postgres" -c "drop database if exists $db with (force)" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

new_db() {
  local name="jarvis_test_$$_$1"
  "${PSQL[@]}" "$SERVER/postgres" -c "drop database if exists $name with (force)" >/dev/null 2>&1
  "${PSQL[@]}" "$SERVER/postgres" -c "create database $name" >/dev/null
  throwaway+=("$name")
  echo "$SERVER/$name"
}

apply() { # url file [label]
  if ! out="$("${PSQL[@]}" "$1" -f "$2" 2>&1)"; then
    echo "$out" >&2
    echo "FAILED while applying ${3:-$2}" >&2
    exit 1
  fi
}

if [ -n "${DATABASE_URL:-}" ]; then
  DB="$DATABASE_URL"
else
  DB="$(new_db main)"
fi

apply "$DB" "$HERE/supabase_shim.sql" "the Supabase stand-in"
for m in "$ROOT"/migrations/*.sql; do apply "$DB" "$m" "migration $(basename "$m")"; done
apply "$DB" "$ROOT/seed.sql" "seed.sql (first run)"
apply "$DB" "$ROOT/seed.sql" "seed.sql (second run)"
apply "$DB" "$HERE/helpers.sql" "test helpers"

total=0
run_file() { # url file
  local out n
  if ! out="$( { printf '\\o /dev/null\nbegin;\n'; cat "$2"; printf "\nselect current_setting('test.count', true) as n \\\\gset\nrollback;\n\\\\echo CHECKS :n\n"; } \
               | "${PSQL[@]}" "$1" 2>&1)"; then
    echo "$out" | grep -v '^NOTICE' >&2
    echo "FAILED: $(basename "$2")" >&2
    exit 1
  fi
  n="$(echo "$out" | sed -n 's/^CHECKS //p' | tail -1)"
  n="${n:-0}"
  printf '  ok  %-28s %4s checks\n' "$(basename "$2")" "$n"
  total=$((total + n))
}

echo "Jarvis database tests"
for f in "$HERE"/sql/*.sql; do run_file "$DB" "$f"; done

# Accounts that exist before the migration: the earliest real one is the owner.
if [ -z "${DATABASE_URL:-}" ]; then
  DB2="$(new_db existing)"
  apply "$DB2" "$HERE/supabase_shim.sql" "the Supabase stand-in"
  apply "$DB2" "$HERE/existing_users/setup.sql" "existing users"
  for m in "$ROOT"/migrations/*.sql; do apply "$DB2" "$m" "migration $(basename "$m")"; done
  apply "$DB2" "$HERE/helpers.sql" "test helpers"
  run_file "$DB2" "$HERE/existing_users/check.sql"
fi

echo "All $total checks passed."
