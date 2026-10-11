\set ON_ERROR_STOP 1
-- Movie night guests: people without an account who vote in one night through a link. Members make, replace and turn off
-- the link and take guests out; the server speaks for the guests (service role only), and every guest function checks
-- the guest's secret and that the night is open. Guests are told nothing about the family's lists, vote like members
-- (their votes count in the results and in the best titles that join the family list), and are gone with their night.
-- Titles are called GU<tmdb id>.
\set as_mia     'reset role; select set_config(''request.jwt.claim.sub'', ''4a4a4a4a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_noa     'reset role; select set_config(''request.jwt.claim.sub'', ''4b4b4b4b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_olu     'reset role; select set_config(''request.jwt.claim.sub'', ''4c4c4c4c-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_anon    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_service 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role service_role;'
\set mia '''4a4a4a4a-0000-0000-0000-000000000001'''
\set fam '(select v::uuid from test.vals where k = ''gu_fam'')'

insert into auth.users (id, email, raw_user_meta_data) values
  ('4a4a4a4a-0000-0000-0000-000000000001', 'mia25@x.test', '{"full_name":"Mia"}'),
  ('4b4b4b4b-0000-0000-0000-000000000002', 'noa25@x.test', '{"full_name":"Noa"}'),
  ('4c4c4c4c-0000-0000-0000-000000000003', 'olu25@x.test', '{"full_name":"Olu"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create function test.t(p_key text) returns text language sql stable security definer as $$
  select v from test.vals where k = p_key $$;
create or replace function test.cands(p_from integer, p_to integer) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id)
  from public.media where tmdb_id between p_from and p_to $$;
-- A vote on a card of night A (by its title), as the guest functions take it.
create function test.gcv(p_tmdb integer, p_vote text) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('candidate_id', c.id, 'vote', p_vote)
  from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = test.v('gu_a') and m.tmdb_id = p_tmdb $$;
create function test.gcand(p_tmdb integer) returns uuid language sql stable security definer as $$
  select c.id from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = test.v('gu_a') and m.tmdb_id = p_tmdb $$;
-- The family's list as "tmdb ids", sorted (without removed titles).
create function test.gu_list() returns integer[] language sql stable security definer as $$
  select coalesce(array_agg(m.tmdb_id order by m.tmdb_id), '{}')
  from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('gu_fam') and li.deleted_at is null $$;
-- Some guest of night A (they are all still there until the night is deleted at the end).
create function test.gu_any_guest() returns uuid language sql stable security definer as $$
  select id from public.movie_night_guests where night_id = test.v('gu_a') order by name limit 1 $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into public.media (tmdb_id, media_type, title, tmdb_rating)
  select g, 'movie', 'GU' || g, (g - 8900) / 5.0 from generate_series(8951, 8975) g;

-- Mia and Noa are a family; Olu has his own. Mia starts a night with twelve titles.
:as_mia
select public.create_group('Guest Fam');
reset role;
insert into test.vals select 'gu_fam', id::text from public.groups where name = 'Guest Fam';
insert into test.vals select 'gu_code', invite_code from public.groups where name = 'Guest Fam';
:as_noa
select public.join_group(test.t('gu_code'));
:as_olu
select public.create_group('Other Guest Fam');
:as_mia
select public.start_movie_night(:fam, array['comedy'], '{}', test.cands(8951, 8962)) as night_a \gset
reset role;
insert into test.vals values ('gu_a', :'night_a');
insert into test.vals select 'gu_stack', id::text from public.movie_night_stacks where night_id = test.v('gu_a');

-- ---- The link: members only ----------------------------------------------------------------------------------------
:as_anon
select test.expect_error($$select public.get_movie_night_guest_link(test.v('gu_a'))$$, 'permission denied');
:as_olu
select test.expect_error($$select public.get_movie_night_guest_link(test.v('gu_a'))$$, 'not available');
select test.expect_error($$select public.replace_movie_night_guest_link(test.v('gu_a'))$$, 'not available');
select test.expect_error($$select public.turn_off_movie_night_guest_link(test.v('gu_a'))$$, 'not available');
:as_mia
select public.get_movie_night_guest_link(test.v('gu_a')) as tok \gset
reset role;
insert into test.vals values ('gu_tok', :'tok');
select test.expect_eq(test.t('gu_tok') ~ '^[0-9a-f]{64}$', true, 'the link is a long random token');
:as_noa
select test.expect_eq(public.get_movie_night_guest_link(test.v('gu_a')), test.t('gu_tok'), 'any member gets the same link');
select test.expect_error($$select public.get_movie_night_guest_link(gen_random_uuid())$$, 'not available');

-- ---- Nobody but the server runs the guest functions ------------------------------------------------------------------
select test.expect_error($$select public.guest_join(test.t('gu_tok'), 'Zoe')$$, 'permission denied');
select test.expect_error($$select public.guest_link_info(test.t('gu_tok'))$$, 'permission denied');
select test.expect_error($$select public.guest_cast_votes(repeat('0', 64), test.v('gu_stack'), '[]')$$, 'permission denied');
select test.expect_error($$select public.guest_finish_stack(repeat('0', 64), test.v('gu_stack'))$$, 'permission denied');
select test.expect_error($$select public.guest_movie_night_state(repeat('0', 64))$$, 'permission denied');
select test.expect_error($$select public.guest_leave(repeat('0', 64))$$, 'permission denied');
select test.expect_error($$select public.guest_link_night(test.t('gu_tok'))$$, 'permission denied');
select test.expect_error($$select public.guest_session(repeat('0', 64))$$, 'permission denied');
select test.expect_error($$select public.movie_night_state_for(test.v('gu_a'), true, gen_random_uuid(), true)$$, 'permission denied');
select test.expect_error($$select * from public.movie_night_all_votes(test.v('gu_a'))$$, 'permission denied');
select test.expect_error($$select * from public.movie_night_all_finishes(test.v('gu_a'))$$, 'permission denied');
:as_anon
select test.expect_error($$select public.guest_join(test.t('gu_tok'), 'Zoe')$$, 'permission denied');
select test.expect_error($$select public.guest_movie_night_state(repeat('0', 64))$$, 'permission denied');
-- Nobody reads the guests' tables through the API, not even the link.
:as_noa
select test.expect_error($$select token from public.movie_night_links$$, 'permission denied');
select test.expect_error($$select secret_hash from public.movie_night_guests$$, 'permission denied');
select test.expect_error($$select * from public.movie_night_guest_votes$$, 'permission denied');
select test.expect_error($$select * from public.movie_night_guest_finishes$$, 'permission denied');
select test.expect_error($$insert into public.movie_night_guests (night_id, name, secret_hash) values (test.v('gu_a'), 'Sneaky', '\x00')$$, 'permission denied');

-- ---- What a link says before anyone has joined -----------------------------------------------------------------------
:as_service
select test.expect_eq(public.guest_link_info(test.t('gu_tok')) ->> 'open', 'true'::text, 'the link of an open night says so');
select test.expect_eq(public.guest_link_info(test.t('gu_tok')) ->> 'family_name', 'Guest Fam'::text, 'and whose night it is');
select test.expect_eq(public.guest_link_info(test.t('gu_tok')) ->> 'night_id', test.v('gu_a')::text, 'and which one (for the server, which only tells a member of that family)');
select test.expect_eq(public.guest_link_info('not a link') ? 'night_id', false, 'but a link that does not work gives no night');
select test.expect_eq(public.guest_link_info(test.t('gu_tok')) ->> 'full', 'false'::text, 'and that it has room');
select test.expect_eq(public.guest_link_info('not a link') ->> 'open', 'false'::text, 'something that is not a link says nothing is open');
select test.expect_eq(public.guest_link_info(repeat('0', 64)) ->> 'open', 'false'::text, 'and so does a link nobody has');
select test.expect_eq(public.guest_link_info(null) ->> 'open', 'false'::text, 'and no link at all');

-- ---- Joining ---------------------------------------------------------------------------------------------------------
select test.expect_error($$select public.guest_join('not a link', 'Zoe')$$, 'is over');
select test.expect_error($$select public.guest_join(repeat('0', 64), 'Zoe')$$, 'is over');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), '')$$, '1 to 30');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), '   ')$$, '1 to 30');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), null)$$, '1 to 30');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), repeat('x', 31))$$, '1 to 30');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), 'Zo' || chr(7) || 'e')$$, 'plain name');
select test.expect_eq((select count(*) from public.movie_night_guests), 0::bigint, 'none of those got anyone in');
select r ->> 'secret' as sec1, r ->> 'guest_id' as gid1 from (select public.guest_join(test.t('gu_tok'), '  Zoe   Park ') as r) x \gset
reset role;
insert into test.vals values ('gu_sec1', :'sec1'), ('gu_g1', :'gid1');
select test.expect_eq(test.t('gu_sec1') ~ '^[0-9a-f]{64}$', true, 'a guest gets a long random secret');
select test.expect_eq((select name from public.movie_night_guests where id = test.v('gu_g1')), 'Zoe Park'::text, 'the name is tidied (spaces)');
select test.expect_eq((select count(*) from public.movie_night_guests where encode(secret_hash, 'hex') = test.t('gu_sec1')), 0::bigint, 'the secret itself is not kept');
select test.expect_eq((select count(*) from public.movie_night_guests where secret_hash = sha256(convert_to(test.t('gu_sec1'), 'UTF8'))), 1::bigint, 'only its hash is');
:as_service
select test.expect_error($$select public.guest_join(test.t('gu_tok'), 'zoe park')$$, 'name is taken');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), 'ZOE  PARK')$$, 'name is taken');
select r ->> 'secret' as sec2, r ->> 'guest_id' as gid2 from (select public.guest_join(test.t('gu_tok'), 'Yan') as r) x \gset
reset role;
insert into test.vals values ('gu_sec2', :'sec2'), ('gu_g2', :'gid2');
-- Ten guests at most.
:as_service
select count(public.guest_join(test.t('gu_tok'), 'Guest ' || g)) from generate_series(3, 10) g;
select test.expect_eq(public.guest_link_info(test.t('gu_tok')) ->> 'full', 'true'::text, 'a night with ten guests says it is full');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), 'One more')$$, 'all the guests');
reset role;
select test.expect_eq((select count(*) from public.movie_night_guests where night_id = test.v('gu_a')), 10::bigint, 'there are ten');

-- ---- Voting ----------------------------------------------------------------------------------------------------------
:as_service
select test.expect_eq(public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), jsonb_build_array(
  test.gcv(8951, 'love'), test.gcv(8952, 'yes'), test.gcv(8953, 'nope'), test.gcv(8954, 'seen'))), 1, 'a guest votes, and is told how many loves they have used');
reset role;
select test.expect_eq((select count(*) from public.movie_night_guest_votes where guest_id = test.v('gu_g1')), 4::bigint, 'the four votes are saved');
select test.expect_eq((select count(*) from public.movie_night_votes v join public.movie_night_candidates c on c.id = v.candidate_id where c.night_id = test.v('gu_a')), 0::bigint, 'and none of them is a member''s');
:as_service
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), jsonb_build_array(
  test.gcv(8955, 'love'), test.gcv(8956, 'love'), test.gcv(8957, 'love')))$$, 'at most 3');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), jsonb_build_array(test.gcv(8958, 'maybe')))$$, 'not for this stack');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), jsonb_build_array(
  jsonb_build_object('candidate_id', gen_random_uuid(), 'vote', 'yes')))$$, 'not for this stack');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), '{}')$$, 'Too many votes');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'),
  (select jsonb_agg(test.gcv(8951, 'yes')) from generate_series(1, 61)))$$, 'Too many votes');
reset role;
select test.expect_eq((select count(*) from public.movie_night_guest_votes where guest_id = test.v('gu_g1')), 4::bigint, 'the refused batches saved nothing');
:as_service
-- A vote can be taken back and changed.
select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), jsonb_build_array(test.gcv(8953, null), test.gcv(8954, 'yes')));
reset role;
select test.expect_eq((select string_agg(m.title || ':' || v.vote, ',' order by m.title)
  from public.movie_night_guest_votes v join public.movie_night_candidates c on c.id = v.candidate_id join public.media m on m.id = c.media_id
  where v.guest_id = test.v('gu_g1')), 'GU8951:love,GU8952:yes,GU8954:yes'::text, 'a vote taken back is gone and one changed has its new word');
-- Refused: a secret nobody has, a stack of another night.
:as_service
select test.expect_error($$select public.guest_cast_votes(repeat('0', 64), test.v('gu_stack'), '[]')$$, 'not available');
select test.expect_error($$select public.guest_cast_votes('not a secret', test.v('gu_stack'), '[]')$$, 'not available');
select test.expect_error($$select public.guest_cast_votes(null, test.v('gu_stack'), '[]')$$, 'not available');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_tok'), test.v('gu_stack'), '[]')$$, 'not available');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), gen_random_uuid(), '[]')$$, 'not available');

-- Guest 2 votes a little, then guest 1 finishes the stack and can't vote on it any more.
select public.guest_cast_votes(test.t('gu_sec2'), test.v('gu_stack'), jsonb_build_array(test.gcv(8951, 'nope'), test.gcv(8952, 'love')));
select public.guest_finish_stack(test.t('gu_sec1'), test.v('gu_stack'));
select public.guest_finish_stack(test.t('gu_sec1'), test.v('gu_stack'));
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), jsonb_build_array(test.gcv(8960, 'yes')))$$, 'already finished');
select test.expect_error($$select public.guest_finish_stack(test.t('gu_sec1'), gen_random_uuid())$$, 'not available');
select test.expect_error($$select public.guest_finish_stack(repeat('0', 64), test.v('gu_stack'))$$, 'not available');

-- ---- What a guest sees -----------------------------------------------------------------------------------------------
select test.expect_eq(public.guest_movie_night_state(test.t('gu_sec1'), true) ->> 'viewer', 'guest'::text, 'a guest is told they are one');
select test.expect_eq(public.guest_movie_night_state(test.t('gu_sec1')) ->> 'me', test.v('gu_g1')::text, 'and who they are');
select test.expect_eq(jsonb_array_length(public.guest_movie_night_state(test.t('gu_sec1'), true) -> 'candidates'), 12, 'they get the night''s cards');
select test.expect_eq(jsonb_array_length(public.guest_movie_night_state(test.t('gu_sec1')) -> 'members'), 12, 'and see who is in: the family and the ten guests');
select test.expect_eq((select count(*) from jsonb_array_elements(public.guest_movie_night_state(test.t('gu_sec1')) -> 'members') m where (m ->> 'guest')::boolean), 10::bigint, 'ten of them tagged as guests');
select test.expect_eq((select count(*) from jsonb_object_keys(public.guest_movie_night_state(test.t('gu_sec1')) -> 'my_votes')), 3::bigint, 'their own votes are only theirs');
-- Guest 1 has finished: the results are there, with nothing about the family's lists.
select test.expect_eq(jsonb_array_length(public.guest_movie_night_state(test.t('gu_sec1')) -> 'results'), 3, 'a guest who finished sees the results');
select test.expect_eq((select count(*) from jsonb_array_elements(public.guest_movie_night_state(test.t('gu_sec1')) -> 'results') r where r -> 'family_item_id' <> 'null'::jsonb), 0::bigint, 'with no list item of the family''s');
select test.expect_eq((select count(*) from jsonb_array_elements(public.guest_movie_night_state(test.t('gu_sec1')) -> 'results') r where (r ->> 'on_my_list')::boolean), 0::bigint, 'and nothing on My list');
-- Guest 2 hasn't: nothing yet.
select test.expect_eq(jsonb_array_length(public.guest_movie_night_state(test.t('gu_sec2')) -> 'results'), 0, 'one who has not finished sees no results yet');
-- A card that came from the family's list: a guest sees where it came from but is given no id of the family's list
-- entry, while a member is.
reset role;
begin;
insert into public.list_items (group_id, added_by, media_id)
  select test.v('gu_fam'), :mia::uuid, id from public.media where tmdb_id = 8951;
update public.movie_night_candidates c
  set origin = 'list',
      list_item_id = (select li.id from public.list_items li where li.group_id = test.v('gu_fam') and li.media_id = c.media_id)
  where c.id = test.gcand(8951);
:as_service
select test.expect_eq((select count(*) from jsonb_array_elements(public.guest_movie_night_state(test.t('gu_sec1'), true) -> 'candidates') c where c ->> 'origin' = 'list'), 1::bigint, 'a guest sees which card came from the family''s list');
select test.expect_eq((select count(*) from jsonb_array_elements(public.guest_movie_night_state(test.t('gu_sec1'), true) -> 'candidates') c where c -> 'list_item_id' <> 'null'::jsonb), 0::bigint, 'but is given no list item id');
:as_mia
select test.expect_eq((select count(*) from jsonb_array_elements(public.movie_night_state(test.v('gu_a'), true) -> 'candidates') c where c -> 'list_item_id' <> 'null'::jsonb), 1::bigint, 'where a member is given it');
reset role;
rollback;
:as_service
select test.expect_eq((public.guest_movie_night_state(test.t('gu_sec2')) -> 'stacks' -> 0 ->> 'my_voted')::integer, 2, 'only their own votes count as theirs');

-- ---- What the family sees --------------------------------------------------------------------------------------------
:as_mia
select test.expect_eq(public.movie_night_state(test.v('gu_a')) ->> 'viewer', 'member'::text, 'a member is told they are one');
select test.expect_eq(jsonb_array_length(public.movie_night_state(test.v('gu_a')) -> 'members'), 12, 'the family sees its guests among who is in');
select test.expect_eq((select string_agg(m ->> 'name', ',' order by m ->> 'name') from jsonb_array_elements(public.movie_night_state(test.v('gu_a')) -> 'members') m
  where (m ->> 'guest')::boolean and m ->> 'name' like 'Z%'), 'Zoe Park'::text, 'by the name they gave');
select test.expect_eq(jsonb_array_length(public.movie_night_state(test.v('gu_a')) -> 'results'), 0, 'results stay hidden from a member who has not finished');
select public.cast_movie_night_votes(test.v('gu_stack'), jsonb_build_array(
  jsonb_build_object('candidate_id', test.gcand(8951), 'vote', 'nope'), jsonb_build_object('candidate_id', test.gcand(8952), 'vote', 'yes'),
  jsonb_build_object('candidate_id', test.gcand(8958), 'vote', 'love')));
select public.finish_movie_night_stack(test.v('gu_stack'));
-- One of the cards is already on the family's list: a member is told which list item, a guest isn't (just that it is).
insert into public.list_items (group_id, added_by, media_id) select :fam, :mia, id from public.media where tmdb_id = 8958;
select test.expect_eq((select count(*) from jsonb_array_elements(public.movie_night_state(test.v('gu_a')) -> 'results') r
  where (r ->> 'on_family_list')::boolean and (r ->> 'family_item_id') is not null), 1::bigint, 'a member is told which list item a card is');
:as_service
select test.expect_eq((select count(*) from jsonb_array_elements(public.guest_movie_night_state(test.t('gu_sec1')) -> 'results') r
  where (r ->> 'on_family_list')::boolean), 1::bigint, 'a guest is told a card is on the family''s list');
select test.expect_eq((select count(*) from jsonb_array_elements(public.guest_movie_night_state(test.t('gu_sec1')) -> 'results') r
  where r -> 'family_item_id' <> 'null'::jsonb), 0::bigint, 'but not which list item');
:as_mia
-- GU8951: Mia nope -1, Zoe love +2, Yan nope -1 = 0. GU8952: Mia yes +1, Zoe yes +1, Yan love +2 = 4. GU8954: Zoe yes = 1. GU8958: Mia love = 2.
select test.expect_eq((select string_agg(m.title || ':' || (r ->> 'points'), ',' order by (r ->> 'rank')::integer)
  from jsonb_array_elements(public.movie_night_state(test.v('gu_a')) -> 'results') r
  join public.movie_night_candidates c on c.id = (r ->> 'candidate_id')::uuid join public.media m on m.id = c.media_id),
  'GU8952:4,GU8958:2,GU8954:1,GU8951:0'::text, 'guests'' votes count in the points and the ranking');
select test.expect_eq((select string_agg((v ->> 'name') || '=' || (v ->> 'vote') || ':' || (v ->> 'guest'), ',' order by v ->> 'name')
  from jsonb_array_elements(public.movie_night_state(test.v('gu_a')) -> 'results') r,
       jsonb_array_elements(r -> 'votes') v
  where (r ->> 'candidate_id')::uuid = test.gcand(8952)), 'Mia=yes:false,Yan=love:true,Zoe Park=yes:true'::text, 'and show who voted what, with the guests tagged');

-- ---- Taking a guest out, replacing the link, turning it off ----------------------------------------------------------
:as_olu
select test.expect_error($$select public.remove_movie_night_guest(test.v('gu_a'), test.v('gu_g2'))$$, 'not available');
:as_noa
select test.expect_error($$select public.remove_movie_night_guest(test.v('gu_a'), gen_random_uuid())$$, 'not in this movie night');
select public.remove_movie_night_guest(test.v('gu_a'), test.v('gu_g2'));
reset role;
select test.expect_eq((select count(*) from public.movie_night_guest_votes where guest_id = test.v('gu_g2')), 0::bigint, 'a guest who is taken out takes their votes with them');
:as_noa
select test.expect_eq(jsonb_array_length(public.movie_night_state(test.v('gu_a')) -> 'members'), 11, 'and is no longer in');
:as_service
select test.expect_error($$select public.guest_movie_night_state(test.t('gu_sec2'))$$, 'not available');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec2'), test.v('gu_stack'), '[]')$$, 'not available');
select public.guest_leave(test.t('gu_sec2'));
select public.guest_leave('not a secret');
select public.guest_leave(null);
-- Someone who joins after that can take the name again.
select public.guest_join(test.t('gu_tok'), 'Yan');
:as_mia
-- A new link: the old one is dead, and the guests who are in stay in.
select public.replace_movie_night_guest_link(test.v('gu_a')) as tok2 \gset
reset role;
insert into test.vals values ('gu_tok2', :'tok2');
select test.expect_eq(test.t('gu_tok2') <> test.t('gu_tok'), true, 'a replaced link is a different one');
:as_service
select test.expect_eq(public.guest_link_info(test.t('gu_tok')) ->> 'open', 'false'::text, 'the old link says nothing is open');
select test.expect_error($$select public.guest_join(test.t('gu_tok'), 'Late')$$, 'is over');
select test.expect_eq(public.guest_link_info(test.t('gu_tok2')) ->> 'open', 'true'::text, 'the new one works');
select test.expect_eq(public.guest_movie_night_state(test.t('gu_sec1')) ->> 'viewer', 'guest'::text, 'and the guests who were in are still in');
:as_noa
select public.turn_off_movie_night_guest_link(test.v('gu_a'));
:as_service
select test.expect_eq(public.guest_link_info(test.t('gu_tok2')) ->> 'open', 'false'::text, 'a link that is turned off says nothing is open');
select test.expect_error($$select public.guest_join(test.t('gu_tok2'), 'Late')$$, 'is over');
select test.expect_eq(public.guest_movie_night_state(test.t('gu_sec1')) ->> 'viewer', 'guest'::text, 'and the guests who are in can still vote');
:as_mia
select test.expect_eq(public.get_movie_night_guest_link(test.v('gu_a')) <> test.t('gu_tok2'), true, 'asking for the link again makes a new one');

-- ---- The best titles count the guests' votes, and the night ends for them with it -----------------------------------
-- Nobody picks: the night is cancelled, and its titles with points go on the family list. With Yan taken out: GU8951
-- has Mia's nope and Zoe's love (+1), GU8952 two yes (+2), GU8954 Zoe's yes (+1) and GU8958 Mia's love (+2).
select test.expect_eq(test.gu_list(), '{8958}'::integer[], 'only GU8958 is on the family list so far');
select public.cancel_movie_night(test.v('gu_a'));
select test.expect_eq(public.add_movie_night_top_titles(test.v('gu_a')), 3, 'the best titles that are not on the list yet are added (GU8958 was)');
select test.expect_eq(test.gu_list(), '{8951,8952,8954,8958}'::integer[], 'among them two that only guests liked enough (GU8951, GU8954)');
:as_service
select test.expect_error($$select public.guest_movie_night_state(test.t('gu_sec1'))$$, 'is over');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec1'), test.v('gu_stack'), '[]')$$, 'is over');
select test.expect_error($$select public.guest_finish_stack(test.t('gu_sec1'), test.v('gu_stack'))$$, 'is over');
select test.expect_eq(public.guest_link_info(test.t('gu_tok2')) ->> 'open', 'false'::text, 'a link of a night that is over says nothing is open');
select test.expect_error($$select public.guest_join(test.t('gu_tok2'), 'Late')$$, 'is over');
select public.guest_leave(test.t('gu_sec1'));
:as_mia
select test.expect_error($$select public.get_movie_night_guest_link(test.v('gu_a'))$$, 'cancelled');

-- ---- A night that goes quiet ends for guests too ---------------------------------------------------------------------
:as_olu
select public.start_movie_night((select id from public.groups where name = 'Other Guest Fam'), '{}', '{}', test.cands(8963, 8974)) as night_b \gset
reset role;
insert into test.vals values ('gu_b', :'night_b');
insert into test.vals select 'gu_b_stack', id::text from public.movie_night_stacks where night_id = test.v('gu_b');
:as_olu
select public.get_movie_night_guest_link(test.v('gu_b')) as tok_b \gset
reset role;
insert into test.vals values ('gu_tok_b', :'tok_b');
:as_service
select r ->> 'secret' as sec_b from (select public.guest_join(test.t('gu_tok_b'), 'Bea') as r) x \gset
reset role;
insert into test.vals values ('gu_sec_b', :'sec_b');
:as_service
-- A guest of one night can't touch another, and a member can only take out the guests of their own night.
:as_olu
select test.expect_error($$select public.remove_movie_night_guest(test.v('gu_b'), test.gu_any_guest())$$, 'not in this movie night');
:as_service
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec_b'), test.v('gu_stack'), '[]')$$, 'not available');
select test.expect_error($$select public.guest_finish_stack(test.t('gu_sec_b'), test.v('gu_stack'))$$, 'not available');
select test.expect_eq(public.guest_movie_night_state(test.t('gu_sec_b')) -> 'night' ->> 'group_name', 'Other Guest Fam'::text, 'a guest sees their own night');
reset role;
update public.movie_nights set last_activity_at = now() - interval '13 hours' where id = test.v('gu_b');
:as_service
select test.expect_error($$select public.guest_movie_night_state(test.t('gu_sec_b'))$$, 'is over');
select test.expect_error($$select public.guest_cast_votes(test.t('gu_sec_b'), test.v('gu_b_stack'), '[]')$$, 'is over');
select test.expect_eq(public.guest_link_info(test.t('gu_tok_b')) ->> 'open', 'false'::text, 'so is the night''s link');
select test.expect_error($$select public.guest_join(test.t('gu_tok_b'), 'Late')$$, 'is over');
reset role;
select test.expect_eq((select status from public.movie_nights where id = test.v('gu_b')), 'expired'::text, 'a night nobody touched for 12 hours is over');

-- ---- Going away ---------------------------------------------------------------------------------------------------------
select test.expect_eq((select count(*) from public.movie_night_links), 2::bigint, 'two nights have links');
select test.expect_eq((select count(*) from public.movie_night_guests where night_id = test.v('gu_a')) > 0, true, 'night A still has its guests');
delete from public.movie_nights where id = test.v('gu_a');
select test.expect_eq((select count(*) from public.movie_night_guests where night_id = test.v('gu_a')), 0::bigint, 'deleting a night deletes its guests');
select test.expect_eq((select count(*) from public.movie_night_guest_votes), 0::bigint, 'and their votes');
select test.expect_eq((select count(*) from public.movie_night_guest_finishes), 0::bigint, 'and what they finished');
select test.expect_eq((select count(*) from public.movie_night_links where night_id = test.v('gu_a')), 0::bigint, 'and its link');
delete from public.groups where name = 'Other Guest Fam';
select test.expect_eq((select count(*) from public.movie_night_guests), 0::bigint, 'deleting a family deletes the guests of its nights too');
select test.expect_eq((select count(*) from public.movie_night_links), 0::bigint, 'and their links');
