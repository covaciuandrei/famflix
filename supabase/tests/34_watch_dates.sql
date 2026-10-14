\set ON_ERROR_STOP 1
-- The day a title was watched on, or that nobody remembers it: a viewing with no day (null) is a viewing all the same.
-- A title can be marked Watched with no day and watched again later, and the viewing it had is kept with no day, not
-- with today's. Episodes can be ticked with no day (catching up on a series), stay in the history that way, and be given
-- a day afterwards (redate_episodes), which is also how a wrong day is put right. What has no day is never counted for a
-- year. Covered here: a movie's viewing with no day in the history (not as today), twice and among dated ones; ticking
-- with no day (a range, the next episode) and the future still refused; a series finished by ticking, on the day of the
-- ticks or with none; giving ticked episodes a day, or none, and what that may not do (tick, touch other people's or a
-- family's, movies, absurd days); an episode watched again and a series started again with no day in them (a second pass
-- too); a series marked Watched with no day; a viewing with no day kept when a family's watch is taken off; what Your
-- year counts; the data download; and that the histories keep any number of viewings with no day but one of each day.
-- Titles are called WD<name>: Movie (7901), Mini (7902, ended, 3 episodes), Big (7903, ended, 2 seasons of 2), Marked
-- (7904, ended, 2), Fam (7905, a family's series) and Shared (7906, a movie Fay watched on her own, then the family together).
\set as_eli  'reset role; select set_config(''request.jwt.claim.sub'', ''4d4d4d4d-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_fay  'reset role; select set_config(''request.jwt.claim.sub'', ''4e4e4e4e-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set eli '''4d4d4d4d-0000-0000-0000-000000000001'''
\set fay '''4e4e4e4e-0000-0000-0000-000000000002'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:eli, 'eli34@x.test', '{"full_name":"Eli"}'),
  (:fay, 'fay34@x.test', '{"full_name":"Fay"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
-- A person's viewings of a movie in the history, oldest first, the ones with no day last: "2026-01-10,unknown,unknown".
create function test.wd_hist(p_user uuid, p_tmdb integer) returns text language sql stable security definer as $$
  select coalesce(string_agg(coalesce(h.watched_on::text, 'unknown'), ',' order by h.watched_on nulls last), '')
  from public.watch_history h join public.media m on m.id = h.media_id
  where h.user_id = p_user and m.tmdb_id = p_tmdb $$;
-- A person's My list entry for a title: "watched@2026-01-10", "watched@unknown", "want" or "none".
create function test.wd_mine(p_user uuid, p_tmdb integer) returns text language sql stable security definer as $$
  select coalesce((select li.status || case when li.status = 'watched'
                                            then '@' || coalesce((li.watched_at at time zone 'UTC')::date::text, 'unknown') else '' end
                   from public.list_items li join public.media m on m.id = li.media_id
                   where li.group_id is null and li.added_by = p_user and m.tmdb_id = p_tmdb and li.deleted_at is null), 'none') $$;
-- The days of a series' ticked episodes, in order: "1x1=2026-01-10, 1x2=unknown".
create function test.wd_ticks(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(e.season_number || 'x' || e.episode_number || '=' || coalesce(e.watched_on::text, 'unknown'), ', '
                             order by e.season_number, e.episode_number), '')
  from public.episode_logs e where e.list_item_id = p_item $$;
-- The same for the history, with the pass: "1x1=unknown/p1". Episodes watched again on their own have no pass: "/p-".
create function test.wd_earlier(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(h.season_number || 'x' || h.episode_number || '=' || coalesce(h.watched_on::text, 'unknown') || '/p' || coalesce(h.pass::text, '-'), ', '
                             order by h.season_number, h.episode_number, h.pass nulls last, h.watched_on nulls last), '')
  from public.episode_history h where h.list_item_id = p_item $$;
-- How many episodes of one of Eli's series (by the name it has here) Your year counts, in a year or in all time.
create function test.wd_n(p_name text, p_year integer default null) returns integer language sql stable as $$
  select coalesce((public.my_episode_counts(p_year) -> 'by_series' ->> test.v('wd_' || p_name)::text)::integer, 0) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

select (current_date - 300)::text as d1, (current_date - 200)::text as d2, (current_date - 100)::text as d3,
       (current_date - 50)::text as d4 \gset

insert into public.media (tmdb_id, media_type, title, series) values
  (7901, 'movie', 'WDMovie', null),
  (7902, 'tv', 'WDMini', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 3}], "last_aired": {"s": 1, "e": 3}, "next_air": null}'),
  (7903, 'tv', 'WDBig', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}, {"n": 2, "episodes": 2}], "last_aired": {"s": 2, "e": 2}, "next_air": null}'),
  (7904, 'tv', 'WDMarked', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}'),
  (7905, 'tv', 'WDFam', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}'),
  (7906, 'movie', 'WDShared', null);

-- Eli has four titles on My list and a family with Fay, whose list has WDShared; the family has WDFam and WDShared.
:as_eli
insert into public.list_items (group_id, added_by, media_id)
  select null, :eli, id from public.media where tmdb_id in (7901, 7902, 7903, 7904);
select public.create_group('Dates Fam');
reset role;
insert into test.vals
  select 'wd_' || case m.tmdb_id when 7901 then 'movie' when 7902 then 'mini' when 7903 then 'big' else 'marked' end, li.id::text
  from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :eli and li.group_id is null;
insert into test.vals select 'wd_famid', id::text from public.groups where name = 'Dates Fam';
insert into test.vals select 'wd_code', invite_code from public.groups where name = 'Dates Fam';
:as_fay
select public.join_group((select v from test.vals where k = 'wd_code'));
insert into public.list_items (group_id, added_by, media_id) select null, :fay, id from public.media where tmdb_id = 7906;
:as_eli
insert into public.list_items (group_id, added_by, media_id)
  select test.v('wd_famid'), :eli, id from public.media where tmdb_id in (7905, 7906);
reset role;
insert into test.vals select 'wd_fam', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('wd_famid') and m.tmdb_id = 7905;
insert into test.vals select 'wd_shared', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('wd_famid') and m.tmdb_id = 7906;
insert into test.vals select 'wd_fayshared', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id is null and li.added_by = :fay and m.tmdb_id = 7906;

-- ---- A movie watched on a day nobody remembers ------------------------------------------------------------------------
:as_eli
update public.list_items set status = 'watched', watched_at = null where id = test.v('wd_movie');
select test.expect_eq(test.wd_mine(:eli, 7901), 'watched@unknown', 'a title can be marked Watched with no day');
select public.watch_again(test.v('wd_movie'));
select test.expect_eq(test.wd_hist(:eli, 7901), 'unknown', 'watching it again keeps that viewing with no day, not as today''s');
select test.expect_eq(test.wd_mine(:eli, 7901), 'want', 'and it is back on To watch');
select test.expect_eq((select count(*) from public.watch_history where watched_on = current_date), 0::bigint, 'nothing is in the history as watched today');

update public.list_items set status = 'watched', watched_at = null where id = test.v('wd_movie');
select public.watch_again(test.v('wd_movie'));
select test.expect_eq(test.wd_hist(:eli, 7901), 'unknown,unknown', 'a second viewing with no day is one more: each is a viewing');

update public.list_items set status = 'watched', watched_at = ((:'d1'::date + interval '12 hours') at time zone 'UTC') where id = test.v('wd_movie');
select public.watched_again(test.v('wd_movie'), :'d2'::date);
select test.expect_eq(test.wd_hist(:eli, 7901), :'d1' || ',unknown,unknown', 'a dated viewing goes into the history with its day, among the others');
select test.expect_eq(test.wd_mine(:eli, 7901), 'watched@' || :'d2', 'and the new viewing is the entry''s day');

update public.list_items set watched_at = null where id = test.v('wd_movie');
select public.watched_again(test.v('wd_movie'), :'d3'::date);
select test.expect_eq(test.wd_hist(:eli, 7901), :'d1' || ',unknown,unknown,unknown', 'watched again on a day, a viewing with no day is kept with no day');
select test.expect_eq(test.wd_mine(:eli, 7901), 'watched@' || :'d3', 'and the entry has the new day');
select test.expect_eq((select count(*) from public.watch_history where watched_on = current_date), 0::bigint, 'still nothing as today');

-- ---- Ticking episodes with no day -------------------------------------------------------------------------------------------
select test.expect_eq((public.mark_episodes(test.v('wd_mini'), true, 1, 1, 1, 2, null) ->> 'changed'), '2'::text, 'two episodes are ticked with no day');
select test.expect_eq(test.wd_ticks(test.v('wd_mini')), '1x1=unknown, 1x2=unknown', 'they have no day');
select test.expect_eq(test.wd_n('mini'), 0, 'Your year counts none of them, in all time');
select test.expect_eq(test.wd_n('mini', extract(year from current_date)::integer), 0, 'nor in this year');
select test.expect_error($$select public.mark_episodes(test.v('wd_mini'), true, 1, 3, 1, 3, current_date + 5)$$, 'not in the future');
select test.expect_error($$select public.mark_next_episode(test.v('wd_mini'), current_date + 5)$$, 'not in the future');
select test.expect_eq((public.mark_next_episode(test.v('wd_mini'), null) ->> 'completed'), 'true'::text, 'the next episode is ticked with no day, and that finishes the series');
select test.expect_eq(test.wd_ticks(test.v('wd_mini')), '1x1=unknown, 1x2=unknown, 1x3=unknown', 'it has no day either');
select test.expect_eq(test.wd_mine(:eli, 7902), 'watched@unknown', 'and the series, finished with no day, is Watched with no day');
select test.expect_eq(test.wd_n('mini'), 0, 'none of it is counted');
-- Without saying a day it is still today.
select public.mark_episodes(test.v('wd_big'), true, 1, 1, 1, 1);
select test.expect_eq(test.wd_ticks(test.v('wd_big')), '1x1=' || current_date, 'with no day said, an episode is ticked today, as before');
select test.expect_eq(test.wd_n('big'), 1, 'and counted');
select public.mark_episodes(test.v('wd_big'), false, 1, 1, 1, 1);

-- ---- A series finished by ticking is watched on the day of the ticks ----------------------------------------------------------
select public.mark_episodes(test.v('wd_marked'), true, 1, 1, 1, 2, :'d2'::date);
select test.expect_eq(test.wd_mine(:eli, 7904), 'watched@' || :'d2', 'a series finished with ticks of a day is watched on that day, not today');
select public.mark_episodes(test.v('wd_marked'), false, 1, 1, 1, 2);
select test.expect_eq(test.wd_mine(:eli, 7904), 'want', 'unticked, it is back on To watch');
select public.mark_episodes(test.v('wd_marked'), true, 1, 1, 1, 2, null);
select test.expect_eq(test.wd_mine(:eli, 7904), 'watched@unknown', 'finished with ticks that have no day, it has no day either');
select public.mark_episodes(test.v('wd_marked'), false, 1, 1, 1, 2);

-- ---- Giving ticked episodes a day, or none ----------------------------------------------------------------------------------
select test.expect_eq(public.redate_episodes(test.v('wd_mini'), 1, 1, 1, 2, :'d1'::date), 2, 'two ticked episodes are given a day');
select test.expect_eq(test.wd_ticks(test.v('wd_mini')), '1x1=' || :'d1' || ', 1x2=' || :'d1' || ', 1x3=unknown', 'only those in the range');
select test.expect_eq(test.wd_n('mini'), 2, 'now they count');
select test.expect_eq(test.wd_n('mini', extract(year from :'d1'::date)::integer), 2, 'in the year of that day');
select test.expect_eq(public.redate_episodes(test.v('wd_mini'), 1, 2, 1, 3, null), 2, 'a day can be taken off again');
select test.expect_eq(test.wd_ticks(test.v('wd_mini')), '1x1=' || :'d1' || ', 1x2=unknown, 1x3=unknown', 'so two have none');
select test.expect_eq(test.wd_n('mini'), 1, 'and the count goes down');
select test.expect_eq(public.redate_episodes(test.v('wd_mini'), 1, 3, 1, 3, :'d2'::date), 1, 'one episode is a range of one');
-- It only changes ticks that are there.
select public.mark_episodes(test.v('wd_big'), true, 1, 1, 1, 1, :'d3'::date);
select test.expect_eq(public.redate_episodes(test.v('wd_big'), 1, 1, 2, 2, :'d4'::date), 1, 'episodes in the range that are not ticked are left alone');
select test.expect_eq(test.wd_ticks(test.v('wd_big')), '1x1=' || :'d4', 'and not ticked by it');
-- What it refuses.
select test.expect_error($$select public.redate_episodes(test.v('wd_mini'), 1, 1, 1, 1, current_date + 5)$$, 'not in the future');
select test.expect_error($$select public.redate_episodes(test.v('wd_mini'), 3, 1, 3, 1, current_date)$$, 'not listed');
select test.expect_error($$select public.redate_episodes(test.v('wd_mini'), 1, 9, 1, 9, current_date)$$, 'not listed');
select test.expect_error($$select public.redate_episodes(test.v('wd_mini'), 1, 3, 1, 1, current_date)$$, 'in order');
select test.expect_error($$select public.redate_episodes(test.v('wd_mini'), null, 1, 1, 1, current_date)$$, 'Pick the episodes');
select test.expect_error($$select public.redate_episodes(test.v('wd_movie'), 1, 1, 1, 1, current_date)$$, 'no episode list');
select test.expect_error($$select public.redate_episodes(test.v('wd_fam'), 1, 1, 1, 1, current_date)$$, 'not on your My list');
select test.expect_error($$select public.redate_episodes('00000000-0000-0000-0000-00000000dead', 1, 1, 1, 1, current_date)$$, 'not on your My list');
:as_fay
select test.expect_error($$select public.redate_episodes(test.v('wd_mini'), 1, 1, 1, 1, current_date)$$, 'not on your My list');
:as_anon
select test.expect_error($$select public.redate_episodes(test.v('wd_mini'), 1, 1, 1, 1, current_date)$$, 'permission denied');
:as_eli
select test.expect_eq(test.wd_ticks(test.v('wd_mini')), '1x1=' || :'d1' || ', 1x2=unknown, 1x3=' || :'d2', 'and none of that changed anything');

-- ---- An episode watched again, and a series started again, with no day in them ---------------------------------------------------
select public.watch_episode_again(test.v('wd_mini'), 1, 2, :'d4'::date);
select test.expect_eq(test.wd_ticks(test.v('wd_mini')), '1x1=' || :'d1' || ', 1x2=' || :'d4' || ', 1x3=' || :'d2', 'an episode with no day watched again has the new day');
select test.expect_eq(test.wd_earlier(test.v('wd_mini')), '1x2=unknown/p-', 'and keeps the viewing with no day in its history');
select test.expect_eq((select count(*) from public.episode_history where watched_on = current_date), 0::bigint, 'not as today');
select public.redate_episodes(test.v('wd_mini'), 1, 3, 1, 3, null);
select public.watch_episode_again(test.v('wd_mini'), 1, 3, :'d3'::date);
select test.expect_eq(test.wd_earlier(test.v('wd_mini')), '1x2=unknown/p-, 1x3=unknown/p-', 'each episode keeps its own');

-- A series started again: the ticks with no day go into its history with no day, once per pass.
select public.mark_episodes(test.v('wd_big'), false, 1, 1, 1, 1);
select public.mark_episodes(test.v('wd_big'), true, 1, 1, 1, 2, null);
select public.mark_episodes(test.v('wd_big'), true, 2, 1, 2, 1, :'d1'::date);
select public.watch_series_again(test.v('wd_big'));
select test.expect_eq(test.wd_earlier(test.v('wd_big')), '1x1=unknown/p1, 1x2=unknown/p1, 2x1=' || :'d1' || '/p1', 'starting again keeps the days it had, and the ones it did not');
select test.expect_eq(test.wd_ticks(test.v('wd_big')), '', 'with nothing ticked');
select test.expect_eq(test.wd_n('big'), 1, 'only the day it had is counted');
select public.mark_episodes(test.v('wd_big'), true, 1, 1, 1, 1, null);
select public.watch_series_again(test.v('wd_big'));
select test.expect_eq((select count(*) from public.episode_history where list_item_id = test.v('wd_big') and season_number = 1 and episode_number = 1 and watched_on is null),
  2::bigint, 'a second pass with no day for the same episode is kept next to the first');
select test.expect_eq((select string_agg(distinct pass::text, ',') from public.episode_history where list_item_id = test.v('wd_big')), '1,2', 'as passes 1 and 2');

-- ---- A series marked Watched with no day -------------------------------------------------------------------------------------------
update public.list_items set status = 'watched', watched_at = null where id = test.v('wd_marked');
select test.expect_eq(test.wd_n('marked'), 0, 'a series marked Watched with no day counts no episodes');
select public.mark_episodes(test.v('wd_marked'), false, 1, 1, 1, 1);
select test.expect_eq(test.wd_ticks(test.v('wd_marked')), '1x2=unknown', 'unticking one makes the others real ticks, with no day, not today''s');
select test.expect_eq(test.wd_n('marked'), 0, 'still none counted');
select public.mark_episodes(test.v('wd_marked'), true, 1, 1, 1, 1, null);
select public.watch_series_again(test.v('wd_marked'));
select test.expect_eq(test.wd_earlier(test.v('wd_marked')), '1x1=unknown/p1, 1x2=unknown/p1', 'started again, its episodes are kept with no day');
update public.list_items set status = 'watched', watched_at = null where id = test.v('wd_marked');
select public.watch_series_again(test.v('wd_marked'));
select test.expect_eq(test.wd_earlier(test.v('wd_marked')), '1x1=unknown/p1, 1x1=unknown/p2, 1x2=unknown/p1, 1x2=unknown/p2',
  'a series marked Watched with no day and no ticks is kept with no day for every episode');
select test.expect_eq((select count(*) from public.episode_history where list_item_id = test.v('wd_marked') and watched_on = current_date), 0::bigint, 'none as today');
update public.list_items set status = 'watched', watched_at = null where id = test.v('wd_marked');
select public.watch_episode_again(test.v('wd_marked'), 1, 2, :'d2'::date);
select test.expect_eq(test.wd_earlier(test.v('wd_marked')), '1x1=unknown/p1, 1x1=unknown/p2, 1x2=unknown/p1, 1x2=unknown/p2, 1x2=unknown/p-',
  'an episode of a series marked Watched with no day is kept with no day when it is watched again');
select test.expect_eq(test.wd_ticks(test.v('wd_marked')), '1x2=' || :'d2', 'and gets the new day');
select test.expect_eq(test.wd_n('marked'), 1, 'only the episode with a day is counted');

-- ---- What a person watched on their own, with no day, stays when a family's watch of it is taken off --------------------------
:as_fay
update public.list_items set status = 'watched', watched_at = null where id = test.v('wd_fayshared');
select public.watch_again(test.v('wd_fayshared'));
select test.expect_eq(test.wd_hist(:fay, 7906), 'unknown', 'Fay''s viewing on her own, with no day, is in her history');
:as_eli
select public.log_watch(test.v('wd_shared'), current_date - 3, '[{"user_id":"4e4e4e4e-0000-0000-0000-000000000002","score":null}]');
reset role;
select test.expect_eq((select watch_origin from public.list_items where id = test.v('wd_fayshared')), 'converted'::text, 'the family''s watch marked it Watched on her list');
:as_fay
delete from public.watches where list_item_id = test.v('wd_shared') and user_id = :fay;
select test.expect_eq(test.wd_mine(:fay, 7906), 'watched@unknown', 'saying she wasn''t there keeps what she had watched before: the viewing with no day');

-- ---- The data download keeps the viewings with no day -------------------------------------------------------------------------------
:as_eli
select public.redate_episodes(test.v('wd_mini'), 1, 1, 1, 1, null);
select test.expect_eq((select count(*) from jsonb_array_elements(public.export_my_data() -> 'watch_history') e
  where e -> 'watched_on' = 'null'::jsonb and e ->> 'title' = 'WDMovie'), 3::bigint, 'the download lists the movie''s viewings with no day, as no day');
select test.expect_eq((select count(*) from jsonb_array_elements(public.export_my_data() -> 'my_list') e,
  jsonb_array_elements(e -> 'episodes') x where e ->> 'title' = 'WDMini' and x -> 'watched_on' = 'null'::jsonb), 1::bigint,
  'and the ticked episodes that have none');
select test.expect_eq((select count(*) from jsonb_array_elements(public.export_my_data() -> 'my_list') e,
  jsonb_array_elements(e -> 'earlier_episode_viewings') x where e ->> 'title' = 'WDMini' and x -> 'watched_on' = 'null'::jsonb), 2::bigint,
  'and the earlier viewings of episodes that have none');
select test.expect_eq((select count(*) from jsonb_array_elements(public.export_my_data() -> 'my_list') e
  where e ->> 'title' = 'WDMini' and e -> 'watched_at' = 'null'::jsonb), 1::bigint, 'and a title watched with no day');

-- ---- The histories keep any number of viewings with no day, but only one of each day -------------------------------------------------
reset role;
select test.expect_error($$insert into public.watch_history (user_id, media_id, watched_on)
  select '4d4d4d4d-0000-0000-0000-000000000001', id, current_date - 300 from public.media where tmdb_id = 7901$$, 'duplicate key');
insert into public.watch_history (user_id, media_id, watched_on) select :eli, id, null from public.media where tmdb_id = 7901;
select test.expect_eq(test.wd_hist(:eli, 7901), :'d1' || ',unknown,unknown,unknown,unknown', 'another viewing with no day can be added, though not another of a day');
insert into public.episode_history (list_item_id, season_number, episode_number, watched_on) select test.v('wd_mini'), 1, 2, null;
select test.expect_eq((select count(*) from public.episode_history where list_item_id = test.v('wd_mini') and season_number = 1 and episode_number = 2 and watched_on is null),
  2::bigint, 'the same goes for the history of episodes: many with no day');
insert into public.episode_history (list_item_id, season_number, episode_number, watched_on) select test.v('wd_mini'), 1, 1, '2020-02-02';
select test.expect_error($$insert into public.episode_history (list_item_id, season_number, episode_number, watched_on)
  select test.v('wd_mini'), 1, 1, '2020-02-02'$$, 'duplicate key');

do $$ begin raise notice 'ALL WATCH DATE TESTS PASSED'; end $$;
