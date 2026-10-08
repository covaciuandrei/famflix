\set ON_ERROR_STOP 1
-- The rules Supabase's Performance Advisor checks, so a new security rule or foreign key can't quietly break them.

-- Every auth.uid() in a security rule is wrapped as (select auth.uid()), which Postgres works out once per query
-- instead of once per row.
with p as (
  select policyname, lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) as t
  from pg_policies
  where schemaname = 'public'
)
select test.expect_eq(
  (select string_agg(policyname, ', ') from p
   where (length(t) - length(replace(t, 'auth.uid()', ''))) / length('auth.uid()')
      <> (length(t) - length(replace(t, 'select auth.uid()', ''))) / length('select auth.uid()')),
  null::text,
  'every security rule reads the signed-in user once per query');

-- Every foreign key has an index that starts with its columns (needed for joins and for cascading deletes).
select test.expect_eq(
  (select string_agg(c.conrelid::regclass || ' (' || c.conname || ')', ', ')
   from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and not exists (
       select 1 from pg_index i
       where i.indrelid = c.conrelid
         and (string_to_array(i.indkey::text, ' ')::smallint[])[1:array_length(c.conkey, 1)] = c.conkey
     )),
  null::text,
  'every foreign key has an index');

-- Every table in public has row-level security switched on.
select test.expect_eq(
  (select string_agg(relname, ', ') from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
  null::text,
  'every table has row-level security');

do $$ begin raise notice 'ALL SCHEMA CHECKS PASSED'; end $$;
