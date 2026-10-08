\set ON_ERROR_STOP 1
\set as_ana    'reset role; select set_config(''request.jwt.claim.sub'', ''aaaaaaaa-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_bogdan 'reset role; select set_config(''request.jwt.claim.sub'', ''bbbbbbbb-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cristi 'reset role; select set_config(''request.jwt.claim.sub'', ''cccccccc-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_dan    'reset role; select set_config(''request.jwt.claim.sub'', ''dddddddd-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_elena  'reset role; select set_config(''request.jwt.claim.sub'', ''eeeeeeee-0000-0000-0000-000000000005'', false); set role authenticated;'
\set as_anon   'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

-- Continues from 01_watched_together.sql: family 1 = Ana (owner), Bogdan, Cristi. Bogdan adds Arrival.
:as_bogdan
reset role; insert into public.media (tmdb_id, media_type, title) values (329865, 'movie', 'Arrival'); set role authenticated;
insert into public.list_items (group_id, added_by, media_id)
  select (select v::uuid from test.vals where k = 'fam1'), 'bbbbbbbb-0000-0000-0000-000000000002', id
  from public.media where tmdb_id = 329865;
reset role;
insert into test.vals select 'arrival', li.id::text from public.list_items li
  join public.media m on m.id = li.media_id where m.tmdb_id = 329865;

-- ---------------------------------------------------------------- activity feed
:as_ana
select test.expect_eq((select count(*) from public.activity where kind = 'created'), 1::bigint, 'feed: family created');
select test.expect_eq((select count(*) from public.activity where kind = 'joined'), 2::bigint, 'feed: Bogdan and Cristi joined');
select test.expect_eq((select actor_name from public.activity where kind = 'added' and media_title = 'Arrival'), 'Bogdan'::text, 'feed: Bogdan added Arrival');
select test.expect_eq((select detail from public.activity where kind = 'watched_together' and media_title = 'Dune' order by created_at limit 1), 'Ana, Bogdan, Cristi'::text, 'feed: watched together, with names');
select test.expect_eq((select count(*) from public.activity where kind = 'watched' and media_title = 'Dune'), 0::bigint, 'feed: no duplicate "marked watched" event when logging');
select test.expect_eq((select score from public.activity where kind = 'rated' and actor_name = 'Ana' and subject_name = 'Cristi'), 7, 'feed: Ana rated Dune 7 for Cristi');
select test.expect_error($$insert into public.activity (group_id, kind) values ((select v::uuid from test.vals where k = 'fam1'), 'added')$$, 'permission denied');
select test.expect_error($$select public.add_activity((select v::uuid from test.vals where k = 'fam1'), 'added')$$, 'permission denied');
:as_dan
select test.expect_eq((select count(*) from public.activity where group_id = (select v::uuid from test.vals where k = 'fam1')), 0::bigint, 'feed: Dan can''t read family 1''s feed');
select test.expect_eq((select count(*) from public.activity), 1::bigint, 'feed: Dan only sees his own family''s events');

-- ---------------------------------------------------------------- undo
:as_ana
select public.log_watch((select v::uuid from test.vals where k = 'arrival'), current_date,
  '[{"user_id":"cccccccc-0000-0000-0000-000000000003","score":null}]'::jsonb);
:as_cristi
select test.expect_eq((select count(*) from public.pending_rating_requests()), 1::bigint, 'Cristi has a request for Arrival');
:as_bogdan
select test.expect_error($$update public.list_items set deleted_at = now(), deleted_by = 'aaaaaaaa-0000-0000-0000-000000000001' where id = (select v::uuid from test.vals where k = 'arrival')$$, 'permission denied');
with u as (update public.list_items set deleted_at = now()
           where id = (select v::uuid from test.vals where k = 'arrival') returning deleted_by)
  select test.expect_eq(min(deleted_by::text), 'bbbbbbbb-0000-0000-0000-000000000002', 'removal is recorded as Bogdan''s (can''t be faked)') from u;
select test.expect_eq((select kind from public.activity where media_title = 'Arrival' order by created_at desc limit 1), 'removed'::text, 'feed: Bogdan removed Arrival');
select test.expect_eq((select count(*) from public.watches where list_item_id = (select v::uuid from test.vals where k = 'arrival')), 1::bigint, 'removed title keeps its watch records');
:as_cristi
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'request hidden while the title is removed');
:as_ana
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'arrival'), current_date,
  '[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","score":null}]'::jsonb)$$, 'not on one of your family lists');
:as_dan
with u as (update public.list_items set deleted_at = null where id = (select v::uuid from test.vals where k = 'arrival') returning 1)
  select test.expect_eq(count(*), 0::bigint, 'Dan can''t restore family 1''s titles') from u;
:as_cristi
with u as (update public.list_items set deleted_at = null where id = (select v::uuid from test.vals where k = 'arrival') returning 1)
  select test.expect_eq(count(*), 1::bigint, 'any member can restore (Undo)') from u;
select test.expect_eq((select deleted_by from public.list_items where id = (select v::uuid from test.vals where k = 'arrival')), null::uuid, 'restored title has no remover');
select test.expect_eq((select count(*) from public.pending_rating_requests()), 1::bigint, 'request is back after Undo');
select test.expect_eq((select actor_name from public.activity where kind = 'restored' and media_title = 'Arrival'), 'Cristi'::text, 'feed: Cristi restored Arrival');

-- ---------------------------------------------------------------- invite codes
:as_elena
select public.create_group('Fam3');
reset role;
select test.expect_eq((select invite_code ~ '^[A-HJ-NP-Z2-9]{8}$' from public.groups where name = 'Fam3'), true, 'new families get 8-character codes');

-- ---------------------------------------------------------------- family settings
:as_bogdan
select test.expect_error($$select public.rename_group((select v::uuid from test.vals where k = 'fam1'), 'Hacked')$$, 'Only the family owner');
select test.expect_error($$select public.regenerate_invite_code((select v::uuid from test.vals where k = 'fam1'))$$, 'Only the family owner');
select test.expect_error($$select public.remove_member((select v::uuid from test.vals where k = 'fam1'), 'cccccccc-0000-0000-0000-000000000003')$$, 'Only the family owner');
:as_ana
select test.expect_error($$select public.rename_group((select v::uuid from test.vals where k = 'fam1'), '   ')$$, 'Please enter a family name');
select public.rename_group((select v::uuid from test.vals where k = 'fam1'), 'Movie Club');
select test.expect_eq((select name from public.groups where id = (select v::uuid from test.vals where k = 'fam1')), 'Movie Club'::text, 'owner renamed the family');
select test.expect_eq((select detail from public.activity where kind = 'renamed'), 'Movie Club'::text, 'feed: renamed');
with u as (update public.groups set name = 'Sneaky' where id = (select v::uuid from test.vals where k = 'fam1') returning 1)
  select test.expect_eq(count(*), 0::bigint, 'families can''t be edited directly, only through the checked functions') from u;
select public.regenerate_invite_code((select v::uuid from test.vals where k = 'fam1'));
select test.expect_eq((select invite_code ~ '^[A-HJ-NP-Z2-9]{8}$' and invite_code <> (select v from test.vals where k = 'fam1_code')
                       from public.groups where id = (select v::uuid from test.vals where k = 'fam1')), true, 'owner made a new 8-character code');
select test.expect_eq((select count(*) from public.activity where kind = 'new_code' and detail is null), 1::bigint, 'feed: new code noted (code itself not shown)');
:as_elena
select test.expect_eq(public.join_group((select v from test.vals where k = 'fam1_code')), null::uuid, 'the replaced code no longer works');

:as_ana
select test.expect_error($$select public.remove_member((select v::uuid from test.vals where k = 'fam1'), 'aaaaaaaa-0000-0000-0000-000000000001')$$, 'Use Leave family');
select test.expect_error($$select public.remove_member((select v::uuid from test.vals where k = 'fam1'), 'dddddddd-0000-0000-0000-000000000004')$$, 'not in this family');
:as_cristi
with d as (delete from public.group_members where user_id = 'cccccccc-0000-0000-0000-000000000003' returning 1)
  select test.expect_eq(count(*), 0::bigint, 'memberships can''t be deleted directly') from d;
:as_ana
select public.remove_member((select v::uuid from test.vals where k = 'fam1'), 'cccccccc-0000-0000-0000-000000000003');
select test.expect_eq((select subject_name from public.activity where kind = 'removed_member'), 'Cristi'::text, 'feed: Ana removed Cristi');
:as_cristi
select test.expect_eq((select count(*) from public.groups where id = (select v::uuid from test.vals where k = 'fam1')), 0::bigint, 'removed member can''t see the family');
select test.expect_eq((select count(*) from public.pending_rating_requests()), 0::bigint, 'removed member''s requests are gone');

:as_ana
select public.leave_group((select v::uuid from test.vals where k = 'fam1'));
:as_bogdan
select test.expect_eq((select role from public.group_members where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                       and group_id = (select v::uuid from test.vals where k = 'fam1')), 'owner'::text, 'owner left: Bogdan took over');
select test.expect_eq((select actor_name from public.activity where kind = 'left'), 'Ana'::text, 'feed: Ana left');
select test.expect_eq((select subject_name from public.activity where kind = 'new_owner'), 'Bogdan'::text, 'feed: Bogdan is the new owner');
:as_ana
select test.expect_error($$select public.rename_group((select v::uuid from test.vals where k = 'fam1'), 'Back door')$$, 'Only the family owner');
select test.expect_error($$select public.leave_group((select v::uuid from test.vals where k = 'fam1'))$$, 'You are not in this family');
with d as (delete from public.groups where id = (select v::uuid from test.vals where k = 'fam1') returning 1)
  select test.expect_eq(count(*), 0::bigint, 'the original creator can''t delete the family after leaving') from d;
:as_bogdan
select public.leave_group((select v::uuid from test.vals where k = 'fam1'));
reset role;
select test.expect_eq((select count(*) from public.groups where id = (select v::uuid from test.vals where k = 'fam1')), 0::bigint, 'last one out: family deleted');
select test.expect_eq((select count(*) from public.list_items where group_id = (select v::uuid from test.vals where k = 'fam1')), 0::bigint, 'its list went with it');
select test.expect_eq((select count(*) from public.activity where group_id = (select v::uuid from test.vals where k = 'fam1')), 0::bigint, 'and so did its feed');

-- ---------------------------------------------------------------- signed out
:as_anon
select test.expect_error($$select public.leave_group('00000000-0000-0000-0000-000000000000')$$, 'permission denied');
select test.expect_error($$select public.rename_group('00000000-0000-0000-0000-000000000000', 'x')$$, 'permission denied');
select test.expect_eq((select count(*) from public.activity), 0::bigint, 'signed-out visitors see no activity');

select 'FAMILY TOOLS: ALL PASSED' as result;
