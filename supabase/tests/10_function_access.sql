\set ON_ERROR_STOP 1
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

-- Visitors can't call any of these, and can't read any table either.
:as_anon
select test.expect_error($$select public.create_group('x')$$, 'permission denied');
select test.expect_error($$select public.join_group('ZZZZZZZZ')$$, 'permission denied');
select test.expect_error($$select count(*) from public.activity$$, 'permission denied');

-- Sign-up still creates a profile when Supabase Auth (a non-superuser role) adds the user.
reset role;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'auth_admin_stand_in') then
    create role auth_admin_stand_in nologin;
  end if;
end $$;
grant usage on schema auth to auth_admin_stand_in;
grant insert on auth.users to auth_admin_stand_in;
set role auth_admin_stand_in;
insert into auth.users (id, email, raw_user_meta_data) values ('65656565-0000-0000-0000-000000000005', 'newbie@x.test', '{"full_name":"Newbie"}');
reset role;
select test.expect_eq((select display_name from public.profiles where id = '65656565-0000-0000-0000-000000000005'), 'Newbie'::text, 'sign-up still creates the profile (trigger runs without EXECUTE)');

reset role;
do $$ begin raise notice 'ALL SECURITY (EXEC) TESTS PASSED'; end $$;
