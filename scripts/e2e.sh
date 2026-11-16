#!/usr/bin/env bash
# Browser tests (e2e/), against a local Supabase in Docker, so they never touch the live project:
#   npm run test:e2e              # all tests, on a computer-sized and a phone-sized screen
#   npm run test:e2e -- -g Delete # only tests whose name matches
# Needs Docker. TMDB_ACCESS_TOKEN comes from the environment or .env.local. Each run starts from an empty
# database built from supabase/db_init.sql; `npx supabase stop` shuts the local Supabase down afterwards.
# The database is set up like a new Supabase project (and every project from 30 October 2026): nothing is handed to
# the API roles by default, so the app only gets what db_init.sql grants.
set -euo pipefail
cd "$(dirname "$0")/.."

supabase() { npx --yes supabase@2.120.0 "$@"; }

if ! supabase status >/dev/null 2>&1; then
  supabase start
fi
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

echo "Building a fresh local database from supabase/db_init.sql"
supabase db reset --local >/dev/null
# Supabase's own "revoke default privileges" statements: new tables and functions in public are not handed out.
docker exec -i supabase_db_famflix psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public;
SQL
docker exec -i supabase_db_famflix psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/db_init.sql

# The app talks to the local Supabase; the build goes to .next-e2e (see next.config.ts).
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export NEXT_DIST_DIR=.next-e2e
npx next build
npx playwright test "$@"
