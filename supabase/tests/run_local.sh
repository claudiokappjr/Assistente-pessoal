#!/usr/bin/env bash
# Recria um banco local descartável, aplica migrations e roda os testes de RLS.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-assistente_test}
psql -q -c "drop database if exists $DB" -c "create database $DB"
for f in tests/00_supabase_shim.sql migrations/*.sql tests/01_rls_test.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
