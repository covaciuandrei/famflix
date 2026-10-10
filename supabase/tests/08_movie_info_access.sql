\set ON_ERROR_STOP 1
\set as_mia  'reset role; select set_config(''request.jwt.claim.sub'', ''56565656-0000-0000-0000-000000000006'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

insert into auth.users (id, email, raw_user_meta_data) values
  ('56565656-0000-0000-0000-000000000006', 'mia@x.test', '{"full_name":"Mia"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

-- The server saves movie info (the table owner stands in for the service-role key, which skips these rules).
reset role;
insert into public.media (tmdb_id, media_type, title, poster_path) values (9101, 'movie', 'Shared Title', '/real.jpg');
insert into public.media (tmdb_id, media_type, title, poster_path) values (9101, 'movie', 'Shared Title', '/real2.jpg')
  on conflict (tmdb_id, media_type) do update set poster_path = excluded.poster_path;
select test.expect_eq((select poster_path from public.media where tmdb_id = 9101), '/real2.jpg'::text, 'the server can save and refresh movie info');

-- Everyone signed in can read it...
:as_mia
select test.expect_eq((select title from public.media where tmdb_id = 9101), 'Shared Title'::text, 'signed-in people can read movie info');

-- ...but not write it
select test.expect_error($$insert into public.media (tmdb_id, media_type, title) values (9102, 'movie', 'Planted')$$, 'permission denied');
select test.expect_error($$update public.media set title = 'Defaced', poster_path = '/evil.jpg'$$, 'permission denied');
select test.expect_error($$insert into public.media (tmdb_id, media_type, title) values (9101, 'movie', 'Defaced') on conflict (tmdb_id, media_type) do update set title = excluded.title$$, 'permission denied');
select test.expect_error($$delete from public.media where tmdb_id = 9101$$, 'permission denied');
reset role;
select test.expect_eq((select title || ' ' || poster_path from public.media where tmdb_id = 9101), 'Shared Title /real2.jpg'::text, 'the movie info is untouched');
select test.expect_eq((select count(*) from public.media where tmdb_id = 9102), 0::bigint, 'nothing was planted');

-- Signed-out visitors see and write nothing
:as_anon
select test.expect_error($$select count(*) from public.media$$, 'permission denied');
select test.expect_error($$insert into public.media (tmdb_id, media_type, title) values (9103, 'movie', 'Planted')$$, 'permission denied');

reset role;
do $$ begin raise notice 'ALL SECURITY (MEDIA) TESTS PASSED'; end $$;
