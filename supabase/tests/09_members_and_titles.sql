\set ON_ERROR_STOP 1
\set as_ann  'reset role; select set_config(''request.jwt.claim.sub'', ''61616161-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_ben  'reset role; select set_config(''request.jwt.claim.sub'', ''62626262-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cara 'reset role; select set_config(''request.jwt.claim.sub'', ''63636363-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_zed  'reset role; select set_config(''request.jwt.claim.sub'', ''64646464-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

-- Ann owns MemFam with Ben and Cara. Zed is in no family.
insert into auth.users (id, email, raw_user_meta_data) values
  ('61616161-0000-0000-0000-000000000001', 'ann@x.test',  '{"full_name":"Ann"}'),
  ('62626262-0000-0000-0000-000000000002', 'ben@x.test',  '{"full_name":"Ben"}'),
  ('63636363-0000-0000-0000-000000000003', 'cara@x.test', '{"full_name":"Cara"}'),
  ('64646464-0000-0000-0000-000000000004', 'zed@x.test',  '{"full_name":"Zed"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

:as_ann
select public.create_group('MemFam');
reset role;
insert into test.vals select 'mem_fam', id::text from public.groups where name = 'MemFam';
insert into test.vals select 'mem_code', invite_code from public.groups where name = 'MemFam';
:as_ben
select public.join_group((select v from test.vals where k = 'mem_code'));
:as_cara
select public.join_group((select v from test.vals where k = 'mem_code'));
reset role;
insert into public.media (tmdb_id, media_type, title) values (9201, 'movie', 'Mem A'), (9202, 'movie', 'Mem B');
:as_ann
insert into public.list_items (group_id, added_by, media_id, status)
  select (select v::uuid from test.vals where k = 'mem_fam'), '61616161-0000-0000-0000-000000000001', id, 'want' from public.media where tmdb_id = 9201;
reset role;
insert into test.vals select 'mem_item', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9201;

-- ---- membership helpers only answer about your own families -----------------------------------
:as_zed
select test.expect_eq(public.is_group_member((select v::uuid from test.vals where k = 'mem_fam'), '62626262-0000-0000-0000-000000000002'), false, 'a stranger can''t check who is in a family');
select test.expect_eq(public.shares_group('61616161-0000-0000-0000-000000000001', '62626262-0000-0000-0000-000000000002'), false, 'a stranger can''t check who shares a family');
:as_anon
select test.expect_error($$select public.is_group_member((select v::uuid from test.vals where k = 'mem_fam'), '62626262-0000-0000-0000-000000000002')$$, 'permission denied');
select test.expect_error($$select public.shares_group('61616161-0000-0000-0000-000000000001', '62626262-0000-0000-0000-000000000002')$$, 'permission denied');
:as_ben
select test.expect_eq(public.is_group_member((select v::uuid from test.vals where k = 'mem_fam'), '63636363-0000-0000-0000-000000000003'), true, 'a member can still check the members of their own family');
select test.expect_eq(public.shares_group('62626262-0000-0000-0000-000000000002', '61616161-0000-0000-0000-000000000001'), true, 'you can still check whether you share a family with someone');
select test.expect_eq((select count(*) from public.profiles where id in ('61616161-0000-0000-0000-000000000001', '63636363-0000-0000-0000-000000000003')), 2::bigint, 'members still see each other''s names');
select test.expect_eq((select count(*) from public.list_items where id = (select v::uuid from test.vals where k = 'mem_item')), 1::bigint, 'members still see the family list');

-- ---- list items: the list, movie and author stay fixed --------------------------------------------
select test.expect_error($$update public.list_items set group_id = null where id = (select v::uuid from test.vals where k = 'mem_item')$$, 'permission denied');
select test.expect_error($$update public.list_items set media_id = (select id from public.media where tmdb_id = 9202) where id = (select v::uuid from test.vals where k = 'mem_item')$$, 'permission denied');
select test.expect_error($$update public.list_items set added_by = '63636363-0000-0000-0000-000000000003' where id = (select v::uuid from test.vals where k = 'mem_item')$$, 'permission denied');
select test.expect_error($$insert into public.list_items (group_id, added_by, media_id, status, deleted_at, deleted_by)
  values ((select v::uuid from test.vals where k = 'mem_fam'), '62626262-0000-0000-0000-000000000002', (select id from public.media where tmdb_id = 9202), 'want', now(), '61616161-0000-0000-0000-000000000001')$$, 'permission denied');
-- what the app does still works: add, mark watched, remove, restore
insert into public.list_items (group_id, added_by, media_id, status)
  values ((select v::uuid from test.vals where k = 'mem_fam'), '62626262-0000-0000-0000-000000000002', (select id from public.media where tmdb_id = 9202), 'want');
update public.list_items set status = 'watched', watched_at = now() where id = (select v::uuid from test.vals where k = 'mem_item');
select test.expect_eq((select status from public.list_items where id = (select v::uuid from test.vals where k = 'mem_item')), 'watched'::text, 'a member can still mark a title watched');
update public.list_items set deleted_at = '2000-01-01' where id = (select v::uuid from test.vals where k = 'mem_item');
reset role;
select test.expect_eq((select deleted_at > now() - interval '1 minute' from public.list_items where id = (select v::uuid from test.vals where k = 'mem_item')), true, 'a removal is stamped with the real time (no backdating)');
select test.expect_eq((select deleted_by from public.list_items where id = (select v::uuid from test.vals where k = 'mem_item')), '62626262-0000-0000-0000-000000000002'::uuid, 'the database records who removed it');
:as_ben
select test.expect_error($$update public.list_items set deleted_by = '61616161-0000-0000-0000-000000000001' where id = (select v::uuid from test.vals where k = 'mem_item')$$, 'permission denied');
:as_cara
update public.list_items set deleted_at = null where id = (select v::uuid from test.vals where k = 'mem_item');
reset role;
select test.expect_eq((select deleted_at is null and deleted_by is null from public.list_items where id = (select v::uuid from test.vals where k = 'mem_item')), true, 'a member can restore a removed title');

-- ---- removing a member changes the code -----------------------------------------------------------
:as_cara
select test.expect_eq((select count(*) from public.groups where id = (select v::uuid from test.vals where k = 'mem_fam')), 1::bigint, 'as a member Cara can read the invite code');
reset role;
insert into test.vals select 'cara_saw', invite_code from public.groups where id = (select v::uuid from test.vals where k = 'mem_fam');
:as_ann
select public.remove_member((select v::uuid from test.vals where k = 'mem_fam'), '63636363-0000-0000-0000-000000000003');
:as_cara
select test.expect_eq(public.join_group((select v from test.vals where k = 'cara_saw')), null::uuid, 'the removed member can''t rejoin with the code she saved');
select test.expect_eq(public.is_group_member((select v::uuid from test.vals where k = 'mem_fam'), '63636363-0000-0000-0000-000000000003'), false, 'the removed member is out');
select test.expect_eq((select count(*) from public.groups where id = (select v::uuid from test.vals where k = 'mem_fam')), 0::bigint, 'the removed member can''t read the new code');
:as_ben
select test.expect_eq((select invite_code <> (select v from test.vals where k = 'cara_saw') from public.groups where id = (select v::uuid from test.vals where k = 'mem_fam')), true, 'the remaining members see the new code');
select test.expect_eq((select invite_code_expires_at > now() + interval '23 hours 59 minutes' from public.groups where id = (select v::uuid from test.vals where k = 'mem_fam')), true, 'the new code lasts 24 hours');
:as_cara
select test.expect_eq(public.join_group((select invite_code from public.groups where id = (select v::uuid from test.vals where k = 'mem_fam'))), null::uuid, 'the removed member can''t read the new code to rejoin');
reset role;
select test.expect_eq((select count(*) from public.group_members where user_id = '63636363-0000-0000-0000-000000000003'), 0::bigint, 'still out until someone shares the new code');

-- The common family lock must precede admission, permission checks and membership changes.
select test.expect_eq((select position('for no key update' in prosrc) > 0
    and position('for no key update' in prosrc) < position('insert into public.group_members' in prosrc)
  from pg_proc where oid = 'public.join_group(text)'::regprocedure),
  true, 'joining locks and revalidates the invite before adding a member');
select test.expect_eq((select bool_and(position('for no key update' in prosrc) > 0
    and position('for no key update' in prosrc) < position('if not public.is_group_owner' in prosrc))
  from pg_proc where oid in ('public.rename_group(uuid,text)'::regprocedure,
    'public.regenerate_invite_code(uuid)'::regprocedure, 'public.remove_member(uuid,uuid)'::regprocedure)),
  true, 'owner operations lock the family before checking ownership');
select test.expect_eq((select position('for no key update' in prosrc) > 0
    and position('for no key update' in prosrc) < position('select role into v_role' in prosrc)
  from pg_proc where oid = 'public.leave_group(uuid)'::regprocedure),
  true, 'leaving takes the same family lock before membership changes');

reset role;
do $$ begin raise notice 'ALL SECURITY (MEMBERS) TESTS PASSED'; end $$;
