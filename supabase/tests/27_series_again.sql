\set ON_ERROR_STOP 1
-- Watching a series, or one episode, again. A series on My list keeps the episodes someone has ticked in episode_logs;
-- starting it again moves them (every aired episode when it is marked Watched) into episode_history as the next pass and
-- clears the ticks, and watching one episode again moves its day into the history and gives it the new one. Covered
-- here: who may do it, what is kept (days, scores, notes, pass numbers), a series marked Watched, an entry a family's
-- watch put on My list, the days a pass shares with an earlier one, the refusals (not watched, not aired, not listed,
-- the day it already has), who may read the history, the limit, and what happens when a title or an account goes.
-- Titles are called SA<name>: Mini (ended, 3 episodes), Long (airing: season 1 has 3 and season 2 has 3, with 1 aired),
-- Movie, NoInfo, Fam (ended, 2 episodes, watched together by a family), Eps (ended, 3) and Marked (ended, 2).
\set as_ana  'reset role; select set_config(''request.jwt.claim.sub'', ''6a6a6a6a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_ben  'reset role; select set_config(''request.jwt.claim.sub'', ''6b6b6b6b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set ana '''6a6a6a6a-0000-0000-0000-000000000001'''
\set ben '''6b6b6b6b-0000-0000-0000-000000000002'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:ana, 'ana27@x.test', '{"full_name":"Ana"}'),
  (:ben, 'ben27@x.test', '{"full_name":"Ben"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
-- A list item's earlier viewings, single episodes first and then by pass: "p1 1x1@2026-01-10 8.0|good, p- 1x2@... -|-"
-- (p- is a single episode watched again; "-|-" is no score and no note).
create function test.sa_hist(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg('p' || coalesce(pass::text, '-') || ' ' || season_number || 'x' || episode_number || '@' || watched_on
           || ' ' || coalesce(score::text, '-') || '|' || coalesce(comment, '-'),
           ', ' order by pass nulls first, season_number, episode_number, watched_on), '')
  from public.episode_history where list_item_id = p_item $$;
-- The ticked episodes: "1x1@2026-01-10 8.0|good, 1x2@2026-01-11 -|-".
create function test.sa_ticks(p_item uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(season_number || 'x' || episode_number || '@' || watched_on
           || ' ' || coalesce(score::text, '-') || '|' || coalesce(comment, '-'), ', ' order by season_number, episode_number), '')
  from public.episode_logs where list_item_id = p_item $$;
-- A My list entry: its status, whether it follows a family's watch, and whether it has a watched date.
create function test.sa_item(p_item uuid) returns text language sql stable security definer as $$
  select status || case when source_item_id is null then ' own' else ' linked' end
         || case when watched_at is null then '' else ' dated' end
  from public.list_items where id = p_item $$;
-- The passes kept for a series, as the caller sees them: "<count>" or "-".
create function test.sa_passes(p_item uuid) returns text language sql stable security definer as $$
  select coalesce((select passes::text from public.my_series_passes() where list_item_id = p_item), '-') $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

select (current_date - 60)::text as d1, (current_date - 50)::text as d2, (current_date - 40)::text as d3,
       (current_date - 30)::text as d4, (current_date - 20)::text as d5, (current_date - 10)::text as d6 \gset

insert into public.media (tmdb_id, media_type, title, series) values
  (7201, 'tv', 'SAMini', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 3}], "last_aired": {"s": 1, "e": 3}, "next_air": null}'),
  (7202, 'tv', 'SALong', '{"status": "Returning Series", "seasons": [{"n": 1, "episodes": 3}, {"n": 2, "episodes": 3}], "last_aired": {"s": 2, "e": 1}, "next_air": "2026-12-01"}'),
  (7203, 'movie', 'SAMovie', null),
  (7204, 'tv', 'SANoInfo', null),
  (7205, 'tv', 'SAFam', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}'),
  (7206, 'tv', 'SAEps', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 3}], "last_aired": {"s": 1, "e": 3}, "next_air": null}'),
  (7207, 'tv', 'SAMarked', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 2}], "last_aired": {"s": 1, "e": 2}, "next_air": null}');

-- Ana has all but Fam on My list, with Ben in her family, which has Fam; Ben has Mini on his own list.
:as_ana
insert into public.list_items (group_id, added_by, media_id) select null, :ana, id from public.media where tmdb_id in (7201, 7202, 7203, 7204, 7206, 7207);
select public.create_group('Series Again Fam');
reset role;
insert into test.vals select 'sa_' || (array['mini', 'long', 'movie', 'noinfo', 'fam', 'eps', 'marked'])[m.tmdb_id - 7200], li.id::text
  from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :ana and m.tmdb_id between 7201 and 7207;
insert into test.vals select 'sa_fam_id', id::text from public.groups where name = 'Series Again Fam';
insert into test.vals select 'sa_code', invite_code from public.groups where name = 'Series Again Fam';
:as_ben
select public.join_group((select v from test.vals where k = 'sa_code'));
insert into public.list_items (group_id, added_by, media_id) select null, :ben, id from public.media where tmdb_id = 7201;
:as_ana
insert into public.list_items (group_id, added_by, media_id) select test.v('sa_fam_id'), :ana, id from public.media where tmdb_id = 7205;
reset role;
insert into test.vals select 'sa_fam_item', li.id::text from public.list_items li where li.group_id = test.v('sa_fam_id');
insert into test.vals select 'sa_ben_mini', li.id::text from public.list_items li where li.added_by = :ben;

-- ---- Who may -------------------------------------------------------------------------------------------------------
:as_anon
select test.expect_error($$select public.watch_series_again(test.v('sa_mini'))$$, 'permission denied');
select test.expect_error($$select public.watch_episode_again(test.v('sa_mini'), 1, 1, current_date)$$, 'permission denied');
select test.expect_error($$select * from public.my_series_passes()$$, 'permission denied');
select test.expect_error($$select * from public.episode_history$$, 'permission denied');
:as_ben
select test.expect_error($$select public.watch_series_again(test.v('sa_mini'))$$, 'not on your My list');
select test.expect_error($$select public.watch_episode_again(test.v('sa_mini'), 1, 1, current_date)$$, 'not on your My list');
:as_ana
-- A family's entry, one that doesn't exist, a movie and a series with no episodes saved.
select test.expect_error($$select public.watch_series_again(test.v('sa_fam_item'))$$, 'not on your My list');
select test.expect_error($$select public.watch_series_again(gen_random_uuid())$$, 'not on your My list');
select test.expect_error($$select public.watch_series_again(test.v('sa_movie'))$$, 'no episode list');
select test.expect_error($$select public.watch_series_again(test.v('sa_noinfo'))$$, 'no episode list');
select test.expect_error($$select public.watch_episode_again(test.v('sa_fam_item'), 1, 1, current_date)$$, 'not on your My list');
select test.expect_error($$select public.watch_episode_again(test.v('sa_movie'), 1, 1, current_date)$$, 'no episode list');
select test.expect_error($$select public.watch_episode_again(test.v('sa_noinfo'), 1, 1, current_date)$$, 'no episode list');
-- Nobody writes the history through the API.
select test.expect_error($$insert into public.episode_history (list_item_id, season_number, episode_number, watched_on) values (test.v('sa_mini'), 1, 1, current_date)$$, 'permission denied');
select test.expect_error($$update public.episode_history set pass = 1$$, 'permission denied');
select test.expect_error($$delete from public.episode_history$$, 'permission denied');
-- With nothing watched there is nothing to start again.
select test.expect_error($$select public.watch_series_again(test.v('sa_mini'))$$, 'nothing to start again');

-- ---- Starting a series again: what was ticked goes to the history as pass 1 ------------------------------------------
select public.mark_episodes(test.v('sa_mini'), true, 1, 1, 1, 1, :'d1'::date);
select public.mark_episodes(test.v('sa_mini'), true, 1, 2, 1, 2, :'d2'::date);
select public.rate_episode(test.v('sa_mini'), 1, 1, 8, 'good');
select test.expect_eq(test.sa_ticks(test.v('sa_mini')), '1x1@' || :'d1' || ' 8.0|good, 1x2@' || :'d2' || ' -|-', 'two episodes are watched');
select public.watch_series_again(test.v('sa_mini')) as r \gset
select test.expect_eq(:'r'::jsonb, '{"pass": 1, "episodes": 2}'::jsonb, 'starting again says which pass was kept and how many episodes it had');
select test.expect_eq(test.sa_ticks(test.v('sa_mini')), '', 'the ticks are cleared');
select test.expect_eq(test.sa_item(test.v('sa_mini')), 'want own', 'the series is back on To watch');
select test.expect_eq(test.sa_hist(test.v('sa_mini')), 'p1 1x1@' || :'d1' || ' 8.0|good, p1 1x2@' || :'d2' || ' -|-',
  'their days, scores and notes are kept as pass 1');
select test.expect_eq((select count(*) from public.my_series_progress()), 0::bigint, 'a series with no ticks has no progress');
select test.expect_eq(test.sa_passes(test.v('sa_mini')), '1', 'and one pass in the history');
select test.expect_eq((select count(*) from public.episode_history), 2::bigint, 'Ana reads her own history');
select test.expect_error($$select public.watch_series_again(test.v('sa_mini'))$$, 'nothing to start again');
:as_ben
select test.expect_eq((select count(*) from public.episode_history), 0::bigint, 'and Ben reads none of it');
select test.expect_eq((select count(*) from public.my_series_passes()), 0::bigint, 'nor has any pass of his own');

-- ---- The next pass, finished: it completes the series like any, and starting again counts on ------------------------
:as_ana
select (public.mark_episodes(test.v('sa_mini'), true, 1, 1, 1, 3, :'d3'::date) ->> 'completed')::boolean as done \gset
select test.expect_eq(:'done'::boolean, true, 'ticking every episode of the new pass completes the series');
select test.expect_eq(test.sa_item(test.v('sa_mini')), 'watched own dated', 'it is Watched');
select public.watch_series_again(test.v('sa_mini')) as r \gset
select test.expect_eq(:'r'::jsonb, '{"pass": 2, "episodes": 3}'::jsonb, 'the next pass is number 2');
select test.expect_eq(test.sa_item(test.v('sa_mini')), 'want own', 'and the series is on To watch again');
select test.expect_eq(test.sa_hist(test.v('sa_mini')),
  'p1 1x1@' || :'d1' || ' 8.0|good, p1 1x2@' || :'d2' || ' -|-, p2 1x1@' || :'d3' || ' -|-, p2 1x2@' || :'d3' || ' -|-, p2 1x3@' || :'d3' || ' -|-',
  'both passes are in the history');
select test.expect_eq(test.sa_passes(test.v('sa_mini')), '2', 'two passes are kept');

-- A pass that shares a day with an earlier one for an episode keeps one row for it, in the latest pass.
select public.mark_episodes(test.v('sa_mini'), true, 1, 1, 1, 1, :'d3'::date);
select public.watch_series_again(test.v('sa_mini')) as r \gset
select test.expect_eq(:'r'::jsonb, '{"pass": 3, "episodes": 1}'::jsonb, 'a pass that is a day another pass had is still the next one');
select test.expect_eq(test.sa_hist(test.v('sa_mini')),
  'p1 1x1@' || :'d1' || ' 8.0|good, p1 1x2@' || :'d2' || ' -|-, p2 1x2@' || :'d3' || ' -|-, p2 1x3@' || :'d3' || ' -|-, p3 1x1@' || :'d3' || ' -|-',
  'with one row for that episode and day');
select test.expect_eq(test.sa_passes(test.v('sa_mini')), '3', 'and the passes are counted as they were started');

-- ---- A series marked Watched: every aired episode counts, dated by when it was marked -------------------------------
update public.list_items set status = 'watched', watched_at = :'d4'::date::timestamptz + interval '12 hours' where id = test.v('sa_long');
select public.watch_series_again(test.v('sa_long')) as r \gset
select test.expect_eq(:'r'::jsonb, '{"pass": 1, "episodes": 4}'::jsonb, 'a Watched series keeps every aired episode, and none that has not aired');
select test.expect_eq(test.sa_hist(test.v('sa_long')),
  'p1 1x1@' || :'d4' || ' -|-, p1 1x2@' || :'d4' || ' -|-, p1 1x3@' || :'d4' || ' -|-, p1 2x1@' || :'d4' || ' -|-',
  'each dated by the day it was marked');
select test.expect_eq(test.sa_item(test.v('sa_long')), 'want own', 'and it is back on To watch');
-- Marked Watched again, with an episode that has a score of its own: that one keeps its day, score and note.
update public.list_items set status = 'watched', watched_at = :'d5'::date::timestamptz + interval '12 hours' where id = test.v('sa_long');
select public.rate_episode(test.v('sa_long'), 1, 2, 7, 'ok');
select public.watch_series_again(test.v('sa_long')) as r \gset
select test.expect_eq(:'r'::jsonb, '{"pass": 2, "episodes": 4}'::jsonb, 'it can be done again');
select test.expect_eq(test.sa_hist(test.v('sa_long')),
  'p1 1x1@' || :'d4' || ' -|-, p1 1x2@' || :'d4' || ' -|-, p1 1x3@' || :'d4' || ' -|-, p1 2x1@' || :'d4' || ' -|-, '
  || 'p2 1x1@' || :'d5' || ' -|-, p2 1x2@' || current_date || ' 7.0|ok, p2 1x3@' || :'d5' || ' -|-, p2 2x1@' || :'d5' || ' -|-',
  'an episode with its own tick keeps it, and the rest are dated by when the series was marked');
select test.expect_eq(test.sa_ticks(test.v('sa_long')), '', 'with no tick left');

-- ---- An entry a family's watch put on My list becomes hers again ------------------------------------------------------
select public.log_watch(test.v('sa_fam_item'), :'d2'::date,
  jsonb_build_array(jsonb_build_object('user_id', :ana::uuid, 'score', null), jsonb_build_object('user_id', :ben::uuid, 'score', null)));
reset role;
insert into test.vals select 'sa_ana_fam', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.added_by = :ana and li.group_id is null and m.tmdb_id = 7205;
insert into test.vals select 'sa_ben_fam', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.added_by = :ben and li.group_id is null and m.tmdb_id = 7205;
select test.expect_eq(test.sa_item(test.v('sa_ana_fam')), 'watched linked dated', 'the family''s watch put it on her list');
:as_ana
select public.watch_series_again(test.v('sa_ana_fam')) as r \gset
select test.expect_eq(:'r'::jsonb, '{"pass": 1, "episodes": 2}'::jsonb, 'a series the family watched together can be started again too');
select test.expect_eq(test.sa_hist(test.v('sa_ana_fam')), 'p1 1x1@' || :'d2' || ' -|-, p1 1x2@' || :'d2' || ' -|-', 'with the day it was watched');
select test.expect_eq(test.sa_item(test.v('sa_ana_fam')), 'want own', 'and it is hers, no longer following the family''s watch');
-- So taking herself off the family's watch no longer takes it off her list (it would have taken her ticks with it).
delete from public.watches where list_item_id = test.v('sa_fam_item') and user_id = :ana;
select test.expect_eq(test.sa_item(test.v('sa_ana_fam')), 'want own', 'she can say she was not there and keep it');
reset role;
select test.expect_eq(test.sa_item(test.v('sa_ben_fam')), 'watched linked dated', 'and Ben''s is as it was');

-- ---- One episode again ---------------------------------------------------------------------------------------------
:as_ana
select public.mark_episodes(test.v('sa_eps'), true, 1, 1, 1, 1, :'d1'::date);
select public.rate_episode(test.v('sa_eps'), 1, 1, 8, 'good');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), 1, 2, current_date)$$, 'not watched this episode');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), 2, 1, current_date)$$, 'not listed');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), 1, 9, current_date)$$, 'not listed');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), 0, 1, current_date)$$, 'not listed');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), null, 1, current_date)$$, 'not listed');
select test.expect_error($$select public.watch_episode_again(test.v('sa_long'), 2, 2, current_date)$$, 'not aired');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), 1, 1, current_date + 5)$$, 'not in the future');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), 1, 1, null)$$, 'not in the future');
select test.expect_error($$select public.watch_episode_again(test.v('sa_eps'), 1, 1, (select watched_on from public.episode_logs where list_item_id = test.v('sa_eps')))$$,
  'already has that day');
select test.expect_eq(test.sa_hist(test.v('sa_eps')), '', 'a refused try keeps nothing');

select public.watch_episode_again(test.v('sa_eps'), 1, 1, :'d3'::date);
select test.expect_eq(test.sa_hist(test.v('sa_eps')), 'p- 1x1@' || :'d1' || ' 8.0|good', 'the day it had is kept, with its score and note');
select test.expect_eq(test.sa_ticks(test.v('sa_eps')), '1x1@' || :'d3' || ' 8.0|good', 'it has the new day and keeps its score and note');
select public.watch_episode_again(test.v('sa_eps'), 1, 1, :'d5'::date);
select test.expect_eq(test.sa_hist(test.v('sa_eps')), 'p- 1x1@' || :'d1' || ' 8.0|good, p- 1x1@' || :'d3' || ' 8.0|good', 'and each time before is kept');
-- An earlier day than the current one is allowed (it was just remembered late), and one a day it already had is too.
select public.watch_episode_again(test.v('sa_eps'), 1, 1, :'d1'::date);
select public.watch_episode_again(test.v('sa_eps'), 1, 1, :'d6'::date);
select test.expect_eq(test.sa_hist(test.v('sa_eps')),
  'p- 1x1@' || :'d1' || ' 8.0|good, p- 1x1@' || :'d3' || ' 8.0|good, p- 1x1@' || :'d5' || ' 8.0|good',
  'a day it has had before is one row, not two');
select test.expect_eq(test.sa_ticks(test.v('sa_eps')), '1x1@' || :'d6' || ' 8.0|good', 'whatever the order');
select test.expect_eq(test.sa_item(test.v('sa_eps')), 'want own', 'watching an episode again does not change the series');
select test.expect_eq(test.sa_passes(test.v('sa_eps')), '-', 'and is no pass');
-- Unticking it takes the current viewing off and leaves the history.
select public.mark_episodes(test.v('sa_eps'), false, 1, 1, 1, 1);
select test.expect_eq(test.sa_ticks(test.v('sa_eps')), '', 'unticking takes off the current day');
select test.expect_eq((select count(*) from public.episode_history where list_item_id = test.v('sa_eps')), 3::bigint, 'and none of the history');

-- A series marked Watched counts every aired episode: one watched again has the day the series was marked.
update public.list_items set status = 'watched', watched_at = :'d4'::date::timestamptz + interval '12 hours' where id = test.v('sa_marked');
select test.expect_error($$select public.watch_episode_again(test.v('sa_marked'), 1, 1, (current_date - 30))$$, 'already has that day');
select public.watch_episode_again(test.v('sa_marked'), 1, 2, :'d6'::date);
select test.expect_eq(test.sa_hist(test.v('sa_marked')), 'p- 1x2@' || :'d4' || ' -|-', 'the day it was marked is kept for it');
select test.expect_eq(test.sa_ticks(test.v('sa_marked')), '1x2@' || :'d6' || ' -|-', 'and it has a tick of its own with the new day');
select test.expect_eq(test.sa_item(test.v('sa_marked')), 'watched own dated', 'the series is still Watched');
select test.expect_error($$select public.watch_episode_again(test.v('sa_marked'), 1, 2, (current_date - 10))$$, 'already has that day');

-- ---- The limit -----------------------------------------------------------------------------------------------------
reset role;
insert into public.rate_limits (user_id, action, window_start, hits)
  values (:ben, 'watch_again', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 60)
  on conflict (user_id, action, window_start) do update set hits = 60;
:as_ben
select public.mark_episodes(test.v('sa_ben_mini'), true, 1, 1, 1, 1);
select test.expect_error($$select public.watch_series_again(test.v('sa_ben_mini'))$$, 'too often');
select test.expect_error($$select public.watch_episode_again(test.v('sa_ben_mini'), 1, 1, current_date - 3)$$, 'too often');
reset role;
delete from public.rate_limits where user_id = :ben and action = 'watch_again';

-- ---- Taking a title off My list hides it, and its history is still there when it comes back --------------------------
:as_ana
update public.list_items set deleted_at = now() where id = test.v('sa_mini');
select test.expect_eq(test.sa_passes(test.v('sa_mini')), '-', 'a title taken off My list has no passes to show');
update public.list_items set deleted_at = null where id = test.v('sa_mini');
select test.expect_eq(test.sa_passes(test.v('sa_mini')), '3', 'and has them again once it is back');

-- ---- When an account goes -----------------------------------------------------------------------------------------
reset role;
select test.expect_eq((select count(*) from public.episode_history where list_item_id = test.v('sa_mini')), 5::bigint, 'the history is there');
delete from auth.users where id = :ana;
select test.expect_eq((select count(*) from public.episode_history where list_item_id = test.v('sa_mini')), 0::bigint, 'it goes with the account');
select test.expect_eq((select count(*) from public.episode_history), 0::bigint, 'all of it, and Ben, who never started one again, has none to lose');

do $$ begin raise notice 'ALL SERIES AGAIN TESTS PASSED'; end $$;
