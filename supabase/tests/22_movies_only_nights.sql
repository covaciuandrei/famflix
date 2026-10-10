\set ON_ERROR_STOP 1
-- Movie nights are for movies: a night can't be started asking for series, a series can't be a card (of the first stack
-- or of a "more suggestions" one) or the title picked with "Pick something else", and a series watched together makes no
-- "logged" night in the history. Nights that already had a series card still end when the family logs it. Movies are
-- called MO<tmdb id>, series SO<tmdb id>.
\set as_uma  'reset role; select set_config(''request.jwt.claim.sub'', ''1a1a1a1a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_vic  'reset role; select set_config(''request.jwt.claim.sub'', ''1b1b1b1b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set uma '''1a1a1a1a-0000-0000-0000-000000000001'''
\set vic '''1b1b1b1b-0000-0000-0000-000000000002'''
\set fam '(select v::uuid from test.vals where k = ''mo_fam'')'

insert into auth.users (id, email, raw_user_meta_data) values
  ('1a1a1a1a-0000-0000-0000-000000000001', 'uma22@x.test', '{"full_name":"Uma"}'),
  ('1b1b1b1b-0000-0000-0000-000000000002', 'vic22@x.test', '{"full_name":"Vic"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create or replace function test.cands(p_from integer, p_to integer) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id)
  from public.media where tmdb_id between p_from and p_to $$;
create or replace function test.viewers(p_ids uuid[]) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('user_id', u, 'score', null)) from unnest(p_ids) u $$;
create function test.mo_media(p_tmdb integer) returns uuid language sql stable security definer as $$
  select id from public.media where tmdb_id = p_tmdb $$;
create function test.mo_item(p_tmdb integer) returns uuid language sql stable security definer as $$
  select li.id from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('mo_fam') and m.tmdb_id = p_tmdb $$;
create function test.mo_night(p_night text) returns text language sql stable security definer as $$
  select n.status || ':' || coalesce(m.title, '-')
  from public.movie_nights n left join public.media m on m.id = n.picked_media_id
  where n.id = test.v(p_night) $$;
create function test.mo_logged() returns bigint language sql stable security definer as $$
  select count(*) from public.movie_nights where group_id = test.v('mo_fam') and source = 'logged' $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into public.media (tmdb_id, media_type, title, tmdb_rating)
  select g, 'movie', 'MO' || g, (g - 8800) / 2.0 from generate_series(8801, 8830) g
  union all
  select g, 'tv', 'SO' || g, 8 from generate_series(8841, 8843) g;

:as_uma
select public.create_group('Movies Only Fam');
reset role;
insert into test.vals select 'mo_fam', id::text from public.groups where name = 'Movies Only Fam';
insert into test.vals select 'mo_code', invite_code from public.groups where name = 'Movies Only Fam';
:as_vic
select public.join_group((select v from test.vals where k = 'mo_code'));

-- A series (SO8841) and a movie (MO8825) are on the family list.
:as_uma
insert into public.list_items (group_id, added_by, media_id) values
  (:fam, :uma, test.mo_media(8841)), (:fam, :uma, test.mo_media(8825));

-- ---- Starting ------------------------------------------------------------------------------------------------------
select test.expect_error($$select public.start_movie_night(test.v('mo_fam'), array['comedy'], '{"series": true}', test.cands(8801, 8812))$$,
  'for movies');
select test.expect_error($$select public.start_movie_night(test.v('mo_fam'), array['comedy'], '{}', test.cands(8801, 8810) || test.cands(8841, 8842))$$,
  'for movies');
select test.expect_error($$select public.start_movie_night(test.v('mo_fam'), '{}', '{}', test.cands(8801, 8810) ||
  jsonb_build_array(jsonb_build_object('media_id', test.mo_media(8841), 'list_item_id', test.mo_item(8841), 'origin', 'list')))$$,
  'for movies');
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam), 0::bigint, 'none of those started a night');

-- Movies, with the options saying so or saying nothing, start one; the saved options never say series.
select public.start_movie_night(:fam, array['comedy'], '{"series": false, "count": 12}', test.cands(8801, 8812)) as night_a \gset
reset role;
insert into test.vals values ('mo_a', :'night_a');
select test.expect_eq((select options ->> 'series' from public.movie_nights where id = test.v('mo_a')), 'false'::text,
  'the night is saved as one without series');

-- ---- More suggestions ----------------------------------------------------------------------------------------------
:as_vic
select test.expect_error($$select public.add_movie_night_stack(test.v('mo_a'), 1, test.cands(8813, 8819) || test.cands(8841, 8841))$$,
  'for movies');
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('mo_a')), 1::bigint,
  'a stack with a series in it wasn''t added');
select public.add_movie_night_stack(test.v('mo_a'), 1, test.cands(8813, 8820));
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('mo_a')), 2::bigint,
  'a stack of movies was');

-- ---- Pick something else -------------------------------------------------------------------------------------------
select test.expect_error($$select public.pick_movie_night_title(test.v('mo_a'), test.mo_media(8842), current_date,
  test.viewers(array['1b1b1b1b-0000-0000-0000-000000000002'::uuid]))$$, 'for movies');
select test.expect_eq(test.mo_night('mo_a'), 'open:-'::text, 'the refused pick left the night open');
select public.pick_movie_night_title(test.v('mo_a'), test.mo_media(8830), current_date,
  test.viewers(array['1b1b1b1b-0000-0000-0000-000000000002'::uuid]));
select test.expect_eq(test.mo_night('mo_a'), 'closed:MO8830'::text, 'a movie that was not a card can still be picked');

-- ---- Watched together ----------------------------------------------------------------------------------------------
-- The family logs the series it has on its list: it is on the Watched together list, but not in the nights.
select test.expect_eq(test.mo_logged(), 0::bigint, 'no logged night so far');
:as_uma
select public.log_watch(test.mo_item(8841), current_date,
  test.viewers(array['1a1a1a1a-0000-0000-0000-000000000001'::uuid, '1b1b1b1b-0000-0000-0000-000000000002'::uuid]));
select test.expect_eq((select status from public.list_items where id = test.mo_item(8841)), 'watched'::text,
  'the series is watched together on the family list');
select test.expect_eq(test.mo_logged(), 0::bigint, 'and it made no night in the history');
-- A movie logged the same way does.
select public.log_watch(test.mo_item(8825), current_date, test.viewers(array['1a1a1a1a-0000-0000-0000-000000000001'::uuid]));
select test.expect_eq(test.mo_logged(), 1::bigint, 'a movie watched together still makes a logged night');

-- A night made before this, with a series card, still ends when the family logs that series.
reset role;
with n as (
  insert into public.movie_nights (group_id, started_by) values (:fam, :uma) returning id
), s as (
  insert into public.movie_night_stacks (night_id, position, created_by) select id, 1, :uma from n returning id, night_id
)
insert into public.movie_night_candidates (night_id, stack_id, media_id, origin, position)
select s.night_id, s.id, test.mo_media(8843), 'suggested', 1 from s;
select id as old_night from public.movie_nights where group_id = :fam and status = 'open' \gset
insert into test.vals values ('mo_old', :'old_night');
:as_uma
insert into public.list_items (group_id, added_by, media_id) values (:fam, :uma, test.mo_media(8843));
select public.log_watch(test.mo_item(8843), current_date, test.viewers(array['1a1a1a1a-0000-0000-0000-000000000001'::uuid]));
select test.expect_eq(test.mo_night('mo_old'), 'closed:SO8843'::text, 'an older night with that series as a card ended with it');
select test.expect_eq(test.mo_logged(), 1::bigint, 'and still made no second night');
