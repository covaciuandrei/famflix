\set ON_ERROR_STOP 1
-- Picking a title that isn't one of a night's cards (after the swiping the family decided on something else): the night
-- ends with it like any pick, the title goes on the family list, the best titles join it, and nothing at all changes when
-- the pick is refused. Titles are called Q<tmdb id>.
\set as_ida  'reset role; select set_config(''request.jwt.claim.sub'', ''a1a1a1a1-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_jon  'reset role; select set_config(''request.jwt.claim.sub'', ''a2a2a2a2-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_kai  'reset role; select set_config(''request.jwt.claim.sub'', ''a3a3a3a3-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_lou  'reset role; select set_config(''request.jwt.claim.sub'', ''a4a4a4a4-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set fam '(select v::uuid from test.vals where k = ''op_fam'')'

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'ida21@x.test', '{"full_name":"Ida"}'),
  ('a2a2a2a2-0000-0000-0000-000000000002', 'jon21@x.test', '{"full_name":"Jon"}'),
  ('a3a3a3a3-0000-0000-0000-000000000003', 'kai21@x.test', '{"full_name":"Kai"}'),
  ('a4a4a4a4-0000-0000-0000-000000000004', 'lou21@x.test', '{"full_name":"Lou"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create or replace function test.cands(p_from integer, p_to integer) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id)
  from public.media where tmdb_id between p_from and p_to $$;
create or replace function test.viewers(p_ids uuid[]) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('user_id', u, 'score', null)) from unnest(p_ids) u $$;
create function test.opmedia(p_tmdb integer) returns uuid language sql stable security definer as $$
  select id from public.media where tmdb_id = p_tmdb $$;
create function test.opvote(p_night text, p_tmdb integer, p_vote text) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('candidate_id', c.id, 'vote', p_vote)
  from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = test.v(p_night) and m.tmdb_id = p_tmdb $$;
-- The family's list as "tmdb ids", sorted (without removed titles).
create function test.oplist() returns integer[] language sql stable security definer as $$
  select coalesce(array_agg(m.tmdb_id order by m.tmdb_id), '{}')
  from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('op_fam') and li.deleted_at is null $$;
-- A night as "status:picked title:ended by".
create function test.opnight(p_night text) returns text language sql stable security definer as $$
  select n.status || ':' || coalesce(m.title, '-') || ':' || coalesce(u.display_name, '-')
  from public.movie_nights n
  left join public.media m on m.id = n.picked_media_id
  left join public.profiles u on u.id = n.ended_by
  where n.id = test.v(p_night) $$;
create function test.opevents(p_kind text) returns bigint language sql stable security definer as $$
  select count(*) from public.activity where group_id = test.v('op_fam') and kind = p_kind $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into public.media (tmdb_id, media_type, title, tmdb_rating)
  select g, 'movie', 'Q' || g, (g - 9900) / 2.0 from generate_series(9971, 9995) g;

-- Ida, Jon and Kai are a family; Lou has his own.
:as_ida
select public.create_group('Own Pick Fam');
reset role;
insert into test.vals select 'op_fam', id::text from public.groups where name = 'Own Pick Fam';
insert into test.vals select 'op_code', invite_code from public.groups where name = 'Own Pick Fam';
:as_jon
select public.join_group((select v from test.vals where k = 'op_code'));
:as_kai
select public.join_group((select v from test.vals where k = 'op_code'));
:as_lou
select public.create_group('Lou Fam');

-- Q9991 was on the family list once and has been removed.
:as_ida
insert into public.list_items (group_id, added_by, media_id)
  values (:fam, 'a1a1a1a1-0000-0000-0000-000000000001', test.opmedia(9991));
update public.list_items set deleted_at = now() where group_id = :fam and media_id = test.opmedia(9991);
select test.expect_eq(test.oplist(), '{}'::integer[], 'the family list starts empty');

-- ---- Night A: some votes, then Jon picks a title that isn't one of its cards -----------------------------------------
select public.start_movie_night(:fam, array['comedy'], '{}', test.cands(9971, 9982)) as night_a \gset
reset role;
insert into test.vals values ('op_a', :'night_a');
insert into test.vals select 'op_a_stack', id::text from public.movie_night_stacks where night_id = test.v('op_a');
:as_ida
select public.cast_movie_night_votes(test.v('op_a_stack'), jsonb_build_array(
  test.opvote('op_a', 9971, 'love'), test.opvote('op_a', 9972, 'yes'), test.opvote('op_a', 9973, 'nope')));
select public.finish_movie_night_stack(test.v('op_a_stack'));
:as_jon
select public.cast_movie_night_votes(test.v('op_a_stack'), jsonb_build_array(
  test.opvote('op_a', 9971, 'yes'), test.opvote('op_a', 9972, 'yes')));
select public.finish_movie_night_stack(test.v('op_a_stack'));
:as_kai
select public.join_movie_night(test.v('op_a'));

-- Refused: someone outside the family, a visitor, a title that doesn't exist, a date in the future, nobody who watched, a
-- viewer from another family. Nothing changes: the night stays open and the list stays as it was.
:as_lou
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9990), current_date,
  test.viewers(array['a4a4a4a4-0000-0000-0000-000000000004'::uuid]))$$, 'not available');
:as_anon
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9990), current_date, '[]')$$, 'permission denied');
:as_jon
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), gen_random_uuid(), current_date,
  test.viewers(array['a2a2a2a2-0000-0000-0000-000000000002'::uuid]))$$, 'was not found');
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9990), current_date + 5,
  test.viewers(array['a2a2a2a2-0000-0000-0000-000000000002'::uuid]))$$, 'not in the future');
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9990), current_date, '[]')$$, 'at least one person');
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9990), current_date, '{}')$$, 'at least one person');
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9990), current_date,
  test.viewers(array['a4a4a4a4-0000-0000-0000-000000000004'::uuid]))$$, 'Only members of this family');
select test.expect_eq(test.opnight('op_a'), 'open:-:-'::text, 'after the refused picks the night is still open');
select test.expect_eq(test.oplist(), '{}'::integer[], 'and nothing went on the family list');
select test.expect_eq(test.opevents('watched_together'), 0::bigint, 'and nothing was logged');

-- Jon picks Q9990, which isn't one of the cards, for himself and Ida (Kai took part but wasn't there).
select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9990), current_date,
  test.viewers(array['a1a1a1a1-0000-0000-0000-000000000001'::uuid, 'a2a2a2a2-0000-0000-0000-000000000002'::uuid])) as item_a \gset
reset role;
insert into test.vals values ('op_a_item', :'item_a');
select test.expect_eq(test.opnight('op_a'), 'closed:Q9990:Jon'::text, 'the night ended with the title Jon picked');
select test.expect_eq((select happened_on from public.movie_nights where id = test.v('op_a')), current_date, 'on the day it was watched');
select test.expect_eq((select picked_list_item_id from public.movie_nights where id = test.v('op_a')), test.v('op_a_item'), 'with its list item');
select test.expect_eq(test.oplist(), array[9971, 9972, 9990], 'the pick and the two best titles are on the family list');
select test.expect_eq((select status from public.list_items where id = test.v('op_a_item')), 'watched'::text, 'the title is marked watched');
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('op_fam') and picked_media_id = test.opmedia(9990)),
  1::bigint, 'only one night has it as its pick');
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('op_fam') and source = 'logged'),
  0::bigint, 'and the watch did not make a "logged" night beside it');
select test.expect_eq((select string_agg(u.display_name || ':' || m.watched::text, ',' order by u.display_name)
  from public.movie_night_members m join public.profiles u on u.id = m.user_id where m.night_id = test.v('op_a')),
  'Ida:true,Jon:true,Kai:false'::text, 'Ida and Jon watched it; Kai took part but didn''t');
select test.expect_eq((select count(*) from public.watches where list_item_id = test.v('op_a_item')), 2::bigint, 'the watch is logged for both');
select test.expect_eq((select count(*) from public.list_items where group_id is null and source_item_id = test.v('op_a_item') and status = 'watched'),
  2::bigint, 'and it is on both their My lists as watched');
select test.expect_eq(test.opevents('watched_together'), 1::bigint, 'feed: watched together once');
select test.expect_eq((select detail from public.activity where group_id = test.v('op_fam') and kind = 'movie_night_added'), '2'::text, 'feed: two titles added from the night');
select test.expect_eq((select string_agg(kind, ',' order by created_at) from public.activity
  where group_id = test.v('op_fam') and kind in ('watched_together', 'movie_night_added')),
  'watched_together,movie_night_added'::text, 'in the same order as for a pick from the leaderboard');

-- The room sees the night as over, with what was picked.
:as_ida
select test.expect_eq((public.movie_night_state(test.v('op_a')) -> 'night' ->> 'status'), 'closed'::text, 'the room sees it as over');
select test.expect_eq((public.movie_night_state(test.v('op_a')) -> 'night' ->> 'picked_title'), 'Q9990'::text, 'with the title that was picked');

-- Once it is over nobody can pick again, and the message says who did.
:as_kai
select test.expect_error($$select public.pick_movie_night_title(test.v('op_a'), test.opmedia(9992), current_date,
  test.viewers(array['a3a3a3a3-0000-0000-0000-000000000003'::uuid]))$$, 'Jon already picked Q9990');

-- ---- Night B: a title that was removed from the list comes back, on an earlier day ------------------------------------
select public.start_movie_night(:fam, '{}', '{}', test.cands(9983, 9990)) as night_b \gset
reset role;
insert into test.vals values ('op_b', :'night_b');
:as_kai
select public.pick_movie_night_title(test.v('op_b'), test.opmedia(9991), current_date - 3,
  test.viewers(array['a3a3a3a3-0000-0000-0000-000000000003'::uuid])) as item_b \gset
reset role;
select test.expect_eq(test.opnight('op_b'), 'closed:Q9991:Kai'::text, 'a second night can be picked from like the first');
select test.expect_eq((select happened_on from public.movie_nights where id = test.v('op_b')), current_date - 3, 'on an earlier day');
select test.expect_eq(test.oplist(), array[9971, 9972, 9990, 9991], 'the removed title is back on the family list');
select test.expect_eq(test.opevents('movie_night_added'), 1::bigint, 'nobody voted, so no best titles were added');

-- ---- Night D: the same title was logged as watched together earlier today; the pick still ends its own night ----------
:as_ida
insert into public.list_items (group_id, added_by, media_id)
  values (:fam, 'a1a1a1a1-0000-0000-0000-000000000001', test.opmedia(9992)) returning id as item_l \gset
select public.log_watch(:'item_l', current_date, test.viewers(array['a1a1a1a1-0000-0000-0000-000000000001'::uuid]));
select public.start_movie_night(:fam, '{}', '{}', test.cands(9983, 9990)) as night_d \gset
reset role;
insert into test.vals values ('op_d', :'night_d');
:as_kai
select public.pick_movie_night_title(test.v('op_d'), test.opmedia(9992), current_date,
  test.viewers(array['a3a3a3a3-0000-0000-0000-000000000003'::uuid]));
reset role;
select test.expect_eq(test.opnight('op_d'), 'closed:Q9992:Kai'::text, 'the pick ended the night that was open');
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('op_fam') and picked_media_id = test.opmedia(9992)),
  2::bigint, 'next to the one logged earlier');
select test.expect_eq((select watched from public.movie_night_members where night_id = test.v('op_d') and user_id = 'a3a3a3a3-0000-0000-0000-000000000003'),
  true, 'and the person who watched is marked on it');

-- ---- A night that was cancelled or went quiet can't be picked from -----------------------------------------------------
:as_ida
select public.start_movie_night(:fam, '{}', '{}', test.cands(9983, 9990)) as night_e \gset
reset role;
insert into test.vals values ('op_e', :'night_e');
:as_ida
select public.cancel_movie_night(test.v('op_e'));
select test.expect_error($$select public.pick_movie_night_title(test.v('op_e'), test.opmedia(9993), current_date,
  test.viewers(array['a1a1a1a1-0000-0000-0000-000000000001'::uuid]))$$, 'was cancelled');
select public.start_movie_night(:fam, '{}', '{}', test.cands(9983, 9990)) as night_f \gset
reset role;
insert into test.vals values ('op_f', :'night_f');
update public.movie_nights set last_activity_at = now() - interval '13 hours' where id = test.v('op_f');
:as_jon
select test.expect_error($$select public.pick_movie_night_title(test.v('op_f'), test.opmedia(9993), current_date,
  test.viewers(array['a2a2a2a2-0000-0000-0000-000000000002'::uuid]))$$, 'ended after 12 hours');
reset role;
select test.expect_eq(test.oplist(), array[9971, 9972, 9990, 9991, 9992], 'and none of that put anything on the family list');

do $$ begin raise notice 'ALL MOVIE NIGHT (PICK ANY TITLE) TESTS PASSED'; end $$;
