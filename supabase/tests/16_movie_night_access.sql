\set ON_ERROR_STOP 1
-- Movie nights: who can read what, and that nobody writes the tables directly.
\set as_cleo 'reset role; select set_config(''request.jwt.claim.sub'', ''c1c1c1c1-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_dev  'reset role; select set_config(''request.jwt.claim.sub'', ''c2c2c2c2-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_eve  'reset role; select set_config(''request.jwt.claim.sub'', ''c3c3c3c3-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set cleo '''c1c1c1c1-0000-0000-0000-000000000001'''
\set dev  '''c2c2c2c2-0000-0000-0000-000000000002'''
\set eve  '''c3c3c3c3-0000-0000-0000-000000000003'''
\set fam    '(select v::uuid from test.vals where k = ''mn_fam'')'
\set night  '(select v::uuid from test.vals where k = ''mn_night'')'
\set stack  '(select v::uuid from test.vals where k = ''mn_stack'')'
\set cand1  '(select v::uuid from test.vals where k = ''mn_c1'')'
\set cand2  '(select v::uuid from test.vals where k = ''mn_c2'')'

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'cleo@x.test', '{"full_name":"Cleo"}'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'dev@x.test',  '{"full_name":"Dev"}'),
  ('c3c3c3c3-0000-0000-0000-000000000003', 'eve@x.test',  '{"full_name":"Eve"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

:as_cleo
select public.create_group('Night Fam');
reset role;
insert into test.vals select 'mn_fam', id::text from public.groups where name = 'Night Fam';
insert into test.vals select 'mn_code', invite_code from public.groups where name = 'Night Fam';
:as_dev
select public.join_group((select v from test.vals where k = 'mn_code'));
:as_eve
select public.create_group('Eve Fam');

-- A night with one stack of two cards, written the way only the functions may: as the database owner.
reset role;
insert into public.media (tmdb_id, media_type, title, tmdb_rating) values
  (9701, 'movie', 'Night A', 7.0), (9702, 'movie', 'Night B', 8.0);
insert into public.movie_nights (group_id, started_by, genres) values (:fam, :cleo, array['comedy']);
insert into test.vals select 'mn_night', id::text from public.movie_nights where group_id = :fam;
insert into public.movie_night_stacks (night_id, position, created_by) values (:night, 1, :cleo);
insert into test.vals select 'mn_stack', id::text from public.movie_night_stacks where night_id = :night;
insert into public.movie_night_candidates (night_id, stack_id, media_id, origin, position)
  select :night, :stack, id, 'suggested', tmdb_id - 9700 from public.media where tmdb_id in (9701, 9702);
insert into test.vals select 'mn_c1', c.id::text from public.movie_night_candidates c join public.media m on m.id = c.media_id where m.tmdb_id = 9701;
insert into test.vals select 'mn_c2', c.id::text from public.movie_night_candidates c join public.media m on m.id = c.media_id where m.tmdb_id = 9702;
insert into public.movie_night_members (night_id, user_id) values (:night, :cleo), (:night, :dev);
insert into public.movie_night_votes (candidate_id, user_id, vote) values
  (:cand1, :cleo, 'love'), (:cand2, :cleo, 'nope'), (:cand1, :dev, 'yes');
insert into public.movie_night_finishes (stack_id, user_id) values (:stack, :cleo);

-- Family members read the night and its cards, but only their own votes.
:as_cleo
select test.expect_eq((select count(*) from public.movie_nights), 1::bigint, 'a member sees the family''s night');
select test.expect_eq((select count(*) from public.movie_night_stacks), 1::bigint, 'and its stack');
select test.expect_eq((select count(*) from public.movie_night_candidates), 2::bigint, 'and its cards');
select test.expect_eq((select count(*) from public.movie_night_members), 2::bigint, 'and who took part');
select test.expect_eq((select count(*) from public.movie_night_finishes), 1::bigint, 'and who finished');
select test.expect_eq((select count(*) from public.movie_night_votes), 2::bigint, 'but only her own votes');
select test.expect_eq((select count(*) from public.movie_night_votes where user_id = :dev), 0::bigint, 'never Dev''s');
select test.expect_eq(public.can_see_night(:night), true, 'she can see the night');
:as_dev
select test.expect_eq((select count(*) from public.movie_night_votes), 1::bigint, 'Dev sees only his own vote');
select test.expect_eq((select vote from public.movie_night_votes), 'yes'::text, 'which is his');

-- Outsiders and visitors see nothing.
:as_eve
select test.expect_eq((select count(*) from public.movie_nights), 0::bigint, 'another family can''t see the night');
select test.expect_eq((select count(*) from public.movie_night_stacks), 0::bigint, 'nor its stack');
select test.expect_eq((select count(*) from public.movie_night_candidates), 0::bigint, 'nor its cards');
select test.expect_eq((select count(*) from public.movie_night_members), 0::bigint, 'nor who took part');
select test.expect_eq((select count(*) from public.movie_night_finishes), 0::bigint, 'nor who finished');
select test.expect_eq((select count(*) from public.movie_night_votes), 0::bigint, 'nor any votes');
select test.expect_eq(public.can_see_night(:night), false, 'and can_see_night says no');
:as_anon
select test.expect_error($$select count(*) from public.movie_nights$$, 'permission denied');
select test.expect_error($$select public.can_see_night((select v::uuid from test.vals where k = 'mn_night'))$$, 'permission denied');

-- Nobody writes the tables directly, not even a member.
:as_cleo
select test.expect_error($$insert into public.movie_nights (group_id) values ((select v::uuid from test.vals where k = 'mn_fam'))$$, 'permission denied');
select test.expect_error($$update public.movie_nights set status = 'cancelled'$$, 'permission denied');
select test.expect_error($$delete from public.movie_nights$$, 'permission denied');
select test.expect_error($$insert into public.movie_night_votes (candidate_id, user_id, vote)
  values ((select v::uuid from test.vals where k = 'mn_c2'), 'c1c1c1c1-0000-0000-0000-000000000001', 'love')$$, 'permission denied');
select test.expect_error($$update public.movie_night_votes set vote = 'love'$$, 'permission denied');
select test.expect_error($$delete from public.movie_night_votes$$, 'permission denied');
select test.expect_error($$insert into public.movie_night_members (night_id, user_id)
  values ((select v::uuid from test.vals where k = 'mn_night'), 'c3c3c3c3-0000-0000-0000-000000000003')$$, 'permission denied');
select test.expect_error($$insert into public.movie_night_finishes (stack_id, user_id)
  values ((select v::uuid from test.vals where k = 'mn_stack'), 'c2c2c2c2-0000-0000-0000-000000000002')$$, 'permission denied');
select test.expect_error($$update public.movie_night_stacks set revealed_at = now()$$, 'permission denied');
select test.expect_error($$delete from public.movie_night_candidates$$, 'permission denied');

-- One open night per family, and a "logged" night can't be open.
reset role;
select test.expect_error($$insert into public.movie_nights (group_id) values ((select v::uuid from test.vals where k = 'mn_fam'))$$, 'movie_nights_one_open_idx');
select test.expect_error($$insert into public.movie_nights (group_id, source, status) values ((select v::uuid from test.vals where k = 'mn_fam'), 'logged', 'open')$$, 'movie_nights_check');
select test.expect_error($$insert into public.movie_nights (group_id, status, genres) values ((select v::uuid from test.vals where k = 'mn_fam'), 'cancelled', array['a','b','c','d','e','f'])$$, 'movie_nights_genres_check');

reset role;
do $$ begin raise notice 'ALL MOVIE NIGHT ACCESS TESTS PASSED'; end $$;
