\set ON_ERROR_STOP 1
-- Downloading your data: export_my_data() returns everything FamFlix keeps about the person who runs it, and nothing
-- that is someone else's. Covered here: every kind of data (account, families, My list with episodes, earlier viewings and
-- passes, a removed title, who a title was watched with, the watch history, a person's part of a family list, movie
-- nights with their own votes, feed events), what is left out (other people's scores, notes, reactions, e-mail
-- addresses and ids, guests, invite codes, another family's titles), what a person who left a family still gets (and
-- which names are held back), who may run it, the limit, and the inventory: every table is read by the export or is on a
-- written list of tables it leaves out, so a new table can't be forgotten. Titles are called EX<name>: Movie (7301),
-- Series (7302, 3 episodes), Removed (7303), Family (7304), FamilyOnly (7305), JoAdded (7306), KaiOnly (7307) and the
-- eight cards of a night (7311 to 7318).
\set as_ida     'reset role; select set_config(''request.jwt.claim.sub'', ''7a7a7a7a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_jo      'reset role; select set_config(''request.jwt.claim.sub'', ''7b7b7b7b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_kai     'reset role; select set_config(''request.jwt.claim.sub'', ''7c7c7c7c-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_lee     'reset role; select set_config(''request.jwt.claim.sub'', ''7d7d7d7d-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_service 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role service_role;'
\set ida '''7a7a7a7a-0000-0000-0000-000000000001'''
\set jo  '''7b7b7b7b-0000-0000-0000-000000000002'''
\set kai '''7c7c7c7c-0000-0000-0000-000000000003'''
\set lee '''7d7d7d7d-0000-0000-0000-000000000004'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:ida, 'ida28@x.test', '{"full_name":"Ida"}'),
  (:jo,  'jo28@x.test',  '{"full_name":"Jo"}'),
  (:kai, 'kai28@x.test', '{"full_name":"Kai"}'),
  (:lee, 'lee28@x.test', '{"full_name":"Lee"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create or replace function test.t(p_key text) returns text language sql stable security definer as $$
  select v from test.vals where k = p_key $$;
-- Whether the exported text (kept in test.vals as "ida_export" and so on) mentions something.
create function test.ex_has(p_key text, p_text text) returns boolean language sql stable security definer as $$
  select position(p_text in v) > 0 from test.vals where k = p_key $$;
-- The part of an export under a key, for the checks below.
create function test.ex_part(p_key text, p_part text) returns jsonb language sql stable security definer as $$
  select (v::jsonb) -> p_part from test.vals where k = p_key $$;
-- A card of night 'ex_night' by its TMDB id, and a vote on it.
create function test.ex_cand(p_tmdb integer) returns uuid language sql stable security definer as $$
  select c.id from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = test.v('ex_night') and m.tmdb_id = p_tmdb $$;
create function test.ex_vote(p_tmdb integer, p_vote text) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('candidate_id', test.ex_cand(p_tmdb), 'vote', p_vote) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

select (current_date - 60)::text as d1, (current_date - 50)::text as d2, (current_date - 40)::text as d3,
       (current_date - 30)::text as d4 \gset

insert into public.media (tmdb_id, media_type, title, release_year, series) values
  (7301, 'movie', 'EXMovie', 2020, null),
  (7302, 'tv', 'EXSeries', 2019, '{"status": "Ended", "seasons": [{"n": 1, "episodes": 3}], "last_aired": {"s": 1, "e": 3}, "next_air": null}'),
  (7303, 'movie', 'EXRemoved', 2018, null),
  (7304, 'movie', 'EXFamily', 2021, null),
  (7305, 'movie', 'EXFamilyOnly', 2022, null),
  (7306, 'movie', 'EXJoAdded', 2017, null),
  (7307, 'movie', 'EXKaiOnly', 2016, null);
insert into public.media (tmdb_id, media_type, title) select g, 'movie', 'EXCard' || g from generate_series(7311, 7318) g;

-- Ida and Jo are a family; Kai has his own; Lee has nothing.
:as_ida
select public.create_group('Export Fam');
:as_kai
select public.create_group('Kai Fam');
reset role;
insert into test.vals select 'ex_fam', id::text from public.groups where name = 'Export Fam';
insert into test.vals select 'ex_code', invite_code from public.groups where name = 'Export Fam';
insert into test.vals select 'kai_fam', id::text from public.groups where name = 'Kai Fam';
insert into test.vals select 'ex_invite', invite_code from public.groups where name = 'Export Fam';
:as_jo
select public.join_group(test.t('ex_code'));

-- ---- Ida's My list: a movie with a score and note, a series watched, started again and one episode watched again, and
-- a title she removed --------------------------------------------------------------------------------------------------
:as_ida
insert into public.list_items (group_id, added_by, media_id, status)
  select null, :ida, id, 'watched' from public.media where tmdb_id = 7301;
update public.list_items set watched_at = :'d1'::date::timestamptz + interval '12 hours'
  where group_id is null and added_by = :ida and media_id = (select id from public.media where tmdb_id = 7301);
insert into public.list_items (group_id, added_by, media_id) select null, :ida, id from public.media where tmdb_id in (7302, 7303);
reset role;
insert into test.vals select 'ex_movie', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :ida and m.tmdb_id = 7301 and li.group_id is null;
insert into test.vals select 'ex_series', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :ida and m.tmdb_id = 7302 and li.group_id is null;
insert into test.vals select 'ex_removed', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.added_by = :ida and m.tmdb_id = 7303 and li.group_id is null;
:as_ida
insert into public.ratings (list_item_id, user_id, score, comment) values (test.v('ex_movie'), :ida, 8.5, 'IDA-MOVIE-NOTE');
select public.mark_episodes(test.v('ex_series'), true, 1, 1, 1, 2, :'d1'::date);
select public.rate_episode(test.v('ex_series'), 1, 1, 9, 'IDA-FIRST-PASS-NOTE');
select public.watch_series_again(test.v('ex_series'));
select public.mark_episodes(test.v('ex_series'), true, 1, 1, 1, 1, :'d2'::date);
select public.rate_episode(test.v('ex_series'), 1, 1, 7, 'IDA-SECOND-PASS-NOTE');
select public.watch_episode_again(test.v('ex_series'), 1, 1, :'d3'::date);
update public.list_items set deleted_at = now() where id = test.v('ex_removed');

-- ---- The family's list: Ida's titles, a watch Jo logged for both of them (with a score for Ida and his own note), Jo's
-- title that Ida has nothing to do with, and a watch Ida logged for both with a score for Jo ----------------------------
insert into public.list_items (group_id, added_by, media_id) select test.v('ex_fam'), :ida, id from public.media where tmdb_id in (7304, 7305);
:as_jo
insert into public.list_items (group_id, added_by, media_id) select test.v('ex_fam'), :jo, id from public.media where tmdb_id = 7306;
reset role;
insert into test.vals select 'ex_family', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id = test.v('ex_fam') and m.tmdb_id = 7304;
insert into test.vals select 'ex_famonly', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id = test.v('ex_fam') and m.tmdb_id = 7305;
insert into test.vals select 'ex_joadded', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id = test.v('ex_fam') and m.tmdb_id = 7306;
:as_jo
select public.log_watch(test.v('ex_family'), :'d2'::date,
  jsonb_build_array(jsonb_build_object('user_id', :ida::uuid, 'score', 9), jsonb_build_object('user_id', :jo::uuid, 'score', 4)));
update public.ratings set comment = 'JO-SECRET-NOTE' where list_item_id = test.v('ex_family') and user_id = :jo;
insert into public.ratings (list_item_id, user_id, score, comment) values (test.v('ex_joadded'), :jo, 2, 'JO-ADDED-NOTE');
:as_ida
insert into public.ratings (list_item_id, user_id, score, comment) values (test.v('ex_famonly'), :ida, 6.5, 'IDA-FAMILY-NOTE');
select public.log_watch(test.v('ex_famonly'), :'d3'::date,
  jsonb_build_array(jsonb_build_object('user_id', :ida::uuid, 'score', null), jsonb_build_object('user_id', :jo::uuid, 'score', 5)));
-- A viewing of a family title that was put back on To watch: it is in her history, with the family's name.
select public.watch_again(test.v('ex_famonly'));
-- Her own movie, watched again: in her history on her own.
select public.watch_again(test.v('ex_movie'));

-- ---- Kai's own data, which none of the others may get ----------------------------------------------------------------
:as_kai
insert into public.list_items (group_id, added_by, media_id) select null, :kai, id from public.media where tmdb_id = 7307;
insert into public.list_items (group_id, added_by, media_id) select test.v('kai_fam'), :kai, id from public.media where tmdb_id = 7307;
insert into public.ratings (list_item_id, user_id, score, comment)
  select li.id, :kai, 3, 'KAI-SECRET-NOTE' from public.list_items li where li.added_by = :kai and li.group_id is null;

-- ---- A movie night: Ida and Jo vote, a guest too, and they pick a title ---------------------------------------------------
:as_ida
select public.start_movie_night(test.v('ex_fam'), '{}', '{}',
  (select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id) from public.media where tmdb_id between 7311 and 7318)) as n \gset
reset role;
insert into test.vals values ('ex_night', :'n');
insert into test.vals select 'ex_stack', id::text from public.movie_night_stacks where night_id = test.v('ex_night');
:as_ida
select public.cast_movie_night_votes(test.v('ex_stack'), jsonb_build_array(test.ex_vote(7311, 'love'), test.ex_vote(7312, 'yes'), test.ex_vote(7313, 'nope')));
select public.finish_movie_night_stack(test.v('ex_stack'));
select public.get_movie_night_guest_link(test.v('ex_night')) as tok \gset
:as_jo
select public.join_movie_night(test.v('ex_night'));
select public.cast_movie_night_votes(test.v('ex_stack'), jsonb_build_array(test.ex_vote(7311, 'nope'), test.ex_vote(7314, 'love')));
:as_service
select public.guest_join(:'tok', 'ZedGuest') ->> 'secret' as sec \gset
select public.guest_cast_votes(:'sec', test.v('ex_stack'), jsonb_build_array(test.ex_vote(7315, 'yes')));
:as_ida
select public.pick_movie_night_card(test.v('ex_night'), test.ex_cand(7311), :'d4'::date,
  jsonb_build_array(jsonb_build_object('user_id', :ida::uuid, 'score', null), jsonb_build_object('user_id', :jo::uuid, 'score', null)));

-- ---- Who may run it ------------------------------------------------------------------------------------------------------
:as_anon
select test.expect_error($$select public.export_my_data()$$, 'permission denied');
:as_service
select test.expect_error($$select public.export_my_data()$$, 'permission denied');

-- ---- Ida's export ----------------------------------------------------------------------------------------------------------
:as_ida
select public.export_my_data()::text as ida_text \gset
reset role;
insert into test.vals values ('ida_export', :'ida_text');
select test.expect_eq((select array_agg(k order by k collate "C") from jsonb_object_keys(test.t('ida_export')::jsonb) k),
  array['account', 'exported_at', 'families', 'family_lists', 'feed_events', 'movie_nights', 'my_list', 'not_included', 'watch_history'],
  'the document has the documented parts, and nothing else');
select test.expect_eq(test.ex_part('ida_export', 'account') ->> 'display_name', 'Ida'::text, 'the account is hers');
select test.expect_eq(test.ex_part('ida_export', 'account') ->> 'id', '7a7a7a7a-0000-0000-0000-000000000001'::text, 'with her id');
select test.expect_eq(test.ex_has('ida_export', 'ida28@x.test'), false, 'the e-mail address comes from the sign-in, not from the tables');
select test.expect_eq(jsonb_array_length(test.ex_part('ida_export', 'not_included')), 5, 'it says what it leaves out');
select test.expect_eq(test.ex_part('ida_export', 'families') -> 0 ->> 'name', 'Export Fam'::text, 'her family is there');
select test.expect_eq(test.ex_part('ida_export', 'families') -> 0 ->> 'role', 'owner'::text, 'with her role');
select test.expect_eq(jsonb_array_length(test.ex_part('ida_export', 'families')), 1, 'and only hers');

-- My list: the movie (put back on To watch, with its score, note and the reaction that came with the score), the series
-- with the episodes of this pass and of the one before, the title she removed, and the two Jo and she watched together.
select test.expect_eq(jsonb_array_length(test.ex_part('ida_export', 'my_list')), 6,
  'My list has every entry: hers, the removed one, the ones watched together and the night''s pick');
select test.expect_eq(test.ex_part('ida_export', 'my_list') @> '[{"title": "EXMovie", "type": "movie", "year": 2020, "status": "want", "my_score": 8.5, "my_note": "IDA-MOVIE-NOTE", "my_reaction": "like"}]'::jsonb,
  true, 'a movie with her score, note and reaction');
select test.expect_eq((select e ->> 'removed_at' is not null from jsonb_array_elements(test.ex_part('ida_export', 'my_list')) e where e ->> 'title' = 'EXRemoved'),
  true, 'a removed title says when');
select test.expect_eq((select e ->> 'removed_at' is null from jsonb_array_elements(test.ex_part('ida_export', 'my_list')) e where e ->> 'title' = 'EXMovie'),
  true, 'and the others do not');
select test.expect_eq((select e -> 'episodes' from jsonb_array_elements(test.ex_part('ida_export', 'my_list')) e where e ->> 'title' = 'EXSeries'),
  jsonb_build_array(jsonb_build_object('season', 1, 'episode', 1, 'watched_on', :'d3', 'score', 7, 'note', 'IDA-SECOND-PASS-NOTE')),
  'a series has the episodes ticked now, with their score and note');
select test.expect_eq((select e -> 'earlier_episode_viewings' from jsonb_array_elements(test.ex_part('ida_export', 'my_list')) e where e ->> 'title' = 'EXSeries'),
  jsonb_build_array(
    jsonb_build_object('season', 1, 'episode', 1, 'watched_on', :'d1', 'pass', 1, 'score', 9, 'note', 'IDA-FIRST-PASS-NOTE'),
    jsonb_build_object('season', 1, 'episode', 1, 'watched_on', :'d2', 'pass', null, 'score', 7, 'note', 'IDA-SECOND-PASS-NOTE'),
    jsonb_build_object('season', 1, 'episode', 2, 'watched_on', :'d1', 'pass', 1, 'score', null, 'note', null)),
  'and the viewings before them: the first pass and the episode watched again');
select test.expect_eq((select e -> 'watched_with' from jsonb_array_elements(test.ex_part('ida_export', 'my_list')) e where e ->> 'title' = 'EXFamily'),
  '{"family": "Export Fam", "people": ["Jo"]}'::jsonb, 'a title watched together says with whom, by name');
select test.expect_eq((select e -> 'my_score' from jsonb_array_elements(test.ex_part('ida_export', 'my_list')) e where e ->> 'title' = 'EXFamily'),
  '9'::jsonb, 'with the score that was filled in for her');
select test.expect_eq((select e -> 'watched_with' from jsonb_array_elements(test.ex_part('ida_export', 'my_list')) e where e ->> 'title' = 'EXMovie'),
  'null'::jsonb, 'and a title she watched on her own does not');

-- The watch history: her own movie on her own, and the family's viewing of a title put back on To watch.
select test.expect_eq(test.ex_part('ida_export', 'watch_history'),
  jsonb_build_array(
    jsonb_build_object('title', 'EXMovie', 'type', 'movie', 'tmdb_id', 7301, 'year', 2020, 'watched_on', :'d1', 'family', null),
    jsonb_build_object('title', 'EXFamilyOnly', 'type', 'movie', 'tmdb_id', 7305, 'year', 2022, 'watched_on', :'d3', 'family', 'Export Fam')),
  'the watch history is hers, with the family a viewing was with');

-- Her part of the family list: what she added, and her own score, note, reaction and watches on any title.
select test.expect_eq(jsonb_array_length(test.ex_part('ida_export', 'family_lists')), 1, 'one family list');
select test.expect_eq(test.ex_part('ida_export', 'family_lists') -> 0 ->> 'family', 'Export Fam'::text, 'the family''s');
select test.expect_eq((test.ex_part('ida_export', 'family_lists') -> 0 ->> 'still_a_member')::boolean, true, 'she is still in it');
select test.expect_eq((select jsonb_build_object('mine', t -> 'added_by_me', 'status', t -> 'status', 'score', t -> 'my_score', 'by', t -> 'score_entered_by',
                              'watched', t -> 'i_watched_on', 'logged', t -> 'watch_logged_by')
  from jsonb_array_elements(test.ex_part('ida_export', 'family_lists') -> 0 -> 'titles') t where t ->> 'title' = 'EXFamily'),
  jsonb_build_object('mine', true, 'status', 'watched', 'score', 9, 'by', 'Jo', 'watched', :'d2', 'logged', 'Jo'),
  'a title Jo logged for her says who filled in her score and who logged it');
select test.expect_eq((select jsonb_build_object('mine', t -> 'added_by_me', 'status', t -> 'status', 'score', t -> 'my_score', 'note', t -> 'my_note',
                              'by', t -> 'score_entered_by', 'watched', t -> 'i_watched_on', 'logged', t -> 'watch_logged_by')
  from jsonb_array_elements(test.ex_part('ida_export', 'family_lists') -> 0 -> 'titles') t where t ->> 'title' = 'EXFamilyOnly'),
  jsonb_build_object('mine', true, 'status', 'want', 'score', 6.5, 'note', 'IDA-FAMILY-NOTE', 'by', 'me', 'watched', null, 'logged', null),
  'a title put back on To watch has no current watch, and her own score and note');
select test.expect_eq((select count(*) from jsonb_array_elements(test.ex_part('ida_export', 'family_lists') -> 0 -> 'titles') t where t ->> 'title' = 'EXJoAdded'),
  0::bigint, 'a title Jo added and she never touched is not hers');

-- Movie nights: hers, with her own votes only. The two titles watched together with no night going on were logged as
-- nights too.
select test.expect_eq(jsonb_array_length(test.ex_part('ida_export', 'movie_nights')), 3, 'the night they swiped and the two logged ones');
select test.expect_eq((select count(*) from jsonb_array_elements(test.ex_part('ida_export', 'movie_nights')) n where n ->> 'source' = 'swipe'), 1::bigint,
  'one of them swiped');
select test.expect_eq((select jsonb_build_object('family', n -> 'family', 'mine', n -> 'started_by_me', 'status', n -> 'status', 'picked', n -> 'picked_title',
                              'watched', n -> 'i_watched_it', 'stacks', n -> 'stacks_i_finished', 'on', n -> 'happened_on')
  from jsonb_array_elements(test.ex_part('ida_export', 'movie_nights')) n where n ->> 'source' = 'swipe'),
  jsonb_build_object('family', 'Export Fam', 'mine', true, 'status', 'closed', 'picked', 'EXCard7311', 'watched', true, 'stacks', 1, 'on', :'d4'),
  'the night, its result and her part in it');
select test.expect_eq((select array_agg((v ->> 'title') || ':' || (v ->> 'vote') order by v ->> 'title')
  from jsonb_array_elements(test.ex_part('ida_export', 'movie_nights')) n, jsonb_array_elements(n -> 'my_votes') v where n ->> 'source' = 'swipe'),
  array['EXCard7311:love', 'EXCard7312:yes', 'EXCard7313:nope'], 'and the votes she cast, not Jo''s or the guest''s');
select test.expect_eq((select count(*) from jsonb_array_elements(test.ex_part('ida_export', 'movie_nights')) n where n ->> 'source' = 'logged' and n ->> 'picked_title' in ('EXFamily', 'EXFamilyOnly')),
  2::bigint, 'the logged ones are the two titles');

-- The feed events she caused.
select test.expect_eq(jsonb_array_length(test.ex_part('ida_export', 'feed_events')), (select count(*)::integer from public.activity where actor_id = :ida),
  'every feed event she caused');
select test.expect_eq((select count(*) > 0 from jsonb_array_elements(test.ex_part('ida_export', 'feed_events')) e where e ->> 'kind' = 'added' and e ->> 'family' = 'Export Fam'), true, 'with their kind and family');

-- Nothing that is someone else's: Jo's and Kai's notes, e-mail addresses and ids, Kai's title, the guest, the invite code
-- and the night's link.
select test.expect_eq(test.ex_has('ida_export', 'JO-SECRET-NOTE'), false, 'Jo''s note is not in it');
select test.expect_eq(test.ex_has('ida_export', 'JO-ADDED-NOTE'), false, 'nor his other one');
select test.expect_eq(test.ex_has('ida_export', 'jo28@x.test'), false, 'nor his e-mail address');
select test.expect_eq(test.ex_has('ida_export', '7b7b7b7b-0000-0000-0000-000000000002'), false, 'nor his id');
select test.expect_eq(test.ex_has('ida_export', 'KAI-SECRET-NOTE') or test.ex_has('ida_export', 'EXKaiOnly') or test.ex_has('ida_export', 'Kai Fam')
  or test.ex_has('ida_export', '7c7c7c7c-0000-0000-0000-000000000003') or test.ex_has('ida_export', 'kai28@x.test'), false, 'nothing of Kai''s, in another family');
select test.expect_eq(test.ex_has('ida_export', 'ZedGuest'), false, 'the night''s guest is not in it');
select test.expect_eq(test.ex_has('ida_export', test.t('ex_invite')) or test.ex_has('ida_export', :'tok'), false, 'nor the family''s invite code or the night''s link');

-- ---- Jo's export, while he is in the family ---------------------------------------------------------------------------------
:as_jo
select public.export_my_data()::text as jo_text \gset
reset role;
insert into test.vals values ('jo_export', :'jo_text');
select test.expect_eq(test.ex_has('jo_export', 'JO-SECRET-NOTE') and test.ex_has('jo_export', 'JO-ADDED-NOTE'), true, 'Jo gets his own notes');
select test.expect_eq(test.ex_has('jo_export', 'IDA-MOVIE-NOTE') or test.ex_has('jo_export', 'IDA-FAMILY-NOTE') or test.ex_has('jo_export', 'IDA-FIRST-PASS-NOTE')
  or test.ex_has('jo_export', 'ida28@x.test') or test.ex_has('jo_export', '7a7a7a7a-0000-0000-0000-000000000001'), false, 'and none of Ida''s notes, e-mail address or id');
select test.expect_eq(test.ex_has('jo_export', 'KAI-SECRET-NOTE') or test.ex_has('jo_export', 'EXKaiOnly') or test.ex_has('jo_export', 'ZedGuest'), false, 'nor Kai''s or the guest''s');
select test.expect_eq((select array_agg((v ->> 'title') || ':' || (v ->> 'vote') order by v ->> 'title')
  from jsonb_array_elements(test.ex_part('jo_export', 'movie_nights')) n, jsonb_array_elements(n -> 'my_votes') v where n ->> 'source' = 'swipe'),
  array['EXCard7311:nope', 'EXCard7314:love'], 'Jo''s votes are his own');
select test.expect_eq((select (n -> 'started_by_me')::boolean from jsonb_array_elements(test.ex_part('jo_export', 'movie_nights')) n where n ->> 'source' = 'swipe'),
  false, 'and the night is not one he started');
select test.expect_eq((select t ->> 'score_entered_by' from jsonb_array_elements(test.ex_part('jo_export', 'family_lists') -> 0 -> 'titles') t where t ->> 'title' = 'EXFamilyOnly'),
  'Ida'::text, 'while he is in the family, he sees who filled in his score');
select test.expect_eq((select e -> 'watched_with' from jsonb_array_elements(test.ex_part('jo_export', 'my_list')) e where e ->> 'title' = 'EXFamily'),
  '{"family": "Export Fam", "people": ["Ida"]}'::jsonb, 'and with whom he watched');

-- ---- Once he has left, he keeps what he did, without the other people's names ---------------------------------------------------
:as_jo
select public.leave_group(test.v('ex_fam'));
select public.export_my_data()::text as jo_text2 \gset
reset role;
insert into test.vals values ('jo_export2', :'jo_text2');
select test.expect_eq(jsonb_array_length(test.ex_part('jo_export2', 'families')), 0, 'a family he left is not one of his families');
select test.expect_eq((test.ex_part('jo_export2', 'family_lists') -> 0 ->> 'still_a_member')::boolean, false, 'but its list still shows what he did there');
select test.expect_eq((select t ->> 'score_entered_by' from jsonb_array_elements(test.ex_part('jo_export2', 'family_lists') -> 0 -> 'titles') t where t ->> 'title' = 'EXFamilyOnly'),
  'someone'::text, 'without the name of the person who filled in his score');
select test.expect_eq((select t ->> 'watch_logged_by' from jsonb_array_elements(test.ex_part('jo_export2', 'family_lists') -> 0 -> 'titles') t where t ->> 'title' = 'EXFamily'),
  'me'::text, 'and what he logged himself is his');
select test.expect_eq((select e -> 'watched_with' from jsonb_array_elements(test.ex_part('jo_export2', 'my_list')) e where e ->> 'title' = 'EXFamily'),
  'null'::jsonb, 'who he watched with is not told once he is out');
select test.expect_eq((select count(*) from jsonb_array_elements(test.ex_part('jo_export2', 'watch_history')) h where h ->> 'family' is not null), 0::bigint,
  'nor which family a viewing was with');
select test.expect_eq(test.ex_has('jo_export2', 'Ida'), false, 'Ida''s name is nowhere in it');
select test.expect_eq((select count(*) from jsonb_array_elements(test.ex_part('jo_export2', 'feed_events')) e where e ->> 'detail' is not null or e ->> 'about' is not null),
  0::bigint, 'not even in the feed events he caused');

-- ---- Kai's, and one with nothing in it ----------------------------------------------------------------------------------------
:as_kai
select public.export_my_data()::text as kai_text \gset
:as_lee
select public.export_my_data()::text as lee_text \gset
reset role;
insert into test.vals values ('kai_export', :'kai_text'), ('lee_export', :'lee_text');
select test.expect_eq(test.ex_has('kai_export', 'KAI-SECRET-NOTE') and test.ex_has('kai_export', 'EXKaiOnly') and test.ex_has('kai_export', 'Kai Fam'), true, 'Kai gets his');
select test.expect_eq(test.ex_has('kai_export', 'IDA-MOVIE-NOTE') or test.ex_has('kai_export', 'JO-SECRET-NOTE') or test.ex_has('kai_export', 'EXMovie')
  or test.ex_has('kai_export', 'Export Fam') or test.ex_has('kai_export', 'ZedGuest'), false, 'and nothing of anyone else''s');
select test.expect_eq((select array_agg(k order by k collate "C") from jsonb_object_keys(test.t('lee_export')::jsonb) k),
  array['account', 'exported_at', 'families', 'family_lists', 'feed_events', 'movie_nights', 'my_list', 'not_included', 'watch_history'],
  'someone with nothing still gets the whole document');
select test.expect_eq((select count(*) from jsonb_each(test.t('lee_export')::jsonb) e
  where e.key not in ('account', 'exported_at', 'not_included') and e.value <> '[]'::jsonb), 0::bigint, 'with every list empty');

-- ---- The limit: five a hour -------------------------------------------------------------------------------------------------------
reset role;
delete from public.rate_limits where user_id = :lee and action = 'export';
:as_lee
select count(public.export_my_data()) as five from generate_series(1, 5) \gset
select test.expect_error($$select public.export_my_data()$$, 'too often');
reset role;
delete from public.rate_limits where user_id = :lee and action = 'export';

-- ---- The inventory: every table is read by the export, or is on this list of what it leaves out, and why -----------------
-- A new table fails here until someone decides which it is.
select test.expect_eq((select array_agg(relname::text order by relname::text collate "C") from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'),
  (select array_agg(x order by x collate "C") from unnest(array[
    -- read by the export
    'profiles', 'groups', 'group_members', 'media', 'list_items', 'ratings', 'reactions', 'watches', 'watch_history',
    'episode_logs', 'episode_history', 'activity', 'movie_nights', 'movie_night_stacks', 'movie_night_candidates',
    'movie_night_votes', 'movie_night_finishes', 'movie_night_members',
    -- left out: a family's secret link, and guests, who are not the person asking, and the temporary rate-limit counters
    'movie_night_links', 'movie_night_guests', 'movie_night_guest_votes', 'movie_night_guest_finishes', 'rate_limits']) x),
  'every table is either exported or listed as left out');
select test.expect_eq((select array_agg(t order by t collate "C") from unnest(array[
    'profiles', 'groups', 'group_members', 'media', 'list_items', 'ratings', 'reactions', 'watches', 'watch_history',
    'episode_logs', 'episode_history', 'activity', 'movie_nights', 'movie_night_stacks', 'movie_night_candidates',
    'movie_night_votes', 'movie_night_finishes', 'movie_night_members']) t
  where (select prosrc from pg_proc where proname = 'export_my_data' and pronamespace = 'public'::regnamespace) !~ ('public\.' || t || '\M')),
  null::text[], 'each table listed as exported is read by the export');
select test.expect_eq((select array_agg(t order by t collate "C") from unnest(array[
    'movie_night_links', 'movie_night_guests', 'movie_night_guest_votes', 'movie_night_guest_finishes', 'rate_limits']) t
  where (select prosrc from pg_proc where proname = 'export_my_data' and pronamespace = 'public'::regnamespace) ~ ('public\.' || t || '\M')),
  null::text[], 'and none of those left out is');

do $$ begin raise notice 'ALL EXPORT TESTS PASSED'; end $$;
