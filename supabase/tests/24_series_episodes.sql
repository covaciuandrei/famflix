\set ON_ERROR_STOP 1
-- Ticking the episodes of a series on My list: who may do it, which episodes (aired ones, in the series' own seasons), a
-- finished series becoming Watched by itself, a Watched series being opened up when an episode is unticked, per-episode
-- scores and notes, who can see them, the limits, and what happens when a list item or an account goes. Titles are called
-- EP<name>: Mini (ended, 5 episodes), Long (airing: season 1 has 4, season 2 has 6 and has aired 3), NoInfo (a series
-- with no seasons saved), Movie, Soap (one season of 6000), Unaired (nothing has aired) and Mini2 (cancelled, 3 episodes).
\set as_ava  'reset role; select set_config(''request.jwt.claim.sub'', ''3a3a3a3a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_bo   'reset role; select set_config(''request.jwt.claim.sub'', ''3b3b3b3b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set ava '''3a3a3a3a-0000-0000-0000-000000000001'''
\set bo  '''3b3b3b3b-0000-0000-0000-000000000002'''

insert into auth.users (id, email, raw_user_meta_data) values
  ('3a3a3a3a-0000-0000-0000-000000000001', 'ava24@x.test', '{"full_name":"Ava"}'),
  ('3b3b3b3b-0000-0000-0000-000000000002', 'bo24@x.test',  '{"full_name":"Bo"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
-- The ticked episodes of a list item as "1:1,1:2", the item's status, and whether it has a watched date.
create function test.ep_rows(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(season_number || ':' || episode_number, ',' order by season_number, episode_number), '')
  from public.episode_logs where list_item_id = p_item $$;
create function test.ep_status(p_item uuid) returns text language sql stable security definer as $$
  select status from public.list_items where id = p_item $$;
create function test.ep_dated(p_item uuid) returns boolean language sql stable security definer as $$
  select watched_at is not null from public.list_items where id = p_item $$;
-- One episode's "score|note" ("-" for none), or "none" when it isn't ticked; and the day it was ticked.
create function test.ep_row(p_item uuid, p_s integer, p_e integer) returns text language sql stable security definer as $$
  select coalesce((select coalesce(score::text, '-') || '|' || coalesce(comment, '-') from public.episode_logs
    where list_item_id = p_item and season_number = p_s and episode_number = p_e), 'none') $$;
create function test.ep_on(p_item uuid, p_s integer, p_e integer) returns date language sql stable security definer as $$
  select watched_on from public.episode_logs where list_item_id = p_item and season_number = p_s and episode_number = p_e $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into public.media (tmdb_id, media_type, title, series) values
  (8911, 'tv', 'EPMini', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 5}], "last_aired": {"s": 1, "e": 5}, "next_air": null}'),
  (8912, 'tv', 'EPLong', '{"status": "Returning Series", "seasons": [{"n": 1, "episodes": 4}, {"n": 2, "episodes": 6}], "last_aired": {"s": 2, "e": 3}, "next_air": "2026-10-18"}'),
  (8913, 'tv', 'EPNoInfo', null),
  (8914, 'movie', 'EPMovie', null),
  (8915, 'tv', 'EPSoap', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 6000}], "last_aired": {"s": 1, "e": 6000}, "next_air": null}'),
  (8916, 'tv', 'EPUnaired', '{"status": "Returning Series", "seasons": [{"n": 1, "episodes": 8}], "last_aired": null, "next_air": "2026-12-01"}'),
  (8917, 'tv', 'EPMini2', '{"status": "Canceled", "seasons": [{"n": 1, "episodes": 3}], "last_aired": {"s": 1, "e": 3}, "next_air": null}');

-- Ava has all of them on My list; Bo has Mini on his; Ava's family has Mini on its list too.
:as_ava
insert into public.list_items (group_id, added_by, media_id) select null, :ava, id from public.media where tmdb_id between 8911 and 8917;
select public.create_group('Episodes Fam');
reset role;
insert into test.vals select 'ep_' || (array['mini', 'long', 'noinfo', 'movie', 'soap', 'unaired', 'mini2'])[m.tmdb_id - 8910], li.id::text
  from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :ava and m.tmdb_id between 8911 and 8917;
insert into test.vals select 'ep_fam', id::text from public.groups where name = 'Episodes Fam';
:as_ava
insert into public.list_items (group_id, added_by, media_id)
  select test.v('ep_fam'), :ava, id from public.media where tmdb_id = 8911;
:as_bo
insert into public.list_items (group_id, added_by, media_id) select null, :bo, id from public.media where tmdb_id = 8911;
reset role;
insert into test.vals select 'ep_bo_mini', id::text from public.list_items where added_by = :bo;
insert into test.vals select 'ep_fam_mini', id::text from public.list_items where group_id = test.v('ep_fam');

-- ---- Who may tick -----------------------------------------------------------------------------------------------------
:as_anon
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, 1, 1, 1)$$, 'permission denied');
select test.expect_error($$select public.mark_next_episode(test.v('ep_mini'))$$, 'permission denied');
select test.expect_error($$select public.rate_episode(test.v('ep_mini'), 1, 1, 8, null)$$, 'permission denied');
:as_bo
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, 1, 1, 1)$$, 'not on your My list');
select test.expect_error($$select public.mark_next_episode(test.v('ep_mini'))$$, 'not on your My list');
select test.expect_error($$select public.rate_episode(test.v('ep_mini'), 1, 1, 8, null)$$, 'not on your My list');
:as_ava
-- A family's entry is not a My list entry, and neither is one that doesn't exist.
select test.expect_error($$select public.mark_episodes(test.v('ep_fam_mini'), true, 1, 1, 1, 1)$$, 'not on your My list');
select test.expect_error($$select public.mark_episodes(gen_random_uuid(), true, 1, 1, 1, 1)$$, 'not on your My list');
-- A movie, and a series nothing is known about yet, have no episodes to tick.
select test.expect_error($$select public.mark_episodes(test.v('ep_movie'), true, 1, 1, 1, 1)$$, 'no episode list');
select test.expect_error($$select public.mark_episodes(test.v('ep_noinfo'), true, 1, 1, 1, 1)$$, 'no episode list');
select test.expect_error($$select public.mark_next_episode(test.v('ep_noinfo'))$$, 'no episode list');
select test.expect_error($$select public.rate_episode(test.v('ep_noinfo'), 1, 1, 8, null)$$, 'no episode list');

-- ---- Which episodes --------------------------------------------------------------------------------------------------
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), null, 1, 1, 1, 1)$$, 'Pick the episodes');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, null, 1, 1)$$, 'Pick the episodes');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 3, 1, 3, 1)$$, 'season is not listed');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, 1, 2, 1)$$, 'season is not listed');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, 9, 1, 9)$$, 'episode is not listed');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, 3, 1, 2)$$, 'in order');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, 0, 1, 2)$$, 'in order');
select test.expect_error($$select public.mark_episodes(test.v('ep_long'), true, 2, 1, 1, 1)$$, 'in order');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), true, 1, 1, 1, 1, current_date + 5)$$, 'not in the future');
select test.expect_error($$select public.mark_next_episode(test.v('ep_mini'), current_date + 5)$$, 'not in the future');
-- Episodes that haven't aired can't be ticked, one at a time or in a season.
select test.expect_error($$select public.mark_episodes(test.v('ep_long'), true, 2, 4, 2, 4)$$, 'have not aired yet');
select test.expect_error($$select public.mark_episodes(test.v('ep_long'), true, 2, 4, 2, 99)$$, 'have not aired yet');
select test.expect_error($$select public.mark_episodes(test.v('ep_unaired'), true, 1, 1, 1, 99)$$, 'have not aired yet');
select test.expect_error($$select public.mark_next_episode(test.v('ep_unaired'))$$, 'no new episode');
-- A season of thousands can be ticked in bits, not at once.
select test.expect_error($$select public.mark_episodes(test.v('ep_soap'), true, 1, 1, 1, 99999)$$, 'too many episodes');
select test.expect_eq((select count(*) from public.episode_logs), 0::bigint, 'none of those refused calls ticked anything');

-- ---- Ticking ----------------------------------------------------------------------------------------------------------
select test.expect_eq((public.mark_episodes(test.v('ep_mini'), true, 1, 2, 1, 2) ->> 'changed')::integer, 1, 'ticking an episode');
select test.expect_eq(test.ep_rows(test.v('ep_mini')), '1:2'::text, 'it is the only one ticked');
select test.expect_eq(test.ep_on(test.v('ep_mini'), 1, 2), current_date, 'on the day it was ticked');
select test.expect_eq((public.mark_episodes(test.v('ep_mini'), true, 1, 2, 1, 2) ->> 'changed')::integer, 0, 'ticking it again changes nothing');
select public.mark_episodes(test.v('ep_mini'), true, 1, 1, 1, 1, current_date - 3);
select test.expect_eq(test.ep_on(test.v('ep_mini'), 1, 1), current_date - 3, 'an earlier day can be given');
select test.expect_eq(test.ep_on(test.v('ep_mini'), 1, 2), current_date, 'and ticking again doesn''t move the day of one that is ticked');

-- Long: a season, everything up to an episode, a whole season of which only the aired part ticks.
select test.expect_eq((public.mark_episodes(test.v('ep_long'), true, 1, 1, 1, 99) ->> 'changed')::integer, 4, 'a season is ticked up to its last episode');
select test.expect_eq(test.ep_rows(test.v('ep_long')), '1:1,1:2,1:3,1:4'::text, 'those are its episodes');
select test.expect_eq((public.mark_episodes(test.v('ep_long'), true, 1, 1, 2, 2) ->> 'changed')::integer, 2, 'up to an episode ticks what is not ticked yet');
select test.expect_eq((public.mark_episodes(test.v('ep_long'), true, 2, 1, 2, 99) ->> 'changed')::integer, 1, 'a season that is still airing ticks only what has aired');
select test.expect_eq(test.ep_rows(test.v('ep_long')), '1:1,1:2,1:3,1:4,2:1,2:2,2:3'::text, 'so season 2 stops at episode 3');
select test.expect_eq(test.ep_status(test.v('ep_long')), 'want'::text, 'a show that is still airing is not Watched by ticking it all');
select test.expect_error($$select public.mark_next_episode(test.v('ep_long'))$$, 'no new episode');

-- Unticking, and then the next episode is the first one that isn't ticked.
select test.expect_eq((public.mark_episodes(test.v('ep_long'), false, 1, 1, 1, 2) ->> 'changed')::integer, 2, 'unticking two episodes');
select test.expect_eq(test.ep_rows(test.v('ep_long')), '1:3,1:4,2:1,2:2,2:3'::text, 'they are off');
select test.expect_eq((public.mark_episodes(test.v('ep_long'), false, 1, 1, 1, 2) ->> 'changed')::integer, 0, 'unticking what isn''t ticked changes nothing');
select test.expect_eq(public.mark_next_episode(test.v('ep_long')) ->> 'season', '1'::text, 'the next episode is in season 1');
select test.expect_eq(public.mark_next_episode(test.v('ep_long')) ->> 'episode', '2'::text, 'and then the one after');
select test.expect_eq(test.ep_rows(test.v('ep_long')), '1:1,1:2,1:3,1:4,2:1,2:2,2:3'::text, 'the first one that wasn''t ticked is ticked each time');

-- ---- A finished series becomes Watched, and opens up again -------------------------------------------------------------
select test.expect_eq((public.mark_episodes(test.v('ep_mini'), true, 1, 3, 1, 4) ->> 'completed')::boolean, false, 'four of five is not done');
select test.expect_eq(test.ep_status(test.v('ep_mini')), 'want'::text, 'the series is still To watch');
select test.expect_eq(public.mark_next_episode(test.v('ep_mini')) ->> 'completed', 'true'::text, 'the fifth episode finishes it');
select test.expect_eq(test.ep_status(test.v('ep_mini')), 'watched'::text, 'and it is Watched');
select test.expect_eq(test.ep_dated(test.v('ep_mini')), true, 'with the day it was');
select test.expect_error($$select public.mark_next_episode(test.v('ep_mini'))$$, 'already marked as watched');

select test.expect_eq((public.mark_episodes(test.v('ep_mini'), false, 1, 2, 1, 2) ->> 'reopened')::boolean, true, 'unticking an episode of a Watched series reopens it');
select test.expect_eq(test.ep_status(test.v('ep_mini')), 'want'::text, 'it is back on To watch');
select test.expect_eq(test.ep_dated(test.v('ep_mini')), false, 'without a watched day');
select test.expect_eq(test.ep_rows(test.v('ep_mini')), '1:1,1:3,1:4,1:5'::text, 'with every other episode still ticked');
select test.expect_eq((public.mark_episodes(test.v('ep_mini'), true, 1, 2, 1, 2) ->> 'completed')::boolean, true, 'ticking that episode again finishes it again');
select test.expect_eq(test.ep_status(test.v('ep_mini')), 'watched'::text, 'Watched');

-- Marked Watched before there were episodes (or put there as watched by Watched together): nothing is ticked, and
-- unticking one episode ticks the rest first.
:as_bo
update public.list_items set status = 'watched', watched_at = now() where id = test.v('ep_bo_mini');
select test.expect_eq(test.ep_rows(test.v('ep_bo_mini')), ''::text, 'a series marked Watched has no ticks of its own');
select test.expect_eq((public.mark_episodes(test.v('ep_bo_mini'), false, 1, 3, 1, 3) ->> 'reopened')::boolean, true, 'unticking one of its episodes');
select test.expect_eq(test.ep_rows(test.v('ep_bo_mini')), '1:1,1:2,1:4,1:5'::text, 'leaves the other four ticked');
select test.expect_eq(test.ep_status(test.v('ep_bo_mini')), 'want'::text, 'and it is back on To watch');
-- Unticking something that isn't ticked, or hasn't aired, on a series that isn't Watched, opens nothing.
select test.expect_eq((public.mark_episodes(test.v('ep_bo_mini'), false, 1, 3, 1, 3) ->> 'reopened')::boolean, false, 'unticking an episode that is not ticked changes nothing');

-- Removing a series from My list keeps its ticks, and nothing can be ticked while it is gone.
:as_ava
update public.list_items set deleted_at = now() where id = test.v('ep_mini');
select test.expect_error($$select public.mark_episodes(test.v('ep_mini'), false, 1, 1, 1, 1)$$, 'not on your My list');
select test.expect_eq(test.ep_rows(test.v('ep_mini')), '1:1,1:2,1:3,1:4,1:5'::text, 'a removed series keeps its ticks');
update public.list_items set deleted_at = null where id = test.v('ep_mini');
select test.expect_eq((public.mark_episodes(test.v('ep_mini'), false, 1, 5, 1, 5) ->> 'changed')::integer, 1, 'and they are there when it is back');
select public.mark_episodes(test.v('ep_mini'), true, 1, 5, 1, 5);

-- ---- Scores and notes -------------------------------------------------------------------------------------------------
select test.expect_eq(public.rate_episode(test.v('ep_mini2'), 1, 1, 8.46, '  Great pilot  ') ->> 'completed', 'false'::text, 'rating an episode');
select test.expect_eq(test.ep_row(test.v('ep_mini2'), 1, 1), '8.5|Great pilot'::text, 'saves the score to one decimal and the trimmed note');
select test.expect_eq(test.ep_rows(test.v('ep_mini2')), '1:1'::text, 'and ticks the episode');
select public.rate_episode(test.v('ep_mini2'), 1, 2, null, 'only a note');
select test.expect_eq(test.ep_row(test.v('ep_mini2'), 1, 2), '-|only a note'::text, 'a note alone is enough');
select public.rate_episode(test.v('ep_mini2'), 1, 2, 7, 'then both');
select test.expect_eq(test.ep_row(test.v('ep_mini2'), 1, 2), '7.0|then both'::text, 'rating again replaces both');
select public.rate_episode(test.v('ep_mini2'), 1, 2, null, '   ');
select test.expect_eq(test.ep_row(test.v('ep_mini2'), 1, 2), '-|-'::text, 'neither a score nor a note takes them off, and the tick stays');
select test.expect_eq(test.ep_status(test.v('ep_mini2')), 'want'::text, 'two of three is not done');
select test.expect_error($$select public.rate_episode(test.v('ep_mini2'), 1, 1, 0, null)$$, 'between 1 and 10');
select test.expect_error($$select public.rate_episode(test.v('ep_mini2'), 1, 1, 10.5, null)$$, 'between 1 and 10');
select test.expect_error($$select public.rate_episode(test.v('ep_mini2'), 1, 1, 7, repeat('x', 251))$$, 'at most 250');
select test.expect_error($$select public.rate_episode(test.v('ep_long'), 2, 4, 7, null)$$, 'has not aired yet');
select test.expect_error($$select public.rate_episode(test.v('ep_long'), 3, 1, 7, null)$$, 'not listed');
select test.expect_error($$select public.rate_episode(test.v('ep_long'), 1, 9, 7, null)$$, 'not listed');
select test.expect_error($$select public.rate_episode(test.v('ep_long'), null, 1, 7, null)$$, 'not listed');
select test.expect_eq(test.ep_row(test.v('ep_mini2'), 1, 1), '8.5|Great pilot'::text, 'the refused ratings changed nothing');
-- Rating the last aired episode of a series that has ended finishes it, like ticking it.
select test.expect_eq(public.rate_episode(test.v('ep_mini2'), 1, 3, 9, null) ->> 'completed', 'true'::text, 'rating the last episode of a finished series');
select test.expect_eq(test.ep_status(test.v('ep_mini2')), 'watched'::text, 'finishes it');
-- Unticking an episode takes its score and note with it, and reopens the series.
select public.mark_episodes(test.v('ep_mini2'), false, 1, 1, 1, 1);
select test.expect_eq(test.ep_row(test.v('ep_mini2'), 1, 1), 'none'::text, 'unticking an episode takes its score and note too');
select test.expect_eq(test.ep_status(test.v('ep_mini2')), 'want'::text, 'and the series is back on To watch');
select test.expect_eq(test.ep_rows(test.v('ep_mini2')), '1:2,1:3'::text, 'with the others still ticked');

-- ---- Where each series is ---------------------------------------------------------------------------------------------
-- Ava has ticks on Long (1:1 to 2:3, all that has aired), Mini (all five), and Mini2 (1:2, 1:3); the rest have none.
select test.expect_eq((select string_agg(coalesce(m.title, '?') || ':' || p.watched || ':' || coalesce(p.next_season::text || 'x' || p.next_episode::text, 'none'), ',' order by m.title)
  from public.my_series_progress() p join public.list_items li on li.id = p.list_item_id join public.media m on m.id = li.media_id),
  'EPLong:7:none,EPMini:5:none,EPMini2:2:1x1'::text, 'progress per series: ticked aired episodes, and the next one');
select test.expect_eq((select count(*) from public.my_series_progress()), 3::bigint, 'only series with a tick are listed');
-- With gaps in two seasons, the next episode is the first of them.
select public.mark_episodes(test.v('ep_long'), false, 1, 4, 1, 4);
select public.mark_episodes(test.v('ep_long'), false, 2, 1, 2, 1);
select test.expect_eq((select p.watched || ':' || p.next_season || 'x' || p.next_episode from public.my_series_progress() p
  where p.list_item_id = test.v('ep_long')), '5:1x4'::text, 'the next episode is the first that isn''t ticked, in the earliest season');
select public.mark_episodes(test.v('ep_long'), true, 1, 4, 2, 1);
select test.expect_eq(test.ep_rows(test.v('ep_long')), '1:1,1:2,1:3,1:4,2:1,2:2,2:3'::text, 'and ticking them again puts it back');

-- ---- Who sees what ---------------------------------------------------------------------------------------------------
select test.expect_eq((select string_agg(season_number || ':' || episode_number, ',' order by season_number, episode_number)
  from public.episode_logs where list_item_id = test.v('ep_long')), test.ep_rows(test.v('ep_long')), 'Ava sees her own episodes');
select test.expect_error($$insert into public.episode_logs (list_item_id, season_number, episode_number) values (test.v('ep_long'), 2, 6)$$, 'permission denied');
select test.expect_error($$update public.episode_logs set score = 10 where list_item_id = test.v('ep_long')$$, 'permission denied');
select test.expect_error($$delete from public.episode_logs where list_item_id = test.v('ep_long')$$, 'permission denied');
select test.expect_error($$select public.series_aired('{}', 1)$$, 'permission denied');
select test.expect_error($$select public.series_aired_total('{}')$$, 'permission denied');
select test.expect_error($$select public.episodes_my_item(test.v('ep_mini'))$$, 'permission denied');
select test.expect_error($$select public.episodes_complete_if_done(test.v('ep_mini'), '{}')$$, 'permission denied');
:as_bo
select test.expect_eq((select count(*) from public.my_series_progress()), 1::bigint, 'Bo is told of his own series only');
select test.expect_eq((select watched || ':' || next_season || 'x' || next_episode from public.my_series_progress()), '4:1x3'::text, 'with his own ticks, and the episode he has yet to tick');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id = test.v('ep_long')), 0::bigint, 'Bo sees none of Ava''s episodes');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id = test.v('ep_mini2')), 0::bigint, 'nor her scores and notes');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id = test.v('ep_bo_mini')), 4::bigint, 'only his own');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id = test.v('ep_fam_mini')), 0::bigint, 'and nothing on the family''s entry');
:as_anon
select test.expect_error($$select count(*) from public.episode_logs$$, 'permission denied');
select test.expect_error($$select * from public.my_series_progress()$$, 'permission denied');

-- ---- Limits ------------------------------------------------------------------------------------------------------------
reset role;
delete from public.rate_limits where user_id = :ava;
:as_ava
select count(public.mark_episodes(test.v('ep_long'), false, 1, 1, 1, 1)) from generate_series(1, 180);
reset role;
delete from public.rate_limits where user_id = :ava;
:as_ava
select test.expect_error($$select count(public.mark_episodes(test.v('ep_long'), false, 1, 1, 1, 1)) from generate_series(1, 181)$$, 'too often');

-- ---- Going away ----------------------------------------------------------------------------------------------------------
reset role;
delete from public.rate_limits where user_id = :ava;
select test.expect_eq(test.ep_rows(test.v('ep_long')) <> '', true, 'Long still has its ticks');
delete from public.list_items where id = test.v('ep_long');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id = test.v('ep_long')), 0::bigint, 'ticks go with their list item');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id in (test.v('ep_mini'), test.v('ep_mini2'))) > 0, true, 'Ava still has some');
delete from auth.users where id = '3a3a3a3a-0000-0000-0000-000000000001';
select test.expect_eq((select count(*) from public.episode_logs where list_item_id in (test.v('ep_mini'), test.v('ep_mini2'))), 0::bigint,
  'deleting her account deletes her ticks, scores and notes');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id = test.v('ep_bo_mini')), 4::bigint, 'and nobody else''s');
