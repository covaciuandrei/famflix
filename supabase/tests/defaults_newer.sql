-- ...and from what Supabase does for every new project since 30 May 2026 (and every project from 30 October 2026):
-- nothing is handed out. These are the statements from Supabase's "Revoke default privileges", and on top of them the
-- schema has no grants at all, as after "drop schema public cascade; create schema public;" when starting over.
revoke all on schema public from public;
alter default privileges in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;
alter default privileges in schema public revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public;
