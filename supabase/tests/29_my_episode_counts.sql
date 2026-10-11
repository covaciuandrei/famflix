\set ON_ERROR_STOP 1
-- Counting the episodes someone watched, for Your year: my_episode_counts(p_year) returns, as one value, how many
-- episodes the caller watched per series on My list and per month, in one year or all time. Covered here: what a viewing
-- is (an episode on one day: ticked now, kept from an earlier time, or counted by a series marked Watched), that the same
-- episode on one day counts once and on another day again, the year filter at the turn of a year, a title taken off My
-- list, what is not counted (movies, a series with no episode info, a family's titles, a series put back on To watch,
-- days that are not days), what other people see (only their own), who may call it, and absurd years.
-- Titles are called ME<name>: Mini (7401, ended, 3 episodes), Long (7402, airing: 3 episodes in season 1 and 3 in season
-- 2, with 1 of them aired), Movie (7403), NoInfo (7404), Marked (7405, ended, 2 seasons of 2), Fam (7406, a family's),
-- Edge (7407, ended, 2), Gone (7408, ended, 2), Odd (7409, ended, 2), BenSeries (7410, ended, 2).
\set as_ana    'reset role; select set_config(''request.jwt.claim.sub'', ''8a8a8a8a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_ben    'reset role; select set_config(''request.jwt.claim.sub'', ''8b8b8b8b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_anon   'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_nobody 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role authenticated;'
\set as_service 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role service_role;'
\set ana '''8a8a8a8a-0000-0000-0000-000000000001'''
\set ben '''8b8b8b8b-0000-0000-0000-000000000002'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:ana, 'ana29@x.test', '{"full_name":"Ana"}'),
  (:ben, 'ben29@x.test', '{"full_name":"Ben"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
-- What the caller is told per series, by the name of each My list entry: "edge=2, long=4"; "" for none. An entry the
-- test doesn't know (somebody else's) shows as "unknown <id>".
create function test.me_series(p_year integer) returns text language sql stable security definer as $$
  select coalesce(string_agg(coalesce(replace(v.k, 'me_', ''), 'unknown ' || j.key) || '=' || j.value, ', '
                             order by coalesce(v.k, j.key)), '')
  from jsonb_each_text(public.my_episode_counts(p_year) -> 'by_series') j
  left join test.vals v on v.v = j.key $$;
-- And per month: "2025-01=1, 2025-03=7".
create function test.me_months(p_year integer) returns text language sql stable security definer as $$
  select coalesce(string_agg(j.key || '=' || j.value, ', ' order by j.key), '')
  from jsonb_each_text(public.my_episode_counts(p_year) -> 'by_month') j $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into public.media (tmdb_id, media_type, title, series) values
  (7401, 'tv', 'MEMini', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 3}], "last_aired": {"s": 1, "e": 3}, "next_air": null}'),
  (7402, 'tv', 'MELong', '{"status": "Returning Series", "seasons": [{"n": 1, "episodes": 3}, {"n": 2, "episodes": 3}], "last_aired": {"s": 2, "e": 1}, "next_air": "2026-12-01"}'),
  (7403, 'movie', 'MEMovie', null),
  (7404, 'tv', 'MENoInfo', null),
  (7405, 'tv', 'MEMarked', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}, {"n": 2, "episodes": 2}], "last_aired": {"s": 2, "e": 2}, "next_air": null}'),
  (7406, 'tv', 'MEFam', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}'),
  (7407, 'tv', 'MEEdge', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}'),
  (7408, 'tv', 'MEGone', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}'),
  (7409, 'tv', 'MEOdd', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}'),
  (7410, 'tv', 'MEBenSeries', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}');

-- Ana has all but Fam and BenSeries on My list, and a family that has Fam; Ben has Mini and BenSeries on his own list.
:as_ana
insert into public.list_items (group_id, added_by, media_id)
  select null, :ana, id from public.media where tmdb_id in (7401, 7402, 7403, 7404, 7405, 7407, 7408, 7409);
select public.create_group('Episode Counts Fam');
reset role;
insert into test.vals select 'me_' || (array['mini', 'long', 'movie', 'noinfo', 'marked', 'fam', 'edge', 'gone', 'odd'])[m.tmdb_id - 7400], li.id::text
  from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :ana and m.tmdb_id in (7401, 7402, 7403, 7404, 7405, 7407, 7408, 7409);
insert into test.vals select 'me_fam_id', id::text from public.groups where name = 'Episode Counts Fam';
insert into public.list_items (group_id, added_by, media_id)
  select test.v('me_fam_id'), :ana, id from public.media where tmdb_id = 7406;
insert into test.vals select 'me_fam', li.id::text from public.list_items li where li.group_id = test.v('me_fam_id');
:as_ben
insert into public.list_items (group_id, added_by, media_id) select null, :ben, id from public.media where tmdb_id in (7401, 7410);
reset role;
insert into test.vals select 'me_ben_' || (case m.tmdb_id when 7401 then 'mini' else 'series' end), li.id::text
  from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :ben;

-- ---- Who may call it ------------------------------------------------------------------------------------------------
:as_anon
select test.expect_error($$select public.my_episode_counts()$$, 'permission denied');
select test.expect_error($$select public.my_episode_counts(2025)$$, 'permission denied');
:as_nobody
select test.expect_error($$select public.my_episode_counts()$$, 'must be signed in');
:as_service
select test.expect_error($$select public.my_episode_counts()$$, 'permission denied');

-- ---- With nothing watched: no counts, not an error ---------------------------------------------------------------------
:as_ana
select test.expect_eq(public.my_episode_counts(), '{"by_series": {}, "by_month": {}}'::jsonb, 'nothing watched is two empty lists');
select test.expect_eq(public.my_episode_counts(2025), '{"by_series": {}, "by_month": {}}'::jsonb, 'in a year too');
select test.expect_eq(public.my_episode_counts(null), public.my_episode_counts(), 'null for the year is all time, as is leaving it out');

-- ---- A viewing is an episode on a day: ticked now ------------------------------------------------------------------------
select public.mark_episodes(test.v('me_mini'), true, 1, 1, 1, 1, '2025-06-15'::date);
select public.mark_episodes(test.v('me_mini'), true, 1, 2, 1, 2, '2025-06-20'::date);
select test.expect_eq(test.me_series(null), 'mini=2', 'two ticked episodes are two episodes');
select test.expect_eq(test.me_months(null), '2025-06=2', 'in the month they were ticked');
select public.mark_episodes(test.v('me_mini'), true, 1, 3, 1, 3, '2025-07-04'::date);
select test.expect_eq(test.me_series(null), 'mini=3', 'the last one completes the series, which adds nothing beyond its ticks');
select test.expect_eq(test.me_months(null), '2025-06=2, 2025-07=1', 'each in its own month');
select test.expect_eq((select status from public.list_items where id = test.v('me_mini')), 'watched', 'the series is Watched now');

-- ---- A year, and none of the others ----------------------------------------------------------------------------------
select test.expect_eq(test.me_series(2025), 'mini=3', 'a year has its episodes');
select test.expect_eq(test.me_months(2025), '2025-06=2, 2025-07=1', 'and its months');
select test.expect_eq(test.me_series(2024), '', 'another year has none');
select test.expect_eq(test.me_months(2024), '', 'and no months');
select test.expect_eq(public.my_episode_counts(2024), '{"by_series": {}, "by_month": {}}'::jsonb, 'just the two empty lists');

-- ---- The same episode on another day counts again; on the same day, once -----------------------------------------------
select public.watch_episode_again(test.v('me_mini'), 1, 1, '2025-12-24'::date);
select test.expect_eq(test.me_series(null), 'mini=4', 'an episode watched again is another viewing');
select test.expect_eq(test.me_months(null), '2025-06=2, 2025-07=1, 2025-12=1', 'in the month of the new day, the old one kept');
select public.watch_series_again(test.v('me_mini'));
select test.expect_eq(test.me_series(null), 'mini=4', 'starting the series again keeps what was watched');
select public.mark_episodes(test.v('me_mini'), true, 1, 1, 1, 1, '2025-12-24'::date);
select test.expect_eq(test.me_series(null), 'mini=4', 'an episode on a day it already has in an earlier pass counts once');
select public.mark_episodes(test.v('me_mini'), true, 1, 2, 1, 2, '2025-08-01'::date);
select test.expect_eq(test.me_series(null), 'mini=5', 'and a new day for one of them counts');
select test.expect_eq(test.me_months(null), '2025-06=2, 2025-07=1, 2025-08=1, 2025-12=1', 'in its month');

-- ---- A series marked Watched counts every aired episode, dated by when it was marked ----------------------------------
-- Long has 4 aired episodes (the other 2 of season 2 have not).
update public.list_items set status = 'watched', watched_at = '2025-03-10'::date::timestamptz + interval '12 hours'
  where id = test.v('me_long');
select test.expect_eq(test.me_series(null), 'long=4, mini=5', 'a series marked Watched counts the episodes that have aired, and no others');
select test.expect_eq(test.me_months(2025), '2025-03=4, 2025-06=2, 2025-07=1, 2025-08=1, 2025-12=1', 'in the month it was marked');
-- Put back on To watch (its old date is still there), it counts for nothing.
update public.list_items set status = 'want' where id = test.v('me_long');
select test.expect_eq(test.me_series(null), 'mini=5', 'back on To watch it counts nothing');
update public.list_items set status = 'watched' where id = test.v('me_long');
select test.expect_eq(test.me_series(null), 'long=4, mini=5', 'and Watched, it counts again');

-- Marked: one episode ticked for real, then the series marked Watched: the others count by the day it was marked.
select public.mark_episodes(test.v('me_marked'), true, 1, 1, 1, 1, '2025-02-01'::date);
select test.expect_eq(test.me_series(null), 'long=4, marked=1, mini=5', 'one tick');
update public.list_items set status = 'watched', watched_at = '2025-03-10'::date::timestamptz + interval '12 hours'
  where id = test.v('me_marked');
select test.expect_eq(test.me_series(null), 'long=4, marked=4, mini=5', 'the episode ticked keeps its own day, the three others take the marked one');
select test.expect_eq(test.me_months(2025), '2025-02=1, 2025-03=7, 2025-06=2, 2025-07=1, 2025-08=1, 2025-12=1',
  'the ticked one in February and the rest in March');
-- An episode the series only counted as watched, watched again.
select public.watch_episode_again(test.v('me_marked'), 1, 2, '2025-12-25'::date);
select test.expect_eq(test.me_series(null), 'long=4, marked=5, mini=5', 'the marked day is kept and the new one added');
select test.expect_eq(test.me_months(2025), '2025-02=1, 2025-03=7, 2025-06=2, 2025-07=1, 2025-08=1, 2025-12=2', 'in March and in December');

-- ---- The turn of a year --------------------------------------------------------------------------------------------------
select public.mark_episodes(test.v('me_edge'), true, 1, 1, 1, 1, '2024-12-31'::date);
select public.mark_episodes(test.v('me_edge'), true, 1, 2, 1, 2, '2025-01-01'::date);
select test.expect_eq(test.me_series(2024), 'edge=1', 'the last day of a year is in that year');
select test.expect_eq(test.me_months(2024), '2024-12=1', 'in December');
select test.expect_eq(test.me_series(2025), 'edge=1, long=4, marked=5, mini=5', 'and the first day of the next in the next');
select test.expect_eq(test.me_months(2025), '2025-01=1, 2025-02=1, 2025-03=7, 2025-06=2, 2025-07=1, 2025-08=1, 2025-12=2', 'in January');
select test.expect_eq(test.me_series(null), 'edge=2, long=4, marked=5, mini=5', 'all time has both');

-- ---- A title taken off My list was still watched ----------------------------------------------------------------------------
select public.mark_episodes(test.v('me_gone'), true, 1, 1, 1, 1, '2025-08-05'::date);
select public.mark_episodes(test.v('me_gone'), true, 1, 2, 1, 2, '2025-08-06'::date);
update public.list_items set deleted_at = now() where id = test.v('me_gone');
select test.expect_eq((select deleted_at is not null from public.list_items where id = test.v('me_gone')), true, 'it is off My list');
select test.expect_eq(test.me_series(2025), 'edge=1, gone=2, long=4, marked=5, mini=5', 'but its episodes still count');
select test.expect_eq(test.me_months(2025), '2025-01=1, 2025-02=1, 2025-03=7, 2025-06=2, 2025-07=1, 2025-08=3, 2025-12=2', 'in their month');

-- ---- What is not counted ----------------------------------------------------------------------------------------------------
-- A movie and a series with no episode list, marked Watched; a family's series, marked Watched.
update public.list_items set status = 'watched', watched_at = '2025-04-01'::date::timestamptz + interval '12 hours'
  where id in (test.v('me_movie'), test.v('me_noinfo'));
reset role;
update public.list_items set status = 'watched', watched_at = '2025-04-01'::date::timestamptz + interval '12 hours'
  where id = test.v('me_fam');
select test.expect_eq((select count(*) from public.list_items where status = 'watched' and watched_at::date = '2025-04-01'
                         and id in (test.v('me_movie'), test.v('me_noinfo'), test.v('me_fam'))), 3::bigint, 'all three are Watched');
:as_ana
select test.expect_eq(test.me_series(null), 'edge=2, gone=2, long=4, marked=5, mini=5', 'no movie, no series without episodes, no family title');
-- Days that are not days: an episode ticked on one, and a series marked Watched on one.
select public.mark_episodes(test.v('me_odd'), true, 1, 1, 1, 1, '-infinity'::date);
update public.list_items set status = 'watched', watched_at = 'infinity' where id = test.v('me_odd');
select test.expect_eq((select count(*) from public.episode_logs where list_item_id = test.v('me_odd') and not isfinite(watched_on)), 1::bigint, 'one episode has a day that is not a day');
select test.expect_eq(test.me_series(null), 'edge=2, gone=2, long=4, marked=5, mini=5', 'it is left out, and so is the series marked on such a day');
select test.expect_eq(test.me_months(null), '2024-12=1, 2025-01=1, 2025-02=1, 2025-03=7, 2025-06=2, 2025-07=1, 2025-08=3, 2025-12=2', 'in the months too');

-- ---- All of it, from the top ------------------------------------------------------------------------------------------------
select test.expect_eq(public.my_episode_counts(2025) -> 'by_series' -> (test.v('me_marked')::text), '5'::jsonb, 'a count is a number');
select test.expect_eq((select count(*) from jsonb_object_keys(public.my_episode_counts() -> 'by_series')), 5::bigint, 'five series have episodes');
select test.expect_eq((select sum(value::integer) from jsonb_each_text(public.my_episode_counts() -> 'by_month')), 18::bigint, 'the months add up to the episodes');
select test.expect_eq((select sum(value::integer) from jsonb_each_text(public.my_episode_counts() -> 'by_series')), 18::bigint, 'as do the series');
select test.expect_eq(test.me_series(2999), '', 'a year far away has none');
select test.expect_eq(test.me_series(0), '', 'nor year 0');
select test.expect_eq(test.me_series(-5), '', 'nor a year before it');
select test.expect_eq(test.me_series(2147483647), '', 'nor the biggest number');

-- ---- Only the caller's own ----------------------------------------------------------------------------------------------------
:as_ben
select test.expect_eq(public.my_episode_counts(), '{"by_series": {}, "by_month": {}}'::jsonb, 'Ben has watched nothing, whatever Ana has');
select public.mark_episodes(test.v('me_ben_series'), true, 1, 1, 1, 1, '2025-05-05'::date);
select public.mark_episodes(test.v('me_ben_mini'), true, 1, 1, 1, 1, '2025-05-06'::date);
select test.expect_eq(test.me_series(null), 'ben_mini=1, ben_series=1', 'he is told about his own, though Ana has the same title');
select test.expect_eq(test.me_months(null), '2025-05=2', 'and his own months');
select test.expect_eq(test.me_series(2024), '', 'a year in which he watched nothing is empty');
:as_ana
select test.expect_eq(test.me_series(null), 'edge=2, gone=2, long=4, marked=5, mini=5', 'and Ana is not told about his');

-- ---- When an account goes ---------------------------------------------------------------------------------------------------------
reset role;
delete from auth.users where id = :ana;
:as_ben
select test.expect_eq(test.me_series(null), 'ben_mini=1, ben_series=1', 'Ben has what he had');

do $$ begin raise notice 'ALL EPISODE COUNT TESTS PASSED'; end $$;
