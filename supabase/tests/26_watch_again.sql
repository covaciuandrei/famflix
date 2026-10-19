\set ON_ERROR_STOP 1
-- Watching a title again. What a list shows is the title's current viewing; watching it again moves that viewing into
-- watch_history and starts a new one. Covered here: putting a family title back on To watch (the viewing goes to the
-- history, My list entries, scores and the movie night history stay), a new viewing that replaces it, "I wasn't there"
-- for the later viewing only (a person's earlier one stays on their My list), a movie night pick on a later day,
-- the same day or an earlier one, titles on My list, who may see and do what, the limit, what a night's cards say about
-- the days the family watched them before (and that guests aren't told), and what happens when a family or an account
-- goes. Titles are called WA<name>: Movie (7101), Personal (7102), Series (7103, with episodes),
-- Tv (7104, without), Pick (7105), Dev (7106), Flag (7107), Mark (7108) and the cards of a night (7111 to 7117).
\set as_ada  'reset role; select set_config(''request.jwt.claim.sub'', ''5a5a5a5a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_bea  'reset role; select set_config(''request.jwt.claim.sub'', ''5b5b5b5b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cal  'reset role; select set_config(''request.jwt.claim.sub'', ''5c5c5c5c-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_dev  'reset role; select set_config(''request.jwt.claim.sub'', ''5d5d5d5d-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set ada '''5a5a5a5a-0000-0000-0000-000000000001'''
\set bea '''5b5b5b5b-0000-0000-0000-000000000002'''
\set cal '''5c5c5c5c-0000-0000-0000-000000000003'''
\set dev '''5d5d5d5d-0000-0000-0000-000000000004'''
\set fam  '(select v::uuid from test.vals where k = ''wa_fam'')'
\set item '(select v::uuid from test.vals where k = ''wa_item'')'

insert into auth.users (id, email, raw_user_meta_data) values
  (:ada, 'ada26@x.test', '{"full_name":"Ada"}'),
  (:bea, 'bea26@x.test', '{"full_name":"Bea"}'),
  (:cal, 'cal26@x.test', '{"full_name":"Cal"}'),
  (:dev, 'dev26@x.test', '{"full_name":"Dev"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create or replace function test.wa_u(p_name text) returns uuid language sql immutable as $$
  select case p_name when 'ada' then '5a5a5a5a-0000-0000-0000-000000000001'::uuid
                     when 'bea' then '5b5b5b5b-0000-0000-0000-000000000002'::uuid
                     when 'cal' then '5c5c5c5c-0000-0000-0000-000000000003'::uuid
                     when 'dev' then '5d5d5d5d-0000-0000-0000-000000000004'::uuid end $$;
-- Viewers for log_watch and watched_again, by name, with no scores.
create or replace function test.wa_viewers(variadic p_names text[]) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('user_id', test.wa_u(n), 'score', null)) from unnest(p_names) n $$;
-- A person's earlier viewings of a title (by TMDB id), oldest first: "2026-01-10,2026-02-14".
create or replace function test.wa_hist(p_user uuid, p_tmdb integer) returns text language sql stable security definer as $$
  select coalesce(string_agg(h.watched_on::text, ',' order by h.watched_on), '')
  from public.watch_history h join public.media m on m.id = h.media_id
  where h.user_id = p_user and m.tmdb_id = p_tmdb $$;
-- A family title's status and its current watch record: "watched:Ada@2026-01-10,Bea@2026-01-10" or "want:".
create or replace function test.wa_now(p_item uuid) returns text language sql stable security definer as $$
  select (select status from public.list_items where id = p_item) || ':' ||
         coalesce((select string_agg(p.display_name || '@' || w.watched_on, ',' order by p.display_name)
                   from public.watches w join public.profiles p on p.id = w.user_id where w.list_item_id = p_item), '') $$;
-- A person's own My list entry for a title: "watched@2026-01-10 linked" (put there by a family's watch), "want own", "none".
create or replace function test.wa_mine(p_user uuid, p_tmdb integer) returns text language sql stable security definer as $$
  select coalesce((select li.status || coalesce('@' || (li.watched_at at time zone 'UTC')::date, '')
                          || case when li.source_item_id is null then ' own' else ' linked' end
                   from public.list_items li join public.media m on m.id = li.media_id
                   where li.group_id is null and li.added_by = p_user and m.tmdb_id = p_tmdb), 'none') $$;
-- The family's movie nights that ended with a title, oldest first, with who watched: "2026-01-10:Ada+Bea | 2026-02-14:Ada".
create or replace function test.wa_nights(p_tmdb integer) returns text language sql stable security definer as $$
  select coalesce(string_agg(n.happened_on || ':' || coalesce((select string_agg(p.display_name, '+' order by p.display_name)
            from public.movie_night_members m join public.profiles p on p.id = m.user_id
            where m.night_id = n.id and m.watched), '-'), ' | ' order by n.happened_on, n.created_at), '')
  from public.movie_nights n join public.media md on md.id = n.picked_media_id
  where n.group_id = (select v::uuid from test.vals where k = 'wa_fam') and md.tmdb_id = p_tmdb $$;
-- Eight cards for a night: the Pick title and seven others.
create or replace function test.wa_cands() returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id)
  from public.media where tmdb_id in (7105, 7111, 7112, 7113, 7114, 7115, 7116, 7117) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Days to use: long enough ago to never be in the future.
select (current_date - 300)::text as d1, (current_date - 200)::text as d2, (current_date - 100)::text as d3,
       (current_date - 50)::text as d4, (current_date - 20)::text as d5 \gset

insert into public.media (tmdb_id, media_type, title, series) values
  (7101, 'movie', 'WAMovie', null),
  (7102, 'movie', 'WAPersonal', null),
  (7103, 'tv', 'WASeries', '{"status": "Ended", "seasons": [{"n": 1, "episodes": 3}], "last_aired": {"s": 1, "e": 3}, "next_air": null}'),
  (7104, 'tv', 'WATv', null),
  (7105, 'movie', 'WAPick', null),
  (7106, 'movie', 'WADev', null),
  (7107, 'movie', 'WAFlag', null),
  (7108, 'movie', 'WAMark', null);
insert into public.media (tmdb_id, media_type, title) select g, 'movie', 'WACard' || g from generate_series(7111, 7117) g;

-- Ada, Bea and Cal are a family; Dev has his own.
:as_ada
select public.create_group('Again Fam');
:as_dev
select public.create_group('Other Again Fam');
reset role;
insert into test.vals select 'wa_fam', id::text from public.groups where name = 'Again Fam';
insert into test.vals select 'wa_code', invite_code from public.groups where name = 'Again Fam';
insert into test.vals select 'wa_fam2', id::text from public.groups where name = 'Other Again Fam';
:as_bea
select public.join_group((select v from test.vals where k = 'wa_code'));
:as_cal
select public.join_group((select v from test.vals where k = 'wa_code'));

-- ---- A family title: watched, then put back on To watch -----------------------------------------------------------
:as_ada
insert into public.list_items (group_id, added_by, media_id) select :fam, :ada, id from public.media where tmdb_id = 7101;
reset role;
insert into test.vals select 'wa_item', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('wa_fam') and m.tmdb_id = 7101;
:as_ada
select public.log_watch(:item, :'d1'::date, test.wa_viewers('ada', 'bea', 'cal'));
insert into public.ratings (list_item_id, user_id, score, comment) values (:item, :ada, 8, 'Cosy');
:as_bea
insert into public.ratings (list_item_id, user_id, score, comment) values (:item, :bea, 6, 'Fine');
reset role;
select test.expect_eq(test.wa_now(:item), 'watched:Ada@' || :'d1' || ',Bea@' || :'d1' || ',Cal@' || :'d1', 'the first viewing: all three were there');
select test.expect_eq(test.wa_mine(:ada, 7101), 'watched@' || :'d1' || ' linked', 'it is on Ada''s My list');
select test.expect_eq(test.wa_mine(:bea, 7101), 'watched@' || :'d1' || ' linked', 'and Bea''s');
select test.expect_eq(test.wa_mine(:cal, 7101), 'watched@' || :'d1' || ' linked', 'and Cal''s');
select test.expect_eq(test.wa_nights(7101), :'d1' || ':Ada+Bea+Cal', 'and a movie night of that day is in the history');
select test.expect_eq((select count(*) from public.watch_history where group_id = :fam), 0::bigint, 'this family has no earlier viewing yet');

:as_bea
select public.watch_again(:item);
reset role;
select test.expect_eq(test.wa_now(:item), 'want:', 'put back on To watch: no current viewing');
select test.expect_eq(test.wa_hist(:ada, 7101), :'d1', 'Ada''s viewing is in the history');
select test.expect_eq(test.wa_hist(:bea, 7101), :'d1', 'and Bea''s');
select test.expect_eq(test.wa_hist(:cal, 7101), :'d1', 'and Cal''s');
select test.expect_eq((select count(*) from public.watch_history where group_id = :fam), 3::bigint, 'as the family''s viewings');
select test.expect_eq((select logged_by from public.watch_history where user_id = :bea), :ada::uuid, 'with who logged them');
select test.expect_eq(test.wa_mine(:ada, 7101), 'watched@' || :'d1' || ' linked', 'Ada''s My list entry stays as it was');
select test.expect_eq(test.wa_mine(:bea, 7101), 'watched@' || :'d1' || ' linked', 'and Bea''s');
select test.expect_eq(test.wa_mine(:cal, 7101), 'watched@' || :'d1' || ' linked', 'and Cal''s');
select test.expect_eq(test.wa_nights(7101), :'d1' || ':Ada+Bea+Cal', 'the movie night of that day stays too');
select test.expect_eq((select score from public.ratings where list_item_id = :item and user_id = :ada), 8, 'scores stay');
select test.expect_eq((select comment from public.ratings where list_item_id = :item and user_id = :bea), 'Fine', 'and notes');
select test.expect_eq((select score from public.ratings r join public.list_items li on li.id = r.list_item_id
  where li.group_id is null and li.added_by = :bea and r.user_id = :bea), 6, 'also the copy on Bea''s My list');
select test.expect_eq((select count(*) from public.activity where kind = 'watch_again' and list_item_id = :item and actor_name = 'Bea'), 1::bigint,
  'the feed says who put it back');

-- Who sees the history, and who can't touch it.
:as_cal
select test.expect_eq((select count(*) from public.watch_history where group_id = :fam), 3::bigint, 'a member of the family sees the family''s earlier viewings');
:as_dev
select test.expect_eq((select count(*) from public.watch_history), 0::bigint, 'somebody outside the family sees none of them');
:as_anon
select test.expect_error($$select * from public.watch_history$$, 'permission denied');
select test.expect_error($$select public.watch_again(test.v('wa_item'))$$, 'permission denied');
select test.expect_error($$select public.watched_again(test.v('wa_item'), current_date, null)$$, 'permission denied');
:as_ada
select test.expect_error($$insert into public.watch_history (user_id, media_id, watched_on)
  values ('5a5a5a5a-0000-0000-0000-000000000001', (select id from public.media where tmdb_id = 7101), current_date)$$, 'permission denied');
select test.expect_error($$update public.watch_history set watched_on = current_date$$, 'permission denied');
select test.expect_error($$delete from public.watch_history$$, 'permission denied');
select test.expect_error($$select public.archive_family_viewing(test.v('wa_item'))$$, 'permission denied');
select test.expect_error($$select public.archive_my_viewing(test.v('wa_item'), 'want')$$, 'permission denied');
-- And who can ask for it.
select test.expect_error($$select public.watch_again(test.v('wa_item'))$$, 'not marked as watched');
select test.expect_error($$select public.watch_again(gen_random_uuid())$$, 'not on one of your lists');
:as_dev
select test.expect_error($$select public.watch_again(test.v('wa_item'))$$, 'not on one of your lists');
select test.expect_error($$select public.watched_again(test.v('wa_item'), current_date, null)$$, 'not on one of your lists');

-- ---- A new viewing, and "I wasn't there" for it -------------------------------------------------------------------
:as_ada
select public.log_watch(:item, :'d2'::date, test.wa_viewers('ada', 'bea'));
reset role;
select test.expect_eq(test.wa_now(:item), 'watched:Ada@' || :'d2' || ',Bea@' || :'d2', 'a new viewing: Ada and Bea');
select test.expect_eq(test.wa_mine(:ada, 7101), 'watched@' || :'d2' || ' linked', 'the date on Ada''s My list follows it');
select test.expect_eq(test.wa_mine(:cal, 7101), 'watched@' || :'d1' || ' linked', 'Cal''s entry is as it was: he wasn''t there this time');
select test.expect_eq(test.wa_nights(7101), :'d1' || ':Ada+Bea+Cal | ' || :'d2' || ':Ada+Bea', 'a movie night for each day');

:as_bea
delete from public.watches where list_item_id = :item and user_id = :bea;
reset role;
select test.expect_eq(test.wa_nights(7101), :'d1' || ':Ada+Bea+Cal | ' || :'d2' || ':Ada', '"I wasn''t there" takes her off the night of that viewing only');
select test.expect_eq(test.wa_mine(:bea, 7101), 'watched@' || :'d1' || ' linked', 'and her My list entry goes back to the time she was there');
select test.expect_eq((select score from public.ratings r join public.list_items li on li.id = r.list_item_id
  where li.group_id is null and li.added_by = :bea and r.user_id = :bea), 6, 'with her score');
select test.expect_eq(test.wa_now(:item), 'watched:Ada@' || :'d2', 'the family''s viewing carries on with Ada');

-- Logging again on a watched title, the plain way, adds nothing to the history (a later date is a correction).
:as_ada
select public.log_watch(:item, :'d3'::date, test.wa_viewers('cal'));
reset role;
select test.expect_eq(test.wa_now(:item), 'watched:Ada@' || :'d2' || ',Cal@' || :'d3', 'the plain Watched together adds people');
select test.expect_eq((select count(*) from public.watch_history where group_id = :fam), 3::bigint, 'and this family''s history is as it was');

-- ---- We watched it again: the same, in one go, or nothing at all --------------------------------------------------
:as_ada
select test.expect_error($$select public.watched_again(test.v('wa_item'), current_date - 5, test.wa_viewers('ada', 'dev'))$$, 'Only members of this family');
select test.expect_error($$select public.watched_again(test.v('wa_item'), current_date + 5, test.wa_viewers('ada'))$$, 'not in the future');
begin;
select public.watched_again(test.v('wa_item'), null, test.wa_viewers('ada'));
select test.expect_eq((select watched_on is null from public.watches where list_item_id = :item), true, 'a family rewatch may have an unknown date');
rollback;
select test.expect_error($$select public.watched_again(test.v('wa_item'), current_date - 5, null)$$, 'at least one person');
reset role;
select test.expect_eq(test.wa_now(:item), 'watched:Ada@' || :'d2' || ',Cal@' || :'d3', 'a viewing that is refused changes nothing');
select test.expect_eq((select count(*) from public.watch_history where group_id = :fam), 3::bigint, 'not even this family''s history');

:as_ada
select public.watched_again(:item, :'d4'::date, test.wa_viewers('ada', 'bea', 'cal'));
reset role;
select test.expect_eq(test.wa_now(:item), 'watched:Ada@' || :'d4' || ',Bea@' || :'d4' || ',Cal@' || :'d4', 'the new viewing takes the place of the one before');
select test.expect_eq(test.wa_hist(:ada, 7101), :'d1' || ',' || :'d2', 'Ada''s earlier viewings: the first and the second');
select test.expect_eq(test.wa_hist(:bea, 7101), :'d1', 'Bea has only the first: she took herself off the second');
select test.expect_eq(test.wa_hist(:cal, 7101), :'d1' || ',' || :'d3', 'Cal''s: the first, and the one he was added to');
select test.expect_eq(test.wa_nights(7101),
  :'d1' || ':Ada+Bea+Cal | ' || :'d2' || ':Ada | ' || :'d3' || ':Cal | ' || :'d4' || ':Ada+Bea+Cal', 'a movie night for each of the days');

-- Never watched together at the moment (put back on To watch): it is simply logged.
:as_cal
select public.watch_again(:item);
:as_bea
select public.watched_again(:item, :'d5'::date, test.wa_viewers('bea', 'cal'));
reset role;
select test.expect_eq(test.wa_now(:item), 'watched:Bea@' || :'d5' || ',Cal@' || :'d5', 'a title on To watch is logged as a new viewing');
select test.expect_eq(test.wa_hist(:ada, 7101), :'d1' || ',' || :'d2' || ',' || :'d4', 'with the one before in the history');

-- ---- The limit -----------------------------------------------------------------------------------------------------
insert into public.rate_limits (user_id, action, window_start, hits)
  values (:cal, 'watch_again', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 60)
  on conflict (user_id, action, window_start) do update set hits = 60;
:as_cal
select test.expect_error($$select public.watch_again(test.v('wa_item'))$$, 'too often');
select test.expect_error($$select public.watched_again(test.v('wa_item'), current_date, test.wa_viewers('cal'))$$, 'too often');
reset role;
delete from public.rate_limits where user_id = :cal and action = 'watch_again';

-- ---- On My list ----------------------------------------------------------------------------------------------------
:as_ada
insert into public.list_items (group_id, added_by, media_id, status)
  select null, :ada, id, 'watched' from public.media where tmdb_id in (7102, 7103, 7104);
update public.list_items set watched_at = :'d1'::date::timestamptz + interval '12 hours'
  where group_id is null and added_by = :ada and media_id in (select id from public.media where tmdb_id in (7102, 7103, 7104));
reset role;
insert into test.vals select 'wa_mine' || m.tmdb_id, li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id is null and li.added_by = :ada and m.tmdb_id in (7102, 7103, 7104);

:as_bea
select test.expect_error($$select public.watch_again(test.v('wa_mine7102'))$$, 'not on one of your lists');
select test.expect_error($$select public.watched_again(test.v('wa_mine7102'), current_date, null)$$, 'not on one of your lists');
:as_ada
select public.watch_again(test.v('wa_mine7102'));
reset role;
select test.expect_eq(test.wa_mine(:ada, 7102), 'want own', 'a movie on My list goes back to To watch');
select test.expect_eq(test.wa_hist(:ada, 7102), :'d1', 'its viewing is in the history');
select test.expect_eq((select group_id from public.watch_history where user_id = :ada and media_id = (select id from public.media where tmdb_id = 7102)),
  null::uuid, 'as one on her own');
:as_bea
select test.expect_eq((select count(*) from public.watch_history h join public.media m on m.id = h.media_id where m.tmdb_id = 7102), 0::bigint,
  'nobody else sees a viewing on My list');
:as_ada
select test.expect_error($$select public.watch_again(test.v('wa_mine7102'))$$, 'not marked as watched');
-- A series with episodes is started again from its page; one with none is a title like any other.
select test.expect_error($$select public.watch_again(test.v('wa_mine7103'))$$, 'Start a series again');
select test.expect_error($$select public.watched_again(test.v('wa_mine7103'), current_date, null)$$, 'Start a series again');
select public.watch_again(test.v('wa_mine7104'));
reset role;
select test.expect_eq(test.wa_mine(:ada, 7104), 'want own', 'a series with no episode list goes back to To watch like a movie');

:as_ada
select public.watched_again(test.v('wa_mine7102'), :'d4'::date, null);
reset role;
select test.expect_eq(test.wa_mine(:ada, 7102), 'watched@' || :'d4' || ' own', 'on To watch it is simply marked watched on the day');
select test.expect_eq(test.wa_hist(:ada, 7102), :'d1', 'with no new history');
:as_ada
select public.watched_again(test.v('wa_mine7102'), :'d5'::date, null);
reset role;
select test.expect_eq(test.wa_mine(:ada, 7102), 'watched@' || :'d5' || ' own', 'watched again takes the new day');
select test.expect_eq(test.wa_hist(:ada, 7102), :'d1' || ',' || :'d4', 'and the one before goes to the history');
:as_ada
select test.expect_error($$select public.watched_again(test.v('wa_mine7102'), current_date + 5, null)$$, 'not in the future');
begin;
select public.watched_again(test.v('wa_mine7102'), null, null);
select test.expect_eq((select watched_at is null from public.list_items where id = test.v('wa_mine7102')), true, 'a personal rewatch may have an unknown date');
rollback;

-- An entry a family's watch put on My list becomes the person's own again, and its viewing is remembered as the family's.
:as_cal
select public.watch_again((select li.id from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id is null and li.added_by = :cal and m.tmdb_id = 7101));
reset role;
select test.expect_eq(test.wa_mine(:cal, 7101), 'want own', 'Cal''s entry from the family''s watch is his own, on To watch');
select test.expect_eq((select group_id from public.watch_history where user_id = :cal and watched_on = :'d5'::date), :fam,
  'and the viewing it had is the family''s');

-- ---- A movie night pick: a later day is a new viewing, the same day joins it, an earlier one is as before ---------------
:as_ada
insert into public.list_items (group_id, added_by, media_id) select :fam, :ada, id from public.media where tmdb_id = 7105;
reset role;
insert into test.vals select 'wa_pick', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('wa_fam') and m.tmdb_id = 7105;
:as_ada
select public.log_watch(test.v('wa_pick'), :'d1'::date, test.wa_viewers('ada', 'bea'));
select public.start_movie_night(:fam, '{}', '{}', test.wa_cands()) as n1 \gset
select public.pick_movie_night_card(:'n1'::uuid, (select c.id from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = :'n1'::uuid and m.tmdb_id = 7105), :'d3'::date, test.wa_viewers('ada', 'cal'));
reset role;
select test.expect_eq(test.wa_now(test.v('wa_pick')), 'watched:Ada@' || :'d3' || ',Cal@' || :'d3', 'a pick on a later day is a new viewing');
select test.expect_eq(test.wa_hist(:ada, 7105), :'d1', 'the one before is in Ada''s history');
select test.expect_eq(test.wa_hist(:bea, 7105), :'d1', 'and Bea''s');
select test.expect_eq(test.wa_hist(:cal, 7105), '', 'and Cal, who was not there then, has none');
select test.expect_eq((select status from public.movie_nights where id = :'n1'::uuid), 'closed'::text, 'the night ended with it');

:as_bea
select public.start_movie_night(:fam, '{}', '{}', test.wa_cands()) as n2 \gset
select public.pick_movie_night_card(:'n2'::uuid, (select c.id from public.movie_night_candidates c join public.media m on m.id = c.media_id
  where c.night_id = :'n2'::uuid and m.tmdb_id = 7105), :'d3'::date, test.wa_viewers('bea'));
reset role;
select test.expect_eq(test.wa_now(test.v('wa_pick')), 'watched:Ada@' || :'d3' || ',Bea@' || :'d3' || ',Cal@' || :'d3', 'a pick on the same day joins the viewing');
select test.expect_eq(test.wa_hist(:ada, 7105), :'d1', 'and the history is as it was');

-- "Pick something else": any title, by its id. A later day again.
:as_cal
select public.start_movie_night(:fam, '{}', '{}', test.wa_cands()) as n3 \gset
select public.pick_movie_night_title(:'n3'::uuid, (select id from public.media where tmdb_id = 7105), :'d5'::date, test.wa_viewers('ada'));
reset role;
select test.expect_eq(test.wa_now(test.v('wa_pick')), 'watched:Ada@' || :'d5', 'a title picked from outside the cards, on a later day, is a new viewing too');
select test.expect_eq(test.wa_hist(:ada, 7105), :'d1' || ',' || :'d3', 'the viewing before it is in the history');
select test.expect_eq(test.wa_hist(:cal, 7105), :'d3', 'with Cal''s');

-- An earlier day than the current viewing is nothing new: as it always was.
:as_ada
select public.start_movie_night(:fam, '{}', '{}', test.wa_cands()) as n4 \gset
select public.pick_movie_night_title(:'n4'::uuid, (select id from public.media where tmdb_id = 7105), :'d2'::date, test.wa_viewers('bea'));
reset role;
select test.expect_eq(test.wa_now(test.v('wa_pick')), 'watched:Ada@' || :'d5' || ',Bea@' || :'d2', 'a pick on an earlier day adds to the viewing');
select test.expect_eq(test.wa_hist(:ada, 7105), :'d1' || ',' || :'d3', 'and changes nothing in the history');

-- ---- A night's cards say whether the family watched them before ---------------------------------------------------
-- The Pick title (7105) has two days with this family in the history (d1 and d3). Card 7111 was watched by Ada on her
-- own, 7112 on two days with the family, and 7113 by another family: only this family's own days count.
\set as_service 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role service_role;'
create or replace function test.wa_before(p_state jsonb) returns text language sql immutable as $$
  select string_agg((c ->> 'tmdb_id') || '=' || coalesce(c ->> 'watched_before', 'null'), ',' order by (c ->> 'tmdb_id')::integer)
  from jsonb_array_elements(p_state -> 'candidates') c $$;
grant execute on function test.wa_before(jsonb) to anon, authenticated, service_role;
reset role;
insert into public.watch_history (user_id, media_id, watched_on, group_id)
  select :ada, id, :'d1'::date, null from public.media where tmdb_id = 7111;
insert into public.watch_history (user_id, media_id, watched_on, group_id)
  select v.u, m.id, v.d, test.v('wa_fam')
  from public.media m, (values (:ada::uuid, :'d2'::date), (:bea::uuid, :'d2'::date), (:ada::uuid, :'d4'::date)) v(u, d)
  where m.tmdb_id = 7112;
insert into public.watch_history (user_id, media_id, watched_on, group_id)
  select :dev, id, :'d1'::date, test.v('wa_fam2') from public.media where tmdb_id = 7113;
:as_ada
select public.start_movie_night(:fam, '{}', '{}', test.wa_cands()) as n5 \gset
select test.expect_eq(test.wa_before(public.movie_night_state(:'n5'::uuid, true)),
  '7105=2,7111=0,7112=2,7113=0,7114=0,7115=0,7116=0,7117=0',
  'a member is told on how many days the family watched each card before, and only the family''s own days count');
:as_cal
select test.expect_eq(test.wa_before(public.movie_night_state(:'n5'::uuid, true)),
  '7105=2,7111=0,7112=2,7113=0,7114=0,7115=0,7116=0,7117=0', 'any member is');
select test.expect_eq(public.movie_night_state(:'n5'::uuid, false) -> 'candidates', '[]'::jsonb, 'and the cards are only sent when asked for');
:as_ada
select public.get_movie_night_guest_link(:'n5'::uuid) as wa_tok \gset
:as_service
select public.guest_join(:'wa_tok', 'Zed') ->> 'secret' as wa_sec \gset
select test.expect_eq(test.wa_before(public.guest_movie_night_state(:'wa_sec', true)),
  '7105=null,7111=null,7112=null,7113=null,7114=null,7115=null,7116=null,7117=null',
  'a guest is told nothing about what the family watched');
:as_ada
select public.cancel_movie_night(:'n5'::uuid);
reset role;
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('wa_fam') and status = 'open'), 0::bigint,
  'and the night is out of the way');
delete from public.watch_history where user_id = :dev;

-- ---- The setting that keeps archiving from counting as leaving doesn't outlast it ---------------------------------
:as_ada
insert into public.list_items (group_id, added_by, media_id) select :fam, :ada, id from public.media where tmdb_id = 7107;
reset role;
insert into test.vals select 'wa_flag', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('wa_fam') and m.tmdb_id = 7107;
:as_ada
select public.log_watch(test.v('wa_flag'), :'d1'::date, test.wa_viewers('ada', 'bea'));
begin;
select public.watch_again(test.v('wa_flag'));
select public.log_watch(test.v('wa_flag'), :'d2'::date, test.wa_viewers('ada', 'bea'));
:as_bea
delete from public.watches where list_item_id = test.v('wa_flag') and user_id = :bea;
commit;
reset role;
select test.expect_eq(test.wa_nights(7107), :'d1' || ':Ada+Bea | ' || :'d2' || ':Ada', 'leaving the record straight after archiving still comes off the night');
select test.expect_eq(test.wa_mine(:bea, 7107), 'watched@' || :'d1' || ' linked', 'and goes back to the earlier viewing on My list');

-- Archiving doesn't touch what people did on their own My list: a day Bea set there herself stays.
:as_ada
insert into public.list_items (group_id, added_by, media_id) select :fam, :ada, id from public.media where tmdb_id = 7108;
reset role;
insert into test.vals select 'wa_mark', li.id::text from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('wa_fam') and m.tmdb_id = 7108;
:as_ada
select public.log_watch(test.v('wa_mark'), :'d1'::date, test.wa_viewers('ada', 'bea'));
:as_bea
update public.list_items set watched_at = :'d4'::date::timestamptz + interval '12 hours'
  where group_id is null and added_by = :bea and media_id = (select id from public.media where tmdb_id = 7108);
:as_ada
select public.watch_again(test.v('wa_mark'));
reset role;
select test.expect_eq(test.wa_mine(:bea, 7108), 'watched@' || :'d4' || ' linked', 'a day Bea set on her own My list is not touched by archiving');
select test.expect_eq(test.wa_hist(:bea, 7108), :'d1', 'and the family''s viewing is in her history');

-- ---- When a family or an account goes ------------------------------------------------------------------------------
:as_dev
insert into public.list_items (group_id, added_by, media_id) select (select v::uuid from test.vals where k = 'wa_fam2'), :dev, id
  from public.media where tmdb_id = 7106;
select public.log_watch((select li.id from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = (select v::uuid from test.vals where k = 'wa_fam2') and m.tmdb_id = 7106), :'d1'::date, test.wa_viewers('dev'));
select public.watch_again((select li.id from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = (select v::uuid from test.vals where k = 'wa_fam2') and m.tmdb_id = 7106));
reset role;
select test.expect_eq((select group_id from public.watch_history where user_id = :dev), (select v::uuid from test.vals where k = 'wa_fam2'),
  'Dev''s viewing is his family''s');
:as_dev
select public.leave_group((select v::uuid from test.vals where k = 'wa_fam2'));
reset role;
select test.expect_eq((select count(*) from public.watch_history where user_id = :dev), 1::bigint, 'when his family goes, his viewing stays his');
select test.expect_eq((select group_id from public.watch_history where user_id = :dev), null::uuid, 'without the family');
delete from auth.users where id = :dev;
select test.expect_eq((select count(*) from public.watch_history where user_id = :dev), 0::bigint, 'and goes with his account');

do $$ begin raise notice 'ALL WATCH AGAIN TESTS PASSED'; end $$;
