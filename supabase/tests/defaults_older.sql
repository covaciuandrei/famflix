-- What Supabase did until 2026: every new table, function and sequence in public goes to anon, authenticated and
-- service_role by itself, and the three may use the schema. db_init.sql has to end up right from here...
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
