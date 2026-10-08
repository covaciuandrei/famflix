-- A small stand-in for the parts of Supabase that db_init.sql relies on (the anon and authenticated roles,
-- auth.users and auth.uid()), plus the two helpers the tests use. Run before db_init.sql in an empty database.

-- Roles belong to the whole server, so a second run on the same server reuses them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
-- Supabase reads the signed-in user from the request's token; the tests set request.jwt.claim.sub instead.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

-- Like Supabase: anon and authenticated may use everything in public unless db_init.sql says otherwise.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

create schema test;
grant usage on schema test to anon, authenticated;

-- Passes if p_sql fails with an error message containing p_fragment.
create function test.expect_error(p_sql text, p_fragment text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'TEST FAILED: expected error containing "%" but got "%" for: %',
        p_fragment, sqlerrm, p_sql;
    end if;
    raise notice 'ok (refused as expected): %', sqlerrm;
    return;
  end;
  raise exception 'TEST FAILED: expected an error for: %', p_sql;
end $$;

-- Passes if the two values are equal (null equals null). anycompatible lets 8 match 8.0.
create function test.expect_eq(p_actual anycompatible, p_expected anycompatible, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: % (expected %, got %)', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok: %', p_label;
end $$;

grant execute on all functions in schema test to anon, authenticated;
