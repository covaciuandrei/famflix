\set ON_ERROR_STOP 1
\set as_ann  'reset role; select set_config(''request.jwt.claim.sub'', ''71717171-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_ben  'reset role; select set_config(''request.jwt.claim.sub'', ''72727272-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cara 'reset role; select set_config(''request.jwt.claim.sub'', ''73737373-0000-0000-0000-000000000003'', false); set role authenticated;'

insert into auth.users (id, email, raw_user_meta_data) values
  ('71717171-0000-0000-0000-000000000001', 'ann2@x.test',  '{"full_name":"Ann"}'),
  ('72727272-0000-0000-0000-000000000002', 'ben2@x.test',  '{"full_name":"Ben"}'),
  ('73737373-0000-0000-0000-000000000003', 'cara2@x.test', '{"full_name":"Cara"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

:as_ann
select public.create_group('WatchFam');
reset role;
insert into test.vals select 'w_fam', id::text from public.groups where name = 'WatchFam';
insert into test.vals select 'w_code', invite_code from public.groups where name = 'WatchFam';
:as_ben
select public.join_group((select v from test.vals where k = 'w_code'));
:as_cara
select public.join_group((select v from test.vals where k = 'w_code'));
reset role;
insert into public.media (tmdb_id, media_type, title) values (9301, 'movie', 'Watch A');
:as_ann
insert into public.list_items (group_id, added_by, media_id, status)
  select (select v::uuid from test.vals where k = 'w_fam'), '71717171-0000-0000-0000-000000000001', id, 'want' from public.media where tmdb_id = 9301;
reset role;
insert into test.vals select 'w_item', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9301;

-- Ann logs it: her own 8, a 9 she fills in for Ben, nothing for Cara.
:as_ann
select public.log_watch((select v::uuid from test.vals where k = 'w_item'), current_date,
  '[{"user_id":"71717171-0000-0000-0000-000000000001","score":8},
    {"user_id":"72727272-0000-0000-0000-000000000002","score":9},
    {"user_id":"73737373-0000-0000-0000-000000000003","score":null}]'::jsonb);
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'the person who logged it and gave her own score is not asked');

:as_ben
select test.expect_eq((select count(*) from public.pending_rating_requests()), 1::bigint, 'a member whose score was filled in is asked to confirm it');
select test.expect_eq((select filled_in_score from public.pending_rating_requests()), 9.0::numeric, 'the request shows the filled-in score');
select test.expect_eq((select filled_in_by_name from public.pending_rating_requests()), 'Ann'::text, 'and who filled it in');
select test.expect_eq((select count(*) from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'w_item') and user_id = '72727272-0000-0000-0000-000000000002'), 0::bigint, 'a filled-in score alone doesn''t like the title for him');

:as_cara
select test.expect_eq((select count(*) from public.pending_rating_requests()), 1::bigint, 'a member without a score is asked as before');
select test.expect_eq((select filled_in_score is null from public.pending_rating_requests()), true, 'with no score filled in');

-- Ben keeps the 9 and adds his note (what the popup's Save does).
:as_ben
insert into public.ratings (list_item_id, user_id, score, comment)
  values ((select v::uuid from test.vals where k = 'w_item'), '72727272-0000-0000-0000-000000000002', 9, 'loved it')
  on conflict (list_item_id, user_id) do update set score = excluded.score, comment = excluded.comment;
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'after confirming, the request is gone');
select test.expect_eq((select rated_by from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'w_item') and user_id = '72727272-0000-0000-0000-000000000002'), '72727272-0000-0000-0000-000000000002'::uuid, 'the score is now his own');
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'w_item') and user_id = '72727272-0000-0000-0000-000000000002'), 'like'::text, 'taking over a 9 likes the title');
select test.expect_eq((select comment from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'w_item') and user_id = '72727272-0000-0000-0000-000000000002'), 'loved it'::text, 'his note is saved');

-- Editing only the note still keeps a reaction picked by hand.
update public.reactions set value = 'dislike' where user_id = '72727272-0000-0000-0000-000000000002';
insert into public.ratings (list_item_id, user_id, score, comment)
  values ((select v::uuid from test.vals where k = 'w_item'), '72727272-0000-0000-0000-000000000002', 9, 'loved it, mostly')
  on conflict (list_item_id, user_id) do update set score = excluded.score, comment = excluded.comment;
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'w_item') and user_id = '72727272-0000-0000-0000-000000000002'), 'dislike'::text, 'changing only the note keeps the hand-picked reaction');

-- Cara rates it herself.
:as_cara
insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'w_item'), '73737373-0000-0000-0000-000000000003', 5);
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'Cara''s request is gone once she rates');
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'w_item') and user_id = '73737373-0000-0000-0000-000000000003'), 'dislike'::text, 'her 5 dislikes it');

-- Skipping still works for a filled-in request, and "I wasn't there" can delete a filled-in score.
:as_ann
select public.log_watch((select v::uuid from test.vals where k = 'w_item'), current_date,
  '[{"user_id":"73737373-0000-0000-0000-000000000003","score":null}]'::jsonb);
reset role;
insert into public.media (tmdb_id, media_type, title) values (9302, 'movie', 'Watch B');
:as_ann
insert into public.list_items (group_id, added_by, media_id, status)
  select (select v::uuid from test.vals where k = 'w_fam'), '71717171-0000-0000-0000-000000000001', id, 'want' from public.media where tmdb_id = 9302;
reset role;
insert into test.vals select 'w_item2', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9302;
:as_ann
select public.log_watch((select v::uuid from test.vals where k = 'w_item2'), current_date,
  '[{"user_id":"72727272-0000-0000-0000-000000000002","score":6.5},
    {"user_id":"73737373-0000-0000-0000-000000000003","score":7}]'::jsonb);
:as_ben
update public.watches set skipped_at = now() where list_item_id = (select v::uuid from test.vals where k = 'w_item2') and user_id = '72727272-0000-0000-0000-000000000002';
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'skipping a filled-in request hides it');
:as_cara
delete from public.watches where list_item_id = (select v::uuid from test.vals where k = 'w_item2') and user_id = '73737373-0000-0000-0000-000000000003';
delete from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'w_item2') and user_id = '73737373-0000-0000-0000-000000000003' and rated_by <> '73737373-0000-0000-0000-000000000003';
reset role;
select test.expect_eq((select count(*) from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'w_item2') and user_id = '73737373-0000-0000-0000-000000000003'), 0::bigint, '"I wasn''t there" removes the score filled in for her');

reset role;
do $$ begin raise notice 'ALL WATCH TESTS PASSED'; end $$;
