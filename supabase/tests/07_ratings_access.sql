\set ON_ERROR_STOP 1
\set as_sam  'reset role; select set_config(''request.jwt.claim.sub'', ''51515151-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_tess 'reset role; select set_config(''request.jwt.claim.sub'', ''52525252-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_uri  'reset role; select set_config(''request.jwt.claim.sub'', ''53535353-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_vera 'reset role; select set_config(''request.jwt.claim.sub'', ''54545454-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_walt 'reset role; select set_config(''request.jwt.claim.sub'', ''55555555-0000-0000-0000-000000000005'', false); set role authenticated;'

-- People: Sam (owner), Tess and Uri = SecFam. Vera = nobody. Walt = owner of OtherFam.
insert into auth.users (id, email, raw_user_meta_data) values
  ('51515151-0000-0000-0000-000000000001', 'sam@x.test',  '{"full_name":"Sam"}'),
  ('52525252-0000-0000-0000-000000000002', 'tess@x.test', '{"full_name":"Tess"}'),
  ('53535353-0000-0000-0000-000000000003', 'uri@x.test',  '{"full_name":"Uri"}'),
  ('54545454-0000-0000-0000-000000000004', 'vera@x.test', '{"full_name":"Vera"}'),
  ('55555555-0000-0000-0000-000000000005', 'walt@x.test', '{"full_name":"Walt"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

:as_sam
select public.create_group('SecFam');
:as_walt
select public.create_group('OtherFam');
reset role;
insert into test.vals select 'sec_fam', id::text from public.groups where name = 'SecFam';
insert into test.vals select 'sec_fam_code', invite_code from public.groups where name = 'SecFam';
:as_tess
select public.join_group((select v from test.vals where k = 'sec_fam_code'));
:as_uri
select public.join_group((select v from test.vals where k = 'sec_fam_code'));

-- The server saves movie info; here the table owner stands in for it.
reset role;
insert into public.media (tmdb_id, media_type, title)
  values (9001, 'movie', 'Sec A'), (9002, 'movie', 'Sec B'), (9003, 'movie', 'Sec C'), (9004, 'movie', 'Sec D');

-- Sam: A and D on the family list, B on his own list. Walt: C on the other family's list.
:as_sam
insert into public.list_items (group_id, added_by, media_id)
  select (select v::uuid from test.vals where k = 'sec_fam'), '51515151-0000-0000-0000-000000000001', id from public.media where tmdb_id in (9001, 9004);
insert into public.list_items (group_id, added_by, media_id)
  select null, '51515151-0000-0000-0000-000000000001', id from public.media where tmdb_id = 9002;
:as_walt
insert into public.list_items (group_id, added_by, media_id)
  select (select id from public.groups where name = 'OtherFam'), '55555555-0000-0000-0000-000000000005', id from public.media where tmdb_id = 9003;
reset role;
insert into test.vals select 'sec_a', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9001;
insert into test.vals select 'sec_d', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9004;
insert into test.vals select 'sec_b', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9002;
insert into test.vals select 'sec_c', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9003;

-- ---- Members and owners can still rate and react ---------------------------------------------
:as_tess
insert into public.ratings (list_item_id, user_id, score, comment) values ((select v::uuid from test.vals where k = 'sec_a'), '52525252-0000-0000-0000-000000000002', 7.5, 'fine');
select test.expect_eq((select score from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'sec_a') and user_id = '52525252-0000-0000-0000-000000000002'), 7.5::numeric, 'a member can rate a family title');
update public.ratings set score = 8.0 where list_item_id = (select v::uuid from test.vals where k = 'sec_a') and user_id = '52525252-0000-0000-0000-000000000002';
select test.expect_eq((select score from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'sec_a') and user_id = '52525252-0000-0000-0000-000000000002'), 8.0::numeric, 'a member can change their own score');
insert into public.reactions (list_item_id, user_id, value) values ((select v::uuid from test.vals where k = 'sec_d'), '52525252-0000-0000-0000-000000000002', 'dislike');
update public.reactions set value = 'like' where list_item_id = (select v::uuid from test.vals where k = 'sec_d') and user_id = '52525252-0000-0000-0000-000000000002';
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'sec_d') and user_id = '52525252-0000-0000-0000-000000000002'), 'like'::text, 'a member can react and change the reaction');
:as_sam
insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_b'), '51515151-0000-0000-0000-000000000001', 6.0);
insert into public.reactions (list_item_id, user_id, value) values ((select v::uuid from test.vals where k = 'sec_b'), '51515151-0000-0000-0000-000000000001', 'like');
select test.expect_eq((select count(*) from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'sec_b')), 1::bigint, 'you can rate and react to a title on your own list');

-- The app saves scores and reactions with "insert ... on conflict do update": first time and then again
:as_tess
insert into public.ratings (list_item_id, user_id, score, comment) values ((select v::uuid from test.vals where k = 'sec_d'), '52525252-0000-0000-0000-000000000002', 6.5, 'first')
  on conflict (list_item_id, user_id) do update set score = excluded.score, comment = excluded.comment;
insert into public.ratings (list_item_id, user_id, score, comment) values ((select v::uuid from test.vals where k = 'sec_d'), '52525252-0000-0000-0000-000000000002', 6.8, 'second')
  on conflict (list_item_id, user_id) do update set score = excluded.score, comment = excluded.comment;
select test.expect_eq((select comment from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'sec_d') and user_id = '52525252-0000-0000-0000-000000000002'), 'second'::text, 'saving a score twice (upsert) works for a member');
insert into public.reactions (list_item_id, user_id, value) values ((select v::uuid from test.vals where k = 'sec_d'), '52525252-0000-0000-0000-000000000002', 'dislike')
  on conflict (list_item_id, user_id) do update set value = excluded.value;
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'sec_d') and user_id = '52525252-0000-0000-0000-000000000002'), 'dislike'::text, 'changing a reaction (upsert) works for a member');
-- a high score also sets the reaction through the trigger, as the signed-in member
insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_d'), '52525252-0000-0000-0000-000000000002', 9.0)
  on conflict (list_item_id, user_id) do update set score = excluded.score;
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'sec_d') and user_id = '52525252-0000-0000-0000-000000000002'), 'like'::text, 'a score over 7 still turns into a like for a member');

-- ---- People outside the family can't touch its titles ----------------------------------------
:as_vera
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_a'), '54545454-0000-0000-0000-000000000004', 6.5)$$, 'row-level security');
select test.expect_error($$insert into public.ratings (list_item_id, user_id, comment) values ((select v::uuid from test.vals where k = 'sec_a'), '54545454-0000-0000-0000-000000000004', 'visit my site')$$, 'row-level security');
-- a high score is refused either way: it makes a reaction, which the family-only read rule stops
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_a'), '54545454-0000-0000-0000-000000000004', 9)$$, 'row-level security');
select test.expect_error($$insert into public.reactions (list_item_id, user_id, value) values ((select v::uuid from test.vals where k = 'sec_a'), '54545454-0000-0000-0000-000000000004', 'dislike')$$, 'row-level security');
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_b'), '54545454-0000-0000-0000-000000000004', 6.5)$$, 'row-level security');
select test.expect_error($$insert into public.reactions (list_item_id, user_id, value) values ((select v::uuid from test.vals where k = 'sec_b'), '54545454-0000-0000-0000-000000000004', 'like')$$, 'row-level security');

-- A member can't use another family's title or someone else's personal list
:as_tess
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_c'), '52525252-0000-0000-0000-000000000002', 6.5)$$, 'row-level security');
select test.expect_error($$insert into public.reactions (list_item_id, user_id, value) values ((select v::uuid from test.vals where k = 'sec_c'), '52525252-0000-0000-0000-000000000002', 'dislike')$$, 'row-level security');
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_b'), '52525252-0000-0000-0000-000000000002', 6.5)$$, 'row-level security');
-- and can't move her own rating or reaction onto one
select test.expect_error($$update public.ratings set list_item_id = (select v::uuid from test.vals where k = 'sec_c') where list_item_id = (select v::uuid from test.vals where k = 'sec_a') and user_id = '52525252-0000-0000-0000-000000000002'$$, 'row-level security');
select test.expect_error($$update public.reactions set list_item_id = (select v::uuid from test.vals where k = 'sec_c') where list_item_id = (select v::uuid from test.vals where k = 'sec_d') and user_id = '52525252-0000-0000-0000-000000000002'$$, 'row-level security');
-- nobody scores for somebody else (this already held)
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score) values ((select v::uuid from test.vals where k = 'sec_a'), '51515151-0000-0000-0000-000000000001', 6.5)$$, 'row-level security');

-- ---- Someone who left the family can't keep posting on its titles ----------------------------
:as_uri
insert into public.ratings (list_item_id, user_id, score, comment) values ((select v::uuid from test.vals where k = 'sec_a'), '53535353-0000-0000-0000-000000000003', 6.5, 'while I was a member');
select public.leave_group((select v::uuid from test.vals where k = 'sec_fam'));
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score, comment) values ((select v::uuid from test.vals where k = 'sec_d'), '53535353-0000-0000-0000-000000000003', 6.5, 'spam')$$, 'row-level security');
select test.expect_error($$insert into public.reactions (list_item_id, user_id, value) values ((select v::uuid from test.vals where k = 'sec_d'), '53535353-0000-0000-0000-000000000003', 'dislike')$$, 'row-level security');
-- the "upsert" path used by the app
select test.expect_error($$insert into public.ratings (list_item_id, user_id, score, comment) values ((select v::uuid from test.vals where k = 'sec_a'), '53535353-0000-0000-0000-000000000003', 6.5, 'spam') on conflict (list_item_id, user_id) do update set comment = excluded.comment$$, 'row-level security');
with u as (update public.ratings set comment = 'spam' where list_item_id = (select v::uuid from test.vals where k = 'sec_a') and user_id = '53535353-0000-0000-0000-000000000003' returning 1)
  select test.expect_eq(count(*), 0::bigint, 'a former member can''t edit their old comment') from u;
reset role;
select test.expect_eq((select comment from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'sec_a') and user_id = '53535353-0000-0000-0000-000000000003'), 'while I was a member'::text, 'the old comment is untouched');

-- ---- Watch records were already locked down by column privileges -----------------------------
:as_tess
select test.expect_error($$update public.watches set list_item_id = (select v::uuid from test.vals where k = 'sec_c') where user_id = '52525252-0000-0000-0000-000000000002'$$, 'permission denied');

reset role;
do $$ begin raise notice 'ALL SECURITY (RATINGS) TESTS PASSED'; end $$;
