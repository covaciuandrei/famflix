\set ON_ERROR_STOP 1
-- Movie nights: starting, voting, finishing, who sees the results when, more stacks, showing the results, cancelling
-- and expiring. Titles are called F<tmdb id>; their TMDB scores rise with the id.
\set as_ana  'reset role; select set_config(''request.jwt.claim.sub'', ''d1d1d1d1-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_ben  'reset role; select set_config(''request.jwt.claim.sub'', ''d2d2d2d2-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cara 'reset role; select set_config(''request.jwt.claim.sub'', ''d3d3d3d3-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_dan  'reset role; select set_config(''request.jwt.claim.sub'', ''d4d4d4d4-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set ana  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set ben  '''d2d2d2d2-0000-0000-0000-000000000002'''
\set cara '''d3d3d3d3-0000-0000-0000-000000000003'''
\set dan  '''d4d4d4d4-0000-0000-0000-000000000004'''

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1d1d1d1-0000-0000-0000-000000000001', 'ana3@x.test',  '{"full_name":"Ana"}'),
  ('d2d2d2d2-0000-0000-0000-000000000002', 'ben3@x.test',  '{"full_name":"Ben"}'),
  ('d3d3d3d3-0000-0000-0000-000000000003', 'cara3@x.test', '{"full_name":"Cara"}'),
  ('d4d4d4d4-0000-0000-0000-000000000004', 'dan3@x.test',  '{"full_name":"Dan"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

-- Helpers for the tests below (security definer, so they read whatever they need whoever calls them).
create function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create function test.cands(p_from integer, p_to integer) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id)
  from public.media where tmdb_id between p_from and p_to $$;
create function test.cand(p_tmdb integer) returns uuid language sql stable security definer as $$
  select c.id from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = test.v('fl_night') and m.tmdb_id = p_tmdb $$;
create function test.vote(p_tmdb integer, p_vote text) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('candidate_id', test.cand(p_tmdb), 'vote', p_vote) $$;
-- The titles of a state's results in rank order.
create function test.order(p_state jsonb) returns text language sql stable security definer as $$
  select coalesce(string_agg(m.title, ',' order by (r.elem ->> 'rank')::integer), '')
  from jsonb_array_elements(p_state -> 'results') as r(elem)
  join public.movie_night_candidates c on c.id = (r.elem ->> 'candidate_id')::uuid
  join public.media m on m.id = c.media_id $$;
create function test.state(p_full boolean default false) returns jsonb language sql volatile as $$
  select public.movie_night_state(test.v('fl_night'), p_full) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into public.media (tmdb_id, media_type, title, tmdb_rating)
  select g, 'movie', 'F' || g, (g - 9700) / 2.0 from generate_series(9710, 9729) g
  union all
  select g, 'movie', 'F' || g, 7 from generate_series(9730, 9769) g;

-- Ana's family has Ben and Cara; Dan has a family of his own.
:as_ana
select public.create_group('Flow Fam');
reset role;
insert into test.vals select 'fl_fam', id::text from public.groups where name = 'Flow Fam';
insert into test.vals select 'fl_code', invite_code from public.groups where name = 'Flow Fam';
:as_ben
select public.join_group((select v from test.vals where k = 'fl_code'));
:as_cara
select public.join_group((select v from test.vals where k = 'fl_code'));
:as_dan
select public.create_group('Dan Fam');
reset role;
insert into test.vals select 'fl_dan_fam', id::text from public.groups where name = 'Dan Fam';
-- F9729 is on both families' lists (a different list item in each).
:as_ana
insert into public.list_items (group_id, added_by, media_id) select test.v('fl_fam'), :ana, id from public.media where tmdb_id = 9729;
:as_dan
insert into public.list_items (group_id, added_by, media_id) select test.v('fl_dan_fam'), :dan, id from public.media where tmdb_id = 9729;
reset role;
insert into test.vals select 'fl_li', li.id::text from public.list_items li where li.group_id = test.v('fl_fam');
insert into test.vals select 'fl_dan_li', li.id::text from public.list_items li where li.group_id = test.v('fl_dan_fam');

-- ---- Starting -------------------------------------------------------------------------------------------------------
:as_dan
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9710, 9719))$$, 'not in this family');
:as_ana
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9710, 9716))$$, '8 to 40');
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9710, 9719) || test.cands(9710, 9710))$$, 'in a stack once');
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{}',
  test.cands(9710, 9716) || jsonb_build_array(jsonb_build_object('media_id', gen_random_uuid(), 'origin', 'suggested')))$$, 'not valid');
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{}',
  test.cands(9710, 9716) || jsonb_build_array(jsonb_build_object('media_id', (select id from public.media where tmdb_id = 9729),
    'list_item_id', test.v('fl_dan_li'), 'origin', 'list')))$$, 'not on the family list');
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), array['a','b','c','d','e','f'], '{}', test.cands(9710, 9719))$$, 'up to 5 genres');
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), array[repeat('x', 41)], '{}', test.cands(9710, 9719))$$, 'up to 5 genres');
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '[]', test.cands(9710, 9719))$$, 'not valid');
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{"count": 99}', test.cands(9710, 9719))$$, '8 to 40');
select test.expect_eq((select count(*) from public.movie_nights), 0::bigint, 'refused starts left nothing behind');

-- Ana starts: ten suggestions and F9729, which is on the family list.
select public.start_movie_night(test.v('fl_fam'), array['comedy','horror'], '{"series": true, "count": 25}',
  test.cands(9710, 9719) || jsonb_build_array(jsonb_build_object('media_id', (select id from public.media where tmdb_id = 9729),
    'list_item_id', test.v('fl_li'), 'origin', 'list'))) as night_id \gset
reset role;
insert into test.vals values ('fl_night', :'night_id');
insert into test.vals select 'fl_stack1', id::text from public.movie_night_stacks where night_id = test.v('fl_night');
select test.expect_eq((select status from public.movie_nights where id = test.v('fl_night')), 'open'::text, 'the night is open');
select test.expect_eq((select source from public.movie_nights where id = test.v('fl_night')), 'swipe'::text, 'it is a swipe night');
select test.expect_eq((select started_by from public.movie_nights where id = test.v('fl_night')), :ana::uuid, 'Ana started it');
select test.expect_eq((select genres from public.movie_nights where id = test.v('fl_night')), array['comedy','horror'], 'with its genres');
select test.expect_eq((select options from public.movie_nights where id = test.v('fl_night')), '{"series": true, "count": 25, "max": null}'::jsonb, 'and its options');
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('fl_night')), 1::bigint, 'one stack');
select test.expect_eq((select count(*) from public.movie_night_candidates where night_id = test.v('fl_night')), 11::bigint, 'with eleven cards');
select test.expect_eq((select origin from public.movie_night_candidates where id = test.cand(9729)), 'list'::text, 'the list title says so');
select test.expect_eq((select list_item_id from public.movie_night_candidates where id = test.cand(9729)), test.v('fl_li'), 'and knows its list entry');
select test.expect_eq((select origin from public.movie_night_candidates where id = test.cand(9710)), 'suggested'::text, 'suggestions say so');
select test.expect_eq((select array_agg(user_id) from public.movie_night_members where night_id = test.v('fl_night')), array[:ana::uuid], 'only Ana has joined');
select test.expect_eq((select detail from public.activity where kind = 'movie_night_started' and group_id = test.v('fl_fam')), 'comedy, horror'::text, 'the feed says it started');
select test.expect_eq((select actor_name from public.activity where kind = 'movie_night_started' and group_id = test.v('fl_fam')), 'Ana'::text, 'and who started it');

:as_ben
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9740, 9749))$$, 'already has a movie night open');
:as_dan
select public.start_movie_night(test.v('fl_dan_fam'), '{}', '{}', test.cands(9740, 9749)) as dan_night \gset
reset role;
insert into test.vals values ('fl_dan_night', :'dan_night');
select test.expect_eq((select count(*) from public.movie_nights where status = 'open' and group_id in (test.v('fl_fam'), test.v('fl_dan_fam'))), 2::bigint, 'another family has its own night');

-- ---- Joining ---------------------------------------------------------------------------------------------------------
:as_dan
select test.expect_error($$select public.join_movie_night(test.v('fl_night'))$$, 'not available');
:as_anon
select test.expect_error($$select public.join_movie_night(test.v('fl_night'))$$, 'permission denied');
:as_ben
select public.join_movie_night(test.v('fl_night'));
select public.join_movie_night(test.v('fl_night'));
reset role;
select test.expect_eq((select count(*) from public.movie_night_members where night_id = test.v('fl_night') and user_id = :ben), 1::bigint, 'Ben joined, once');

-- ---- Voting ----------------------------------------------------------------------------------------------------------
:as_ben
select test.expect_eq(public.cast_movie_night_votes(test.v('fl_stack1'),
  jsonb_build_array(test.vote(9710, 'love'), test.vote(9711, 'yes'), test.vote(9712, 'yes'), test.vote(9715, 'love'))), 2, 'Ben has used two loves');
select test.expect_eq((select count(*) from public.movie_night_votes where user_id = :ben), 4::bigint, 'and has four votes');
-- Loving more than three in a stack is refused, and none of that batch is kept.
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'),
  jsonb_build_array(test.vote(9716, 'nope'), test.vote(9717, 'love'), test.vote(9718, 'love')))$$, 'at most 3');
select test.expect_eq((select count(*) from public.movie_night_votes where user_id = :ben), 4::bigint, 'a refused batch changes nothing');
select test.expect_eq(public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9717, 'love'))), 3, 'a third love is fine');
select test.expect_eq(public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9717, null))), 2, 'taking a vote back frees the love');
select test.expect_eq((select count(*) from public.movie_night_votes where candidate_id = test.cand(9717)), 0::bigint, 'and removes the vote');
-- Changing a vote replaces it.
select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9712, 'nope'), test.vote(9713, 'seen'), test.vote(9716, 'nope')));
select test.expect_eq((select vote from public.movie_night_votes where candidate_id = test.cand(9712) and user_id = :ben), 'nope'::text, 'a changed vote replaces the old one');
select test.expect_eq((select count(*) from public.movie_night_votes where user_id = :ben), 6::bigint, 'with no extra row');
-- Bad input.
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9714, 'maybe')))$$, 'not for this stack');
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(jsonb_build_object('candidate_id', gen_random_uuid(), 'vote', 'yes')))$$, 'not for this stack');
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'),
  (select jsonb_agg(test.vote(9714, 'yes')) from generate_series(1, 61)))$$, 'Too many votes');
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'), '{}')$$, 'Too many votes');
:as_dan
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9714, 'yes')))$$, 'not available');
:as_anon
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'), '[]')$$, 'permission denied');

-- Cara votes (and joins by doing so). Ana votes too.
:as_cara
select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(
  test.vote(9710, 'yes'), test.vote(9711, 'yes'), test.vote(9712, 'yes'), test.vote(9713, 'nope'), test.vote(9714, 'yes'),
  test.vote(9715, 'nope'), test.vote(9717, 'love'), test.vote(9718, 'yes')));
:as_ana
select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9710, 'nope'), test.vote(9711, 'love'), test.vote(9714, 'seen')));
:as_ben
select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9711, 'yes'), test.vote(9714, 'yes'), test.vote(9718, 'yes')));
reset role;
select test.expect_eq((select count(*) from public.movie_night_members where night_id = test.v('fl_night')), 3::bigint, 'voting joins the night');

-- ---- Who sees the results, and when ------------------------------------------------------------------------------------
-- Nobody has finished, so nobody sees any results yet, only their own votes.
:as_ben
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 0, 'before finishing there are no results to see');
select test.expect_eq((test.state() -> 'stacks' -> 0 ->> 'can_see_results')::boolean, false, 'and the stack says so');
select test.expect_eq((select count(*) from jsonb_object_keys(test.state() -> 'my_votes')), 8::bigint, 'Ben only gets his own eight votes');
select test.expect_eq((test.state() -> 'stacks' -> 0 ->> 'my_voted')::integer, 8, 'and how many that is');
select test.expect_eq((test.state() -> 'stacks' -> 0 ->> 'my_loves')::integer, 2, 'of which two loves');
select test.expect_eq((test.state() -> 'stacks' -> 0 ->> 'total')::integer, 11, 'out of eleven cards');
-- Progress shows how far people are, not what they voted.
select test.expect_eq(
  (select (m ->> 'user_id')::uuid from jsonb_array_elements(test.state() -> 'members') m where (m -> 'stacks' -> 0 ->> 'voted')::integer = 8 and m ->> 'name' = 'Cara'),
  :cara::uuid, 'Ben can see Cara voted on eight cards');
select test.expect_eq(position('"vote"' in (test.state() -> 'members')::text), 0, 'without seeing a vote');
select public.finish_movie_night_stack(test.v('fl_stack1'));
select public.finish_movie_night_stack(test.v('fl_stack1'));
reset role;
select test.expect_eq((select count(*) from public.movie_night_finishes where stack_id = test.v('fl_stack1')), 1::bigint, 'Ben finished, once');
:as_ben
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9719, 'yes')))$$, 'already finished');
-- Now Ben sees how it came out, with everybody's votes; Ana and Cara still don't.
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 9, 'Ben sees the nine titles that got votes');
select test.expect_eq((test.state() -> 'stacks' -> 0 ->> 'can_see_results')::boolean, true, 'his stack says he can');
select test.expect_eq(
  (select jsonb_agg(v ->> 'name' order by v ->> 'name') from jsonb_array_elements(test.state() -> 'results' -> 0 -> 'votes') v),
  '["Ana", "Ben", "Cara"]'::jsonb, 'with the names behind each vote');
:as_cara
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 0, 'Cara hasn''t finished, so she sees none');
:as_ana
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 0, 'neither has Ana');
:as_cara
select public.finish_movie_night_stack(test.v('fl_stack1'));
:as_ana
select public.finish_movie_night_stack(test.v('fl_stack1'));

-- ---- Ranking -----------------------------------------------------------------------------------------------------------
-- F9711 4 pts; then 2 pts each: F9717 (no nopes, a love), F9718 and F9714 (no nopes, no loves: the better TMDB score first; F9714's
-- "seen it" is worth nothing), F9710 (a nope); F9715 1; F9712 0; F9716 and F9713 -1 each with a nope, the better TMDB score first
-- (F9713's other vote is a "seen it", worth nothing).
select test.expect_eq(test.order(test.state()), 'F9711,F9717,F9718,F9714,F9710,F9715,F9712,F9716,F9713', 'the ranking and every tie-break');
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'points')::integer, 4, 'the leader has four points');
select test.expect_eq((test.state() -> 'results' -> 3 ->> 'seen')::integer, 1, 'one "seen it" counted on F9714');
select test.expect_eq((test.state() -> 'results' -> 3 ->> 'points')::integer, 2, 'and it adds no points: two yes votes make two');
select test.expect_eq((test.state() -> 'results' -> 7 ->> 'points')::integer, -1, 'a lone nope is minus one');
select test.expect_eq((test.state() -> 'results' -> 8 ->> 'points')::integer, -1, 'and a "seen it" with a nope is still minus one');
select test.expect_eq((test.state() -> 'results' -> 4 ->> 'nopes')::integer, 1, 'F9710 has a nope');
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'rank')::integer, 1, 'ranks start at one');
-- Everything about the family list is there too: F9729 got no votes so isn't listed.
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'on_family_list')::boolean, false, 'the leader isn''t on the family list');
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'on_my_list')::boolean, false, 'nor on Ana''s list');
:as_ana
insert into public.list_items (group_id, added_by, media_id) select null, :ana, id from public.media where tmdb_id = 9711;
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'on_my_list')::boolean, true, 'it shows once it is on her list');
:as_ben
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'on_my_list')::boolean, false, 'but not on Ben''s');
:as_ana
update public.list_items set deleted_at = now() where group_id is null and added_by = :ana;
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'on_my_list')::boolean, false, 'a removed title doesn''t count');
-- The cards come with the full state only.
select test.expect_eq(jsonb_array_length(test.state(true) -> 'candidates'), 11, 'the full state has the cards');
select test.expect_eq(jsonb_array_length(test.state(false) -> 'candidates'), 0, 'the light one doesn''t');
select test.expect_eq(test.state(true) -> 'candidates' -> 0 ->> 'title', 'F9710', 'the first card is the first title');
select test.expect_eq((test.state(true) -> 'night' ->> 'group_name'), 'Flow Fam'::text, 'and the night knows its family');

-- ---- More stacks -------------------------------------------------------------------------------------------------------
:as_dan
select test.expect_error($$select public.add_movie_night_stack(test.v('fl_night'), 1, test.cands(9720, 9728))$$, 'not available');
:as_cara
select test.expect_error($$select public.add_movie_night_stack(test.v('fl_night'), 1, test.cands(9710, 9717))$$, 'already in this movie night');
select test.expect_error($$select public.add_movie_night_stack(test.v('fl_night'), 1, test.cands(9720, 9726))$$, '8 to 40');
select test.expect_error($$select public.add_movie_night_stack(test.v('fl_night'), 1,
  (select jsonb_agg(jsonb_build_object('media_id', id, 'list_item_id', test.v('fl_li'), 'origin', 'list')) from public.media where tmdb_id between 9720 and 9728))$$, 'not valid');
select public.add_movie_night_stack(test.v('fl_night'), 1, test.cands(9720, 9728)) as stack2 \gset
reset role;
insert into test.vals values ('fl_stack2', :'stack2');
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('fl_night')), 2::bigint, 'there are two stacks now');
select test.expect_eq((select position from public.movie_night_stacks where id = test.v('fl_stack2')), 2::smallint, 'the new one is second');
select test.expect_eq((select created_by from public.movie_night_stacks where id = test.v('fl_stack2')), :cara::uuid, 'asked for by Cara');
select test.expect_eq((select count(*) from public.movie_night_candidates where stack_id = test.v('fl_stack2')), 9::bigint, 'with nine cards');
select test.expect_eq((select string_agg(distinct origin, ',') from public.movie_night_candidates where stack_id = test.v('fl_stack2')), 'suggested'::text, 'all suggestions');
-- Asking at the same time gets the stack someone just added, not a second one.
:as_ben
select test.expect_eq(public.add_movie_night_stack(test.v('fl_night'), 1, test.cands(9730, 9738)), test.v('fl_stack2'), 'a stale request gets the new stack back');
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('fl_night')), 2::bigint, 'and no third one appears');
-- The new stack's results stay hidden from people who haven't swiped it, even though they finished the first.
select test.expect_eq((test.state() -> 'stacks' -> 1 ->> 'can_see_results')::boolean, false, 'Ben can''t see stack two''s results yet');
select test.expect_eq((test.state() -> 'stacks' -> 1 ->> 'my_finished')::boolean, false, 'he hasn''t finished it');
-- A vote has to be for a card of the stack it is sent to.
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack2'), jsonb_build_array(test.vote(9710, 'yes')))$$, 'not for this stack');
select public.cast_movie_night_votes(test.v('fl_stack2'), jsonb_build_array(test.vote(9720, 'love'), test.vote(9721, 'nope')));
select test.expect_eq((test.state() -> 'stacks' -> 1 ->> 'my_loves')::integer, 1, 'loves are counted per stack');
select test.expect_eq((test.state() -> 'stacks' -> 0 ->> 'my_loves')::integer, 2, 'so the first stack keeps its own count');
-- Someone else's votes on stack two stay hidden from Ben until he finishes it.
:as_cara
select public.cast_movie_night_votes(test.v('fl_stack2'), jsonb_build_array(test.vote(9720, 'yes'), test.vote(9722, 'love')));
:as_ben
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 9, 'Ben still sees only the first stack''s titles');
select public.finish_movie_night_stack(test.v('fl_stack2'));
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 12, 'finishing stack two adds its three titles');
select test.expect_eq((test.state() -> 'results' -> 0 ->> 'points')::integer, 4, 'ranked together with the first stack');
-- Five stacks at most.
:as_cara
select public.add_movie_night_stack(test.v('fl_night'), 2, test.cands(9730, 9738));
select public.add_movie_night_stack(test.v('fl_night'), 3, test.cands(9740, 9748));
select public.add_movie_night_stack(test.v('fl_night'), 4, test.cands(9750, 9758));
select test.expect_error($$select public.add_movie_night_stack(test.v('fl_night'), 5, test.cands(9760, 9768))$$, 'already has 5 stacks');
reset role;
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('fl_night')), 5::bigint, 'five stacks in all');

-- ---- The open nights people are told about -------------------------------------------------------------------------------
:as_ben
select test.expect_eq(jsonb_array_length(public.active_movie_nights()), 1, 'Ben has one open night');
select test.expect_eq((public.active_movie_nights() -> 0 ->> 'joined')::boolean, true, 'and has joined it');
select test.expect_eq((public.active_movie_nights() -> 0 ->> 'stacks')::integer, 5, 'it has five stacks');
select test.expect_eq((public.active_movie_nights() -> 0 ->> 'waiting_stacks')::integer, 3, 'three of them are waiting for him');
select test.expect_eq((public.active_movie_nights() -> 0 ->> 'members')::integer, 3, 'the family has three people');
select test.expect_eq((public.active_movie_nights() -> 0 ->> 'done_members')::integer, 0, 'nobody has finished every stack');
select test.expect_eq(public.active_movie_nights() -> 0 ->> 'started_by_name', 'Ana', 'Ana started it');
:as_dan
select test.expect_eq(public.active_movie_nights() -> 0 ->> 'group_name', 'Dan Fam', 'Dan only hears about his own family''s night');
select test.expect_eq(jsonb_array_length(public.active_movie_nights()), 1, 'just the one');
:as_anon
select test.expect_error($$select public.active_movie_nights()$$, 'permission denied');
select test.expect_error($$select public.movie_night_state(test.v('fl_night'), false)$$, 'permission denied');

-- ---- Showing the results now ---------------------------------------------------------------------------------------------
:as_dan
select test.expect_error($$select public.reveal_movie_night(test.v('fl_night'))$$, 'not available');
:as_ana
select test.expect_eq((test.state() -> 'stacks' -> 1 ->> 'can_see_results')::boolean, false, 'Ana hasn''t swiped stack two');
select public.reveal_movie_night(test.v('fl_night'));
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('fl_night') and revealed_at is not null), 5::bigint, 'every stack is revealed');
select test.expect_eq((test.state() -> 'stacks' -> 1 ->> 'can_see_results')::boolean, true, 'so Ana sees stack two''s results');
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 12, 'with the titles that got votes');
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack2'), jsonb_build_array(test.vote(9723, 'yes')))$$, 'already out');
select public.finish_movie_night_stack(test.v('fl_stack2'));
select test.expect_eq((public.active_movie_nights() -> 0 ->> 'waiting_stacks')::integer, 0, 'nothing is waiting once all are revealed');
select test.expect_eq((public.active_movie_nights() -> 0 ->> 'done_members')::integer, 3, 'and everybody counts as done');

-- ---- Cancelling ----------------------------------------------------------------------------------------------------------
:as_dan
select test.expect_error($$select public.cancel_movie_night(test.v('fl_night'))$$, 'not available');
:as_cara
select public.cancel_movie_night(test.v('fl_night'));
reset role;
select test.expect_eq((select status from public.movie_nights where id = test.v('fl_night')), 'cancelled'::text, 'any member can cancel');
select test.expect_eq((select ended_by from public.movie_nights where id = test.v('fl_night')), :cara::uuid, 'it says who');
select test.expect_eq((select ended_at is not null from public.movie_nights where id = test.v('fl_night')), true, 'and when');
select test.expect_eq((select actor_name from public.activity where kind = 'movie_night_cancelled' and group_id = test.v('fl_fam')), 'Cara'::text, 'the feed says so');
:as_ben
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack1'), jsonb_build_array(test.vote(9719, 'yes')))$$, 'was cancelled');
select test.expect_error($$select public.cancel_movie_night(test.v('fl_night'))$$, 'was cancelled');
select test.expect_error($$select public.reveal_movie_night(test.v('fl_night'))$$, 'was cancelled');
select public.finish_movie_night_stack(test.v('fl_stack1'));
select public.join_movie_night(test.v('fl_night'));
select test.expect_eq(test.state() -> 'night' ->> 'status', 'cancelled', 'the state says it was cancelled');
select test.expect_eq(test.state() -> 'night' ->> 'ended_by_name', 'Cara', 'and by whom');
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 12, 'its results stay readable');
select test.expect_eq(jsonb_array_length(public.active_movie_nights()), 0, 'but it is no longer an active night');
-- With the night over, the family can start another, and the old votes are still there.
:as_ana
select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9710, 9719)) as night2 \gset
reset role;
insert into test.vals values ('fl_night2', :'night2');
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('fl_fam')), 2::bigint, 'two nights in the family''s history');
select test.expect_eq((select count(*) from public.movie_night_votes where candidate_id = test.cand(9710)), 3::bigint, 'the cancelled night kept its votes');

-- ---- Twelve quiet hours --------------------------------------------------------------------------------------------------
reset role;
update public.movie_nights set last_activity_at = now() - interval '13 hours' where id = test.v('fl_night2');
:as_ben
select test.expect_eq(public.movie_night_state(test.v('fl_night2')) -> 'night' ->> 'status', 'expired', 'a night nobody touched for 12 hours expires');
select test.expect_eq((public.movie_night_state(test.v('fl_night2')) -> 'night' ->> 'ended_at') is not null, true, 'and records when');
reset role;
insert into test.vals select 'fl_stack3', id::text from public.movie_night_stacks where night_id = test.v('fl_night2');
:as_ben
select test.expect_error($$select public.cast_movie_night_votes(test.v('fl_stack3'), '[]')$$, '12 hours');
select test.expect_eq(jsonb_array_length(public.active_movie_nights()), 0, 'an expired night isn''t active');
-- A night that went quiet doesn't stop the family starting a new one, even if nobody has opened it since.
:as_ana
select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9720, 9728)) as night3 \gset
reset role;
insert into test.vals values ('fl_night3', :'night3');
update public.movie_nights set last_activity_at = now() - interval '13 hours' where id = test.v('fl_night3');
:as_ana
select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9730, 9738)) as night4 \gset
reset role;
insert into test.vals values ('fl_night4', :'night4');
select test.expect_eq((select status from public.movie_nights where id = test.v('fl_night3')), 'expired'::text, 'starting expired the quiet one');
select test.expect_eq((select status from public.movie_nights where id = test.v('fl_night4')), 'open'::text, 'and the new one is open');
-- Anything people do counts as activity.
update public.movie_nights set last_activity_at = now() - interval '11 hours' where id = test.v('fl_night4');
insert into test.vals select 'fl_stack4', id::text from public.movie_night_stacks where night_id = test.v('fl_night4');
:as_ben
select public.join_movie_night(test.v('fl_night4'));
reset role;
select test.expect_eq((select last_activity_at > now() - interval '1 minute' from public.movie_nights where id = test.v('fl_night4')), true, 'joining counts');
update public.movie_nights set last_activity_at = now() - interval '11 hours' where id = test.v('fl_night4');
insert into test.vals select 'fl_night4_c', c.id::text from public.movie_night_candidates c where c.stack_id = test.v('fl_stack4') order by c.position limit 1;
:as_ben
select public.cast_movie_night_votes(test.v('fl_stack4'), jsonb_build_array(jsonb_build_object('candidate_id', test.v('fl_night4_c'), 'vote', 'yes')));
reset role;
select test.expect_eq((select last_activity_at > now() - interval '1 minute' from public.movie_nights where id = test.v('fl_night4')), true, 'voting counts');
update public.movie_nights set last_activity_at = now() - interval '11 hours' where id = test.v('fl_night4');
:as_ben
select public.finish_movie_night_stack(test.v('fl_stack4'));
reset role;
select test.expect_eq((select last_activity_at > now() - interval '1 minute' from public.movie_nights where id = test.v('fl_night4')), true, 'finishing counts');

-- ---- Leaving the family --------------------------------------------------------------------------------------------------
-- Ben's votes in the night that is still going leave with him; the cancelled night keeps them.
reset role;
select test.expect_eq((select count(*) from public.movie_night_votes v join public.movie_night_candidates c on c.id = v.candidate_id
  where c.night_id = test.v('fl_night4') and v.user_id = :ben), 1::bigint, 'Ben has a vote in the open night');
select test.expect_eq((select count(*) from public.movie_night_votes v join public.movie_night_candidates c on c.id = v.candidate_id
  where c.night_id = test.v('fl_night') and v.user_id = :ben), 10::bigint, 'and ten in the cancelled one');
:as_ben
select public.leave_group(test.v('fl_fam'));
reset role;
select test.expect_eq((select count(*) from public.movie_night_votes v join public.movie_night_candidates c on c.id = v.candidate_id
  where c.night_id = test.v('fl_night4') and v.user_id = :ben), 0::bigint, 'leaving removes his votes from the open night');
select test.expect_eq((select count(*) from public.movie_night_finishes where stack_id = test.v('fl_stack4') and user_id = :ben), 0::bigint, 'and his finished stack');
select test.expect_eq((select count(*) from public.movie_night_members where night_id = test.v('fl_night4') and user_id = :ben), 0::bigint, 'and his place in it');
select test.expect_eq((select count(*) from public.movie_night_votes v join public.movie_night_candidates c on c.id = v.candidate_id
  where c.night_id = test.v('fl_night') and v.user_id = :ben), 10::bigint, 'the cancelled night keeps his votes');
:as_ana
select test.expect_eq((select count(*) from jsonb_array_elements(test.state() -> 'members') m where m ->> 'name' = 'Ben' and (m ->> 'joined')::boolean), 1::bigint, 'and still lists him as having taken part');
select test.expect_eq(jsonb_array_length(test.state() -> 'results'), 12, 'with its results');

-- ---- Visitors and helpers ---------------------------------------------------------------------------------------------------
:as_anon
select test.expect_error($$select public.start_movie_night(test.v('fl_fam'), '{}', '{}', test.cands(9710, 9719))$$, 'permission denied');
select test.expect_error($$select public.finish_movie_night_stack(test.v('fl_stack1'))$$, 'permission denied');
select test.expect_error($$select public.add_movie_night_stack(test.v('fl_night'), 1, test.cands(9710, 9719))$$, 'permission denied');
select test.expect_error($$select public.reveal_movie_night(test.v('fl_night'))$$, 'permission denied');
select test.expect_error($$select public.cancel_movie_night(test.v('fl_night'))$$, 'permission denied');
-- The helpers behind them can't be called through the API by anyone.
:as_ana
select test.expect_error($$select public.settle_movie_night(test.v('fl_night'))$$, 'permission denied');
select test.expect_error($$select public.movie_night_for_member(test.v('fl_night'))$$, 'permission denied');
select test.expect_error($$select public.movie_night_check_candidates(test.v('fl_dan_fam'), test.cands(9710, 9719), true)$$, 'permission denied');
select test.expect_error($$select public.movie_night_member_left()$$, 'permission denied');

-- ---- Starting too often ---------------------------------------------------------------------------------------------------
-- Dan has started one night (it is still open); six an hour is the limit.
:as_dan
select public.cancel_movie_night(test.v('fl_dan_night'));
select format('select public.cancel_movie_night(public.start_movie_night(%L, ''{}'', ''{}'', test.cands(9740, 9749)))', test.v('fl_dan_fam'))
  from generate_series(1, 5) \gexec
select test.expect_error($$select public.start_movie_night(test.v('fl_dan_fam'), '{}', '{}', test.cands(9740, 9749))$$, 'too often');
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('fl_dan_fam')), 6::bigint, 'six nights, no seventh');

reset role;
do $$ begin raise notice 'ALL MOVIE NIGHT FLOW TESTS PASSED'; end $$;
