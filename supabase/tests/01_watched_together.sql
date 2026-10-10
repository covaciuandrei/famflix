\set ON_ERROR_STOP 1
\set as_ana    'reset role; select set_config(''request.jwt.claim.sub'', ''aaaaaaaa-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_bogdan 'reset role; select set_config(''request.jwt.claim.sub'', ''bbbbbbbb-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cristi 'reset role; select set_config(''request.jwt.claim.sub'', ''cccccccc-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_dan    'reset role; select set_config(''request.jwt.claim.sub'', ''dddddddd-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_elena  'reset role; select set_config(''request.jwt.claim.sub'', ''eeeeeeee-0000-0000-0000-000000000005'', false); set role authenticated;'
\set as_anon   'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

-- People: Ana, Bogdan, Cristi = family 1. Dan = family 2. Elena = no family.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ana@x.test',    '{"full_name":"Ana"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bogdan@x.test', '{"full_name":"Bogdan"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'cristi@x.test', '{"full_name":"Cristi"}'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@x.test',    '{"full_name":"Dan"}'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'elena@x.test',  '{"full_name":"Elena"}');

create table test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

:as_ana
select public.create_group('Fam1');
:as_dan
select public.create_group('Fam2');
reset role;
insert into test.vals select 'fam1', id::text from public.groups where name = 'Fam1';
insert into test.vals select 'fam1_code', invite_code from public.groups where name = 'Fam1';

:as_bogdan
select public.join_group((select v from test.vals where k = 'fam1_code'));
:as_cristi
select public.join_group((select v from test.vals where k = 'fam1_code'));

-- Existing flows still work after removing the self-join rule.
:as_ana
select test.expect_eq((select count(*) from public.group_members where group_id = (select v::uuid from test.vals where k = 'fam1')), 3::bigint, 'create + join with code still work (3 members)');

-- Security fix: Elena can't add herself to family 1 without the code.
:as_elena
select test.expect_error($$insert into public.group_members (group_id, user_id, role)
  values ((select v::uuid from test.vals where k = 'fam1'), 'eeeeeeee-0000-0000-0000-000000000005', 'owner')$$,
  'permission denied');

-- Ana adds Dune to the family list, plus one title to her own list.
:as_ana
reset role; insert into public.media (tmdb_id, media_type, title) values (438631, 'movie', 'Dune'), (1, 'movie', 'Ana private pick'); set role authenticated;
insert into public.list_items (group_id, added_by, media_id)
  select (select v::uuid from test.vals where k = 'fam1'), 'aaaaaaaa-0000-0000-0000-000000000001', id from public.media where tmdb_id = 438631;
insert into public.list_items (group_id, added_by, media_id)
  select null, 'aaaaaaaa-0000-0000-0000-000000000001', id from public.media where tmdb_id = 1;
reset role;
insert into test.vals select 'item', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 438631;
insert into test.vals select 'personal_item', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 1;

-- Bogdan already gave Dune a 5 himself.
:as_bogdan
insert into public.ratings (list_item_id, user_id, score)
  values ((select v::uuid from test.vals where k = 'item'), 'bbbbbbbb-0000-0000-0000-000000000002', 5);

-- Ana logs: Ana 8, Bogdan 9, Cristi no score.
:as_ana
select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date,
  '[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","score":8},
    {"user_id":"bbbbbbbb-0000-0000-0000-000000000002","score":9},
    {"user_id":"cccccccc-0000-0000-0000-000000000003","score":null}]'::jsonb);

select test.expect_eq((select status from public.list_items where id = (select v::uuid from test.vals where k = 'item')), 'watched'::text, 'title moved to Watched');
select test.expect_eq((select count(*) from public.watches where list_item_id = (select v::uuid from test.vals where k = 'item')), 3::bigint, '3 people marked as having seen it');
select test.expect_eq((select score from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 8, 'Ana score saved');
select test.expect_eq((select score from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 5, 'Bogdan''s own 5 is NOT overwritten by the 9');
select test.expect_eq((select rated_by from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'Bogdan''s rating still counts as his own');
select test.expect_eq((select count(*) from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'cccccccc-0000-0000-0000-000000000003'), 0::bigint, 'Cristi has no score yet');

-- Requests: only Cristi owes a rating.
:as_cristi
select test.expect_eq((select count(*) from public.pending_rating_requests()), 1::bigint, 'Cristi gets 1 rating request');
select test.expect_eq((select logged_by_name from public.pending_rating_requests()), 'Ana'::text, 'request says Ana logged it');
select test.expect_eq((select title from public.pending_rating_requests()), 'Dune'::text, 'request is for Dune');
:as_bogdan
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'Bogdan already rated: no request');
:as_dan
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'Dan (other family) gets nothing');

-- Refusals.
:as_ana
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date,
  '[{"user_id":"dddddddd-0000-0000-0000-000000000004","score":null}]'::jsonb)$$, 'Only members of this family');
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date,
  '[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","score":null},{"user_id":"eeeeeeee-0000-0000-0000-000000000005","score":7}]'::jsonb)$$, 'Only members of this family');
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'personal_item'), current_date,
  '[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","score":null}]'::jsonb)$$, 'not on one of your family lists');
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date + 5,
  '[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","score":null}]'::jsonb)$$, 'future');
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date,
  '[{"user_id":"cccccccc-0000-0000-0000-000000000003","score":11}]'::jsonb)$$, 'between 1 and 10');
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date, '[]'::jsonb)$$, 'at least one person');
select test.expect_error($$insert into public.watches (list_item_id, user_id)
  values ((select v::uuid from test.vals where k = 'item'), 'dddddddd-0000-0000-0000-000000000004')$$, 'permission denied');
select test.expect_eq((select count(*) from public.watches where user_id = 'eeeeeeee-0000-0000-0000-000000000005'), 0::bigint, 'refused call left nothing behind');
:as_dan
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date,
  '[{"user_id":"dddddddd-0000-0000-0000-000000000004","score":null}]'::jsonb)$$, 'not on one of your family lists');
select test.expect_eq((select count(*) from public.watches), 0::bigint, 'Dan can''t see family 1''s watch records');
:as_elena
select test.expect_eq((select count(*) from public.watches), 0::bigint, 'Elena can''t see family 1''s watch records');

-- People can only skip or remove themselves, and can't change anything else.
:as_cristi
select test.expect_error($$update public.watches set watched_on = current_date - 30
  where user_id = 'cccccccc-0000-0000-0000-000000000003'$$, 'permission denied');
with u as (update public.watches set skipped_at = now() where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
  select test.expect_eq(count(*), 0::bigint, 'Cristi can''t skip for Bogdan') from u;
with u as (update public.watches set skipped_at = now() where user_id = 'cccccccc-0000-0000-0000-000000000003' returning 1)
  select test.expect_eq(count(*), 1::bigint, 'Cristi can skip his own request') from u;
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'skipped request is gone');
:as_bogdan
with d as (delete from public.watches where user_id = 'cccccccc-0000-0000-0000-000000000003' returning 1)
  select test.expect_eq(count(*), 0::bigint, 'Bogdan can''t remove Cristi') from d;
with d as (delete from public.watches where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' returning 1)
  select test.expect_eq(count(*), 1::bigint, 'Bogdan can remove himself (I wasn''t there)') from d;

-- Later, Ana fills in Cristi's score; an older date doesn't move his date back.
:as_ana
select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date - 2,
  '[{"user_id":"cccccccc-0000-0000-0000-000000000003","score":7}]'::jsonb);
select test.expect_eq((select score from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'cccccccc-0000-0000-0000-000000000003'), 7, 'Ana filled in Cristi''s score');
select test.expect_eq((select rated_by from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'cccccccc-0000-0000-0000-000000000003'), 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'marked as filled in by Ana');
select test.expect_eq((select watched_on from public.watches where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'cccccccc-0000-0000-0000-000000000003'), current_date, 'older date keeps the latest watch date');

-- Cristi fixes it; "filled in by" can't be faked.
:as_cristi
update public.ratings set score = 4, rated_by = 'aaaaaaaa-0000-0000-0000-000000000001'
  where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'cccccccc-0000-0000-0000-000000000003';
select test.expect_eq((select score from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'cccccccc-0000-0000-0000-000000000003'), 4, 'Cristi changed his score');
select test.expect_eq((select rated_by from public.ratings where list_item_id = (select v::uuid from test.vals where k = 'item') and user_id = 'cccccccc-0000-0000-0000-000000000003'), 'cccccccc-0000-0000-0000-000000000003'::uuid, 'after editing it counts as his own (rated_by can''t be faked)');

-- Signed-out visitors can't use either function.
:as_anon
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'item'), current_date,
  '[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","score":null}]'::jsonb)$$, 'permission denied');
select test.expect_error($$select * from public.pending_rating_requests()$$, 'permission denied');

-- Titles are only hidden on removal (undo), never hard-deleted.
:as_ana
select test.expect_error($$delete from public.list_items where id = (select v::uuid from test.vals where k = 'item')$$, 'permission denied');

select 'WATCHED TOGETHER: ALL PASSED' as result;
