\set ON_ERROR_STOP 1
-- Movie nights and Watched together: picking a card, the best titles joining the family list, a plain Watched together
-- log closing a night (or making a "logged" one), the history staying right after "I wasn't there", and deleting accounts.
-- Titles are called P<tmdb id>; their TMDB scores rise with the id.
\set as_eli  'reset role; select set_config(''request.jwt.claim.sub'', ''e1e1e1e1-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_fay  'reset role; select set_config(''request.jwt.claim.sub'', ''e2e2e2e2-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_gus  'reset role; select set_config(''request.jwt.claim.sub'', ''e3e3e3e3-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_hal  'reset role; select set_config(''request.jwt.claim.sub'', ''e4e4e4e4-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_auth_server 'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
\set eli '''e1e1e1e1-0000-0000-0000-000000000001'''
\set fay '''e2e2e2e2-0000-0000-0000-000000000002'''
\set gus '''e3e3e3e3-0000-0000-0000-000000000003'''
\set hal '''e4e4e4e4-0000-0000-0000-000000000004'''
\set fam '(select v::uuid from test.vals where k = ''pk_fam'')'

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1e1e1e1-0000-0000-0000-000000000001', 'eli4@x.test', '{"full_name":"Eli"}'),
  ('e2e2e2e2-0000-0000-0000-000000000002', 'fay4@x.test', '{"full_name":"Fay"}'),
  ('e3e3e3e3-0000-0000-0000-000000000003', 'gus4@x.test', '{"full_name":"Gus"}'),
  ('e4e4e4e4-0000-0000-0000-000000000004', 'hal4@x.test', '{"full_name":"Hal"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create or replace function test.cands(p_from integer, p_to integer) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id)
  from public.media where tmdb_id between p_from and p_to $$;
-- A candidate of a night by its title, and a vote on it.
create function test.pcand(p_night text, p_tmdb integer) returns uuid language sql stable security definer as $$
  select c.id from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = test.v(p_night) and m.tmdb_id = p_tmdb $$;
create function test.pvote(p_night text, p_tmdb integer, p_vote text) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('candidate_id', test.pcand(p_night, p_tmdb), 'vote', p_vote) $$;
-- The family's list as "tmdb ids", sorted (without removed titles).
create function test.family_list() returns integer[] language sql stable security definer as $$
  select coalesce(array_agg(m.tmdb_id order by m.tmdb_id), '{}')
  from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('pk_fam') and li.deleted_at is null $$;
create function test.item(p_tmdb integer) returns uuid language sql stable security definer as $$
  select li.id from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('pk_fam') and m.tmdb_id = p_tmdb $$;
create function test.events(p_kind text) returns bigint language sql stable security definer as $$
  select count(*) from public.activity where group_id = test.v('pk_fam') and kind = p_kind $$;
create function test.viewers(p_ids uuid[]) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('user_id', u, 'score', null)) from unnest(p_ids) u $$;
create or replace function test.order(p_state jsonb) returns text language sql stable security definer as $$
  select coalesce(string_agg(m.title, ',' order by (r.elem ->> 'rank')::integer), '')
  from jsonb_array_elements(p_state -> 'results') as r(elem)
  join public.movie_night_candidates c on c.id = (r.elem ->> 'candidate_id')::uuid
  join public.media m on m.id = c.media_id $$;
grant execute on all functions in schema test to anon, authenticated;

insert into public.media (tmdb_id, media_type, title, tmdb_rating)
  select g, 'movie', 'P' || g, (g - 9800) / 2.0 from generate_series(9801, 9860) g;

-- Eli, Fay and Gus are a family; Hal has his own.
:as_eli
select public.create_group('Pick Fam');
reset role;
insert into test.vals select 'pk_fam', id::text from public.groups where name = 'Pick Fam';
insert into test.vals select 'pk_code', invite_code from public.groups where name = 'Pick Fam';
:as_fay
select public.join_group((select v from test.vals where k = 'pk_code'));
:as_gus
select public.join_group((select v from test.vals where k = 'pk_code'));
:as_hal
select public.create_group('Hal Fam');

-- P9802 is on the family list; P9809 was on it and has been removed.
:as_eli
insert into public.list_items (group_id, added_by, media_id) select :fam, :eli, id from public.media where tmdb_id in (9802, 9809);
update public.list_items set deleted_at = now() where group_id = :fam and media_id = (select id from public.media where tmdb_id = 9809);
select test.expect_eq(test.family_list(), array[9802], 'the family list starts with one title');

-- ---- Night A: votes, then Fay picks a low-ranked title ----------------------------------------------------------------
select public.start_movie_night(:fam, array['comedy'], '{}', test.cands(9801, 9812)) as night_a \gset
reset role;
insert into test.vals values ('pk_a', :'night_a');
insert into test.vals select 'pk_a_stack', id::text from public.movie_night_stacks where night_id = test.v('pk_a');
:as_eli
select public.cast_movie_night_votes(test.v('pk_a_stack'), jsonb_build_array(
  test.pvote('pk_a', 9801, 'love'), test.pvote('pk_a', 9802, 'yes'), test.pvote('pk_a', 9803, 'yes'), test.pvote('pk_a', 9804, 'seen'),
  test.pvote('pk_a', 9805, 'nope'), test.pvote('pk_a', 9806, 'yes'), test.pvote('pk_a', 9807, 'nope')));
select public.finish_movie_night_stack(test.v('pk_a_stack'));
:as_fay
select public.cast_movie_night_votes(test.v('pk_a_stack'), jsonb_build_array(
  test.pvote('pk_a', 9801, 'yes'), test.pvote('pk_a', 9802, 'love'), test.pvote('pk_a', 9803, 'nope'), test.pvote('pk_a', 9804, 'yes'),
  test.pvote('pk_a', 9805, 'nope'), test.pvote('pk_a', 9808, 'yes'), test.pvote('pk_a', 9809, 'yes'), test.pvote('pk_a', 9810, 'love')));
select public.finish_movie_night_stack(test.v('pk_a_stack'));
:as_gus
select public.cast_movie_night_votes(test.v('pk_a_stack'), jsonb_build_array(
  test.pvote('pk_a', 9801, 'yes'), test.pvote('pk_a', 9802, 'yes'), test.pvote('pk_a', 9803, 'yes'), test.pvote('pk_a', 9804, 'seen'),
  test.pvote('pk_a', 9805, 'nope'), test.pvote('pk_a', 9808, 'yes'), test.pvote('pk_a', 9811, 'nope')));
select public.finish_movie_night_stack(test.v('pk_a_stack'));
-- Points: 9802 and 9801 four each (the better TMDB score first), 9804 three, 9810 and 9808 two, 9809 / 9806 / 9803 one, 9811 and 9807
-- minus one, 9805 minus three. Seven titles get above the cut: 9803 is the eighth positive one.
select test.expect_eq(test.order(public.movie_night_state(test.v('pk_a'))),
  'P9802,P9801,P9804,P9810,P9808,P9809,P9806,P9803,P9811,P9807,P9805', 'the leaderboard before the pick');

-- Picking needs a night you can see, a card of it, and a valid watch; nothing is changed if any of it is refused.
:as_hal
select test.expect_error($$select public.pick_movie_night_card(test.v('pk_a'), test.pcand('pk_a', 9807), current_date,
  test.viewers(array['e4e4e4e4-0000-0000-0000-000000000004'::uuid]))$$, 'not available');
:as_anon
select test.expect_error($$select public.pick_movie_night_card(test.v('pk_a'), test.pcand('pk_a', 9807), current_date, '[]')$$, 'permission denied');
:as_fay
select test.expect_error($$select public.pick_movie_night_card(test.v('pk_a'), gen_random_uuid(), current_date, test.viewers(array['e2e2e2e2-0000-0000-0000-000000000002'::uuid]))$$, 'not in this movie night');
select test.expect_error($$select public.pick_movie_night_card(test.v('pk_a'), test.pcand('pk_a', 9807), current_date, '[]')$$, 'at least one person');
select test.expect_error($$select public.pick_movie_night_card(test.v('pk_a'), test.pcand('pk_a', 9807), current_date + 5, test.viewers(array['e2e2e2e2-0000-0000-0000-000000000002'::uuid]))$$, 'not in the future');
select test.expect_error($$select public.pick_movie_night_card(test.v('pk_a'), test.pcand('pk_a', 9807), current_date,
  test.viewers(array['e4e4e4e4-0000-0000-0000-000000000004'::uuid]))$$, 'members of this family');
select test.expect_eq(test.family_list(), array[9802], 'refused picks add nothing to the list');
select test.expect_eq((select status from public.movie_nights where id = test.v('pk_a')), 'open'::text, 'and leave the night open');

-- Fay picks P9807, near the bottom, and says she and Eli watched it yesterday.
select public.pick_movie_night_card(test.v('pk_a'), test.pcand('pk_a', 9807), current_date - 1,
  test.viewers(array['e1e1e1e1-0000-0000-0000-000000000001'::uuid, 'e2e2e2e2-0000-0000-0000-000000000002'::uuid])) as picked_item \gset
reset role;
insert into test.vals values ('pk_a_item', :'picked_item');
select test.expect_eq((select status from public.movie_nights where id = test.v('pk_a')), 'closed'::text, 'the pick closes the night');
select test.expect_eq((select picked_media_id from public.movie_nights where id = test.v('pk_a')), (select id from public.media where tmdb_id = 9807), 'with the title that was picked');
select test.expect_eq((select picked_list_item_id from public.movie_nights where id = test.v('pk_a')), test.v('pk_a_item'), 'and its list entry');
select test.expect_eq((select ended_by from public.movie_nights where id = test.v('pk_a')), :fay::uuid, 'Fay picked it');
select test.expect_eq((select happened_on from public.movie_nights where id = test.v('pk_a')), current_date - 1, 'on the day it was watched');
select test.expect_eq((select string_agg(u.display_name || ':' || m.watched::text, ',' order by u.display_name)
  from public.movie_night_members m join public.profiles u on u.id = m.user_id where m.night_id = test.v('pk_a')),
  'Eli:true,Fay:true,Gus:false'::text, 'Eli and Fay watched it; Gus took part but didn''t');
select test.expect_eq((select status from public.list_items where id = test.v('pk_a_item')), 'watched'::text, 'the title is marked watched');
select test.expect_eq((select count(*) from public.watches where list_item_id = test.v('pk_a_item')), 2::bigint, 'with two viewers');
-- The best seven joined the list: the picked title, six of the top seven, and 9802 was there already, 9809 came back.
select test.expect_eq(test.family_list(), array[9801, 9802, 9804, 9806, 9807, 9808, 9809, 9810], 'the best titles joined the family list');
select test.expect_eq((select deleted_at is null from public.list_items where id = test.item(9809)), true, 'a removed title came back');
select test.expect_eq((select count(*) from public.list_items where group_id = :fam and media_id = (select id from public.media where tmdb_id = 9803)), 0::bigint, 'the eighth, and anything nobody liked, did not');
select test.expect_eq(test.events('movie_night_added'), 1::bigint, 'the feed has one line for all of them');
select test.expect_eq((select detail from public.activity where kind = 'movie_night_added' and group_id = :fam), '6'::text, 'saying six (the picked title and the one already there don''t count)');
select test.expect_eq((select actor_name from public.activity where kind = 'movie_night_added' and group_id = :fam), 'Fay'::text, 'in the picker''s name');
select test.expect_eq(test.events('added'), 2::bigint, 'no "added" line for each title');
select test.expect_eq(test.events('restored'), 0::bigint, 'nor a "restored" one');
select test.expect_eq((select detail from public.activity where kind = 'watched_together' and group_id = :fam), 'Eli, Fay'::text, 'and Watched together is in the feed as usual');
select test.expect_eq(test.events('watched'), 0::bigint, 'without a "watched" line as well');
-- The picked title's list entry was created by the pick and is Fay's.
select test.expect_eq((select added_by from public.list_items where id = test.v('pk_a_item')), :fay::uuid, 'Fay added it');
-- Eli is asked about it, like after any Watched together.
:as_eli
select test.expect_eq((select count(*) from public.pending_rating_requests()), 1::bigint, 'Eli has a rating request for the pick');
-- Only one pick: the next person is told who got there first, and nothing changes.
:as_gus
select test.expect_error($$select public.pick_movie_night_card(test.v('pk_a'), test.pcand('pk_a', 9801), current_date,
  test.viewers(array['e3e3e3e3-0000-0000-0000-000000000003'::uuid]))$$, 'Fay already picked P9807');
select test.expect_error($$select public.cast_movie_night_votes(test.v('pk_a_stack'), '[]')$$, 'already picked');
select test.expect_eq((select count(*) from public.watches where list_item_id = test.item(9801)), 0::bigint, 'nobody was logged on P9801');
select test.expect_eq(public.movie_night_state(test.v('pk_a')) -> 'night' ->> 'picked_title', 'P9807', 'the state says what was picked');
select test.expect_eq(jsonb_array_length(public.movie_night_state(test.v('pk_a')) -> 'results'), 11, 'and everyone can see how it came out');
select test.expect_eq((select count(*) from jsonb_array_elements(public.movie_night_state(test.v('pk_a')) -> 'results') r
  where (r ->> 'on_family_list')::boolean), 8::bigint, 'with the eight titles now on the family list marked');

-- ---- Night B: a pick can bring a removed title back, and with no good votes adds nothing -----------------------------------
:as_eli
insert into public.list_items (group_id, added_by, media_id) select :fam, :eli, id from public.media where tmdb_id = 9815;
update public.list_items set deleted_at = now() where group_id = :fam and media_id = (select id from public.media where tmdb_id = 9815);
reset role;
insert into test.vals values ('pk_b_old_item', test.item(9815)::text);
:as_fay
select public.start_movie_night(:fam, '{}', '{}', test.cands(9813, 9822)) as night_b \gset
reset role;
insert into test.vals values ('pk_b', :'night_b');
:as_fay
select public.pick_movie_night_card(test.v('pk_b'), test.pcand('pk_b', 9815), current_date,
  test.viewers(array['e2e2e2e2-0000-0000-0000-000000000002'::uuid, 'e3e3e3e3-0000-0000-0000-000000000003'::uuid]));
reset role;
select test.expect_eq((select picked_list_item_id from public.movie_nights where id = test.v('pk_b')), test.v('pk_b_old_item'), 'the removed title comes back as the same list entry');
select test.expect_eq((select deleted_at is null from public.list_items where id = test.v('pk_b_old_item')), true, 'and is on the list again');
select test.expect_eq(test.events('restored'), 0::bigint, 'with no "restored" line');
select test.expect_eq(test.events('movie_night_added'), 1::bigint, 'a night nobody voted in adds no more titles, and says nothing');
select test.expect_eq(test.family_list(), array[9801, 9802, 9804, 9806, 9807, 9808, 9809, 9810, 9815], 'only the pick joined');

-- ---- Night C: a plain Watched together on one of its titles ends it -------------------------------------------------------
:as_gus
select public.start_movie_night(:fam, '{}', '{}', test.cands(9851, 9860)) as night_c \gset
reset role;
insert into test.vals values ('pk_c', :'night_c');
insert into test.vals select 'pk_c_stack', id::text from public.movie_night_stacks where night_id = test.v('pk_c');
:as_eli
insert into public.list_items (group_id, added_by, media_id) select :fam, :eli, id from public.media where tmdb_id = 9851;
select public.cast_movie_night_votes(test.v('pk_c_stack'), jsonb_build_array(test.pvote('pk_c', 9851, 'love'), test.pvote('pk_c', 9852, 'yes'), test.pvote('pk_c', 9853, 'nope')));
-- A title that isn't one of its cards doesn't end it: it just goes in the history.
insert into public.list_items (group_id, added_by, media_id) select :fam, :eli, id from public.media where tmdb_id = 9830;
select public.log_watch(test.item(9830), current_date - 3, test.viewers(array['e1e1e1e1-0000-0000-0000-000000000001'::uuid]));
reset role;
select test.expect_eq((select status from public.movie_nights where id = test.v('pk_c')), 'open'::text, 'logging another title leaves the night open');
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam and source = 'logged'), 1::bigint, 'and makes a logged night for that one');
:as_gus
select public.log_watch(test.item(9851), current_date, test.viewers(array['e1e1e1e1-0000-0000-0000-000000000001'::uuid, 'e3e3e3e3-0000-0000-0000-000000000003'::uuid]));
reset role;
select test.expect_eq((select status from public.movie_nights where id = test.v('pk_c')), 'closed'::text, 'logging one of its titles ends the night');
select test.expect_eq((select picked_list_item_id from public.movie_nights where id = test.v('pk_c')), test.item(9851), 'with that title picked');
select test.expect_eq((select ended_by from public.movie_nights where id = test.v('pk_c')), :gus::uuid, 'by whoever logged it');
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam and source = 'logged'), 1::bigint, 'and doesn''t make a second night');
select test.expect_eq((select string_agg(u.display_name || ':' || m.watched::text, ',' order by u.display_name)
  from public.movie_night_members m join public.profiles u on u.id = m.user_id where m.night_id = test.v('pk_c')),
  'Eli:true,Gus:true'::text, 'the two who watched are marked, Gus having joined by logging');
select test.expect_eq(test.family_list(), array[9801, 9802, 9804, 9806, 9807, 9808, 9809, 9810, 9815, 9830, 9851, 9852], 'its liked title joined the list (9851 was there)');
select test.expect_eq(test.events('movie_night_added'), 2::bigint, 'with a line of its own');
select test.expect_eq((select detail from public.activity where kind = 'movie_night_added' and group_id = :fam order by created_at desc limit 1), '1'::text, 'for one title');

-- ---- Logged nights: Watched together with no night going on -----------------------------------------------------------------------
:as_eli
insert into public.list_items (group_id, added_by, media_id) select :fam, :eli, id from public.media where tmdb_id = 9831;
select public.log_watch(test.item(9831), current_date - 2, test.viewers(array['e1e1e1e1-0000-0000-0000-000000000001'::uuid, 'e2e2e2e2-0000-0000-0000-000000000002'::uuid]));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam and source = 'logged' and picked_list_item_id = test.item(9831)), 1::bigint, 'a Watched together with no night makes a logged one');
select test.expect_eq((select status from public.movie_nights where group_id = :fam and picked_list_item_id = test.item(9831)), 'closed'::text, 'closed from the start');
select test.expect_eq((select started_by from public.movie_nights where group_id = :fam and picked_list_item_id = test.item(9831)), :eli::uuid, 'by the person who logged it');
select test.expect_eq((select happened_on from public.movie_nights where group_id = :fam and picked_list_item_id = test.item(9831)), current_date - 2, 'on the day it was watched');
-- Someone else logging the same title and day joins it.
:as_gus
select public.log_watch(test.item(9831), current_date - 2, test.viewers(array['e3e3e3e3-0000-0000-0000-000000000003'::uuid]));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam and picked_list_item_id = test.item(9831)), 1::bigint, 'the same title and day is still one night');
select test.expect_eq((select count(*) from public.movie_night_members m join public.movie_nights n on n.id = m.night_id
  where n.picked_list_item_id = test.item(9831) and m.watched), 3::bigint, 'with all three watching');
-- Another day is another night.
:as_eli
select public.log_watch(test.item(9831), current_date - 1, test.viewers(array['e1e1e1e1-0000-0000-0000-000000000001'::uuid]));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam and picked_list_item_id = test.item(9831)), 2::bigint, 'another day makes a second one');

-- "I wasn't there" updates the history; a logged night nobody is left on goes away, a swipe night stays.
:as_gus
delete from public.watches where list_item_id = test.item(9831) and user_id = :gus;
reset role;
select test.expect_eq((select count(*) from public.movie_night_members m join public.movie_nights n on n.id = m.night_id
  where n.picked_list_item_id = test.item(9831) and m.watched and m.user_id = :gus), 0::bigint, 'Gus is no longer marked as having watched it');
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam and picked_list_item_id = test.item(9831)), 2::bigint, 'the nights stay while others are on them');
:as_fay
delete from public.watches where list_item_id = test.item(9831) and user_id = :fay;
:as_eli
delete from public.watches where list_item_id = test.item(9831) and user_id = :eli;
reset role;
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam and picked_list_item_id = test.item(9831)), 0::bigint, 'with nobody left, the logged nights are gone');
select test.expect_eq((select status from public.list_items where id = test.item(9831)), 'want'::text, 'and the title is back on To watch');
:as_eli
delete from public.watches where list_item_id = test.v('pk_a_item') and user_id = :eli;
:as_fay
delete from public.watches where list_item_id = test.v('pk_a_item') and user_id = :fay;
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('pk_a')), 1::bigint, 'a swipe night stays in the history');
select test.expect_eq((select count(*) from public.movie_night_members where night_id = test.v('pk_a') and watched), 0::bigint, 'with nobody marked as watching');
select test.expect_eq((select picked_media_id is not null from public.movie_nights where id = test.v('pk_a')), true, 'and still knows what was picked');

-- ---- Adding the best titles after a night nobody picked from -------------------------------------------------------------------
:as_eli
select public.start_movie_night(:fam, '{}', '{}', test.cands(9841, 9850)) as night_e \gset
reset role;
insert into test.vals values ('pk_e', :'night_e');
insert into test.vals select 'pk_e_stack', id::text from public.movie_night_stacks where night_id = test.v('pk_e');
:as_eli
select public.cast_movie_night_votes(test.v('pk_e_stack'), jsonb_build_array(
  test.pvote('pk_e', 9841, 'love'), test.pvote('pk_e', 9842, 'yes'), test.pvote('pk_e', 9843, 'nope'), test.pvote('pk_e', 9844, 'seen')));
:as_fay
select public.cast_movie_night_votes(test.v('pk_e_stack'), jsonb_build_array(test.pvote('pk_e', 9842, 'yes')));
-- While it's going, nothing is added; picking is how that happens.
select test.expect_error($$select public.add_movie_night_top_titles(test.v('pk_e'))$$, 'when someone picks one');
:as_hal
select test.expect_error($$select public.add_movie_night_top_titles(test.v('pk_e'))$$, 'not available');
:as_anon
select test.expect_error($$select public.add_movie_night_top_titles(test.v('pk_e'))$$, 'permission denied');
:as_gus
select public.cancel_movie_night(test.v('pk_e'));
select test.expect_error($$select public.add_movie_night_top_titles(test.v('pk_a'))$$, 'when someone picks one');
select test.expect_error($$select public.add_movie_night_top_titles((select id from public.movie_nights where group_id = test.v('pk_fam') and source = 'logged' limit 1))$$, 'when someone picks one');
select test.expect_eq(public.add_movie_night_top_titles(test.v('pk_e')), 3, 'after cancelling, the three titles people liked can be added');
select test.expect_eq(test.family_list() @> array[9841, 9842, 9844], true, 'and are on the list');
select test.expect_eq(test.family_list() @> array[9843], false, 'but not the one that got a nope');
select test.expect_eq(test.events('movie_night_added'), 3::bigint, 'with a line in the feed');
select test.expect_eq((select detail from public.activity where kind = 'movie_night_added' and group_id = :fam order by created_at desc limit 1), '3'::text, 'for three titles');
select test.expect_eq(public.add_movie_night_top_titles(test.v('pk_e')), 0, 'doing it again adds nothing');
select test.expect_eq(test.events('movie_night_added'), 3::bigint, 'and says nothing');
-- A night that expired is the same.
:as_eli
select public.start_movie_night(:fam, '{}', '{}', test.cands(9841, 9850)) as night_e2 \gset
reset role;
insert into test.vals values ('pk_e2', :'night_e2');
insert into test.vals select 'pk_e2_stack', id::text from public.movie_night_stacks where night_id = test.v('pk_e2');
:as_eli
select public.cast_movie_night_votes(test.v('pk_e2_stack'), jsonb_build_array(test.pvote('pk_e2', 9845, 'love')));
reset role;
update public.movie_nights set last_activity_at = now() - interval '13 hours' where id = test.v('pk_e2');
:as_fay
select test.expect_eq(public.add_movie_night_top_titles(test.v('pk_e2')), 1, 'a night that expired works the same');
reset role;
select test.expect_eq((select status from public.movie_nights where id = test.v('pk_e2')), 'expired'::text, 'and is marked expired');

-- ---- Deleting an account --------------------------------------------------------------------------------------------------------------
-- Fay picked night A, started night B and voted in A. Her name leaves the history and her votes go; the family keeps its nights.
select test.expect_eq((select ended_by from public.movie_nights where id = test.v('pk_a')), :fay::uuid, 'Fay picked night A');
select test.expect_eq((select started_by from public.movie_nights where id = test.v('pk_b')), :fay::uuid, 'and started night B');
select test.expect_eq((select count(*) from public.movie_night_votes v join public.movie_night_candidates c on c.id = v.candidate_id
  where c.night_id = test.v('pk_a') and v.user_id = :fay), 8::bigint, 'and voted on eight cards in A');
:as_auth_server
delete from auth.users where id = :fay;
select test.expect_eq((select ended_by from public.movie_nights where id = test.v('pk_a')), null::uuid, 'her name is gone from who picked');
select test.expect_eq((select started_by from public.movie_nights where id = test.v('pk_b')), null::uuid, 'and from who started');
select test.expect_eq((select count(*) from public.movie_night_votes where user_id = :fay), 0::bigint, 'her votes are gone');
select test.expect_eq((select count(*) from public.movie_night_members where user_id = :fay), 0::bigint, 'and her place in every night');
select test.expect_eq((select count(*) from public.movie_night_finishes where user_id = :fay), 0::bigint, 'and her finished stacks');
select test.expect_eq((select count(*) from public.movie_nights where group_id = :fam), 6::bigint, 'the family keeps its six nights');
:as_eli
select test.expect_eq((select count(*) from jsonb_array_elements(public.movie_night_state(test.v('pk_a')) -> 'members') m where m ->> 'name' = 'Fay'), 0::bigint, 'and the night no longer lists her');
select test.expect_eq(public.movie_night_state(test.v('pk_a')) -> 'night' ->> 'status', 'closed', 'night A still reads as picked');
select test.expect_eq(public.movie_night_state(test.v('pk_a')) -> 'night' ->> 'picked_title', 'P9807', 'with its title');

reset role;
do $$ begin raise notice 'ALL MOVIE NIGHT WATCH TESTS PASSED'; end $$;
