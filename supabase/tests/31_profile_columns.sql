\set ON_ERROR_STOP 1
\set as_pia  'reset role; select set_config(''request.jwt.claim.sub'', ''31313131-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

-- What a person may change on their own profile: the display name, and nothing else. The photo is the one Google gave
-- at sign-up and other people's browsers load it, so nobody can point it at a server of their own (which would show that
-- server who opens a family's page, and from where).
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('31313131-0000-0000-0000-000000000001', 'pia@x.test', '{"full_name":"Pia","avatar_url":"https://lh3.googleusercontent.com/a/pia=s96-c"}'),
  ('32323232-0000-0000-0000-000000000002', 'ned@x.test', '{"full_name":"Ned","avatar_url":"https://lh3.googleusercontent.com/a/ned=s96-c"}');
select test.expect_eq((select avatar_url from public.profiles where id = '31313131-0000-0000-0000-000000000001'),
  'https://lh3.googleusercontent.com/a/pia=s96-c'::text, 'signing up keeps the photo Google gave');

:as_pia
update public.profiles set display_name = 'Pia Q' where id = '31313131-0000-0000-0000-000000000001';
select test.expect_eq((select display_name from public.profiles where id = '31313131-0000-0000-0000-000000000001'),
  'Pia Q'::text, 'a person can change their own display name');
select test.expect_error($$update public.profiles set avatar_url = 'https://attacker.example/p.gif' where id = '31313131-0000-0000-0000-000000000001'$$, 'permission denied');
select test.expect_error($$update public.profiles set display_name = 'Pia', avatar_url = null where id = '31313131-0000-0000-0000-000000000001'$$, 'permission denied');
select test.expect_error($$update public.profiles set created_at = now() where id = '31313131-0000-0000-0000-000000000001'$$, 'permission denied');
select test.expect_error($$update public.profiles set id = gen_random_uuid() where id = '31313131-0000-0000-0000-000000000001'$$, 'permission denied');
select test.expect_error($$insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Ghost')$$, 'permission denied');

-- Nobody else's profile changes either: the security rules hide it, so the update reaches no row.
update public.profiles set display_name = 'Hacked' where id = '32323232-0000-0000-0000-000000000002';
reset role;
select test.expect_eq((select display_name from public.profiles where id = '32323232-0000-0000-0000-000000000002'),
  'Ned'::text, 'nobody else''s display name changes');
select test.expect_eq((select avatar_url from public.profiles where id = '31313131-0000-0000-0000-000000000001'),
  'https://lh3.googleusercontent.com/a/pia=s96-c'::text, 'the photo is untouched');
select test.expect_eq((select count(*) from public.profiles where id not in (select id from auth.users)),
  0::bigint, 'no profile exists without a sign-in behind it');

-- Signed-out visitors change nothing
:as_anon
select test.expect_error($$update public.profiles set display_name = 'x'$$, 'permission denied');

reset role;
do $$ begin raise notice 'ALL SECURITY (PROFILE) TESTS PASSED'; end $$;
