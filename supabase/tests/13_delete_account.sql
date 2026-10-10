\set ON_ERROR_STOP 1
\set as_pat   'reset role; select set_config(''request.jwt.claim.sub'', ''91919191-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_quinn 'reset role; select set_config(''request.jwt.claim.sub'', ''92929292-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_rae   'reset role; select set_config(''request.jwt.claim.sub'', ''93939393-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_auth_server 'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
\set pat   '''91919191-0000-0000-0000-000000000001'''
\set quinn '''92929292-0000-0000-0000-000000000002'''
\set rae   '''93939393-0000-0000-0000-000000000003'''
\set fam  '(select v::uuid from test.vals where k = ''del_fam'')'
\set solo '(select v::uuid from test.vals where k = ''pat_solo'')'
\set a '(select v::uuid from test.vals where k = ''del_a'')'
\set b '(select v::uuid from test.vals where k = ''del_b'')'
\set d '(select v::uuid from test.vals where k = ''del_d'')'

-- Pat owns "Del Fam" (Quinn joined first, then Rae) and is alone in "Pat Solo".
insert into auth.users (id, email, raw_user_meta_data) values
  ('91919191-0000-0000-0000-000000000001', 'pat@x.test',   '{"full_name":"Pat"}'),
  ('92929292-0000-0000-0000-000000000002', 'quinn@x.test', '{"full_name":"Quinn"}'),
  ('93939393-0000-0000-0000-000000000003', 'rae@x.test',   '{"full_name":"Rae"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

:as_pat
select public.create_group('Del Fam');
select public.create_group('Pat Solo');
reset role;
insert into test.vals select 'del_fam', id::text from public.groups where name = 'Del Fam';
insert into test.vals select 'del_code', invite_code from public.groups where name = 'Del Fam';
insert into test.vals select 'pat_solo', id::text from public.groups where name = 'Pat Solo';
:as_quinn
select public.join_group((select v from test.vals where k = 'del_code'));
reset role;
update public.group_members set joined_at = now() - interval '1 hour' where user_id = :quinn;
:as_rae
select public.join_group((select v from test.vals where k = 'del_code'));

reset role;
insert into public.media (tmdb_id, media_type, title) values
  (9501, 'movie', 'Del A'), (9502, 'movie', 'Del B'), (9503, 'movie', 'Del C'), (9504, 'movie', 'Del D');
-- Pat adds A to the family, B to his own list and C to his solo family; Quinn adds D to the family.
:as_pat
insert into public.list_items (group_id, added_by, media_id) select :fam, :pat, id from public.media where tmdb_id = 9501;
insert into public.list_items (group_id, added_by, media_id) select null, :pat, id from public.media where tmdb_id = 9502;
insert into public.list_items (group_id, added_by, media_id) select :solo, :pat, id from public.media where tmdb_id = 9503;
:as_quinn
insert into public.list_items (group_id, added_by, media_id) select :fam, :quinn, id from public.media where tmdb_id = 9504;
reset role;
insert into test.vals select 'del_a', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9501;
insert into test.vals select 'del_b', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9502;
insert into test.vals select 'del_d', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9504;

-- Scores, notes, a reaction and two "watched together" logs, one of them with a score filled in for Pat.
:as_quinn
insert into public.ratings (list_item_id, user_id, score, comment) values (:a, :quinn, 7, 'Quinn liked it');
:as_pat
insert into public.ratings (list_item_id, user_id, score, comment) values (:a, :pat, 9, 'Pat''s private thoughts');
insert into public.reactions (list_item_id, user_id, value) values (:a, :pat, 'dislike')
  on conflict (list_item_id, user_id) do update set value = excluded.value;
select public.log_watch(:a, current_date,
  '[{"user_id":"91919191-0000-0000-0000-000000000001","score":null},{"user_id":"92929292-0000-0000-0000-000000000002","score":null}]'::jsonb);
:as_quinn
select public.log_watch(:d, current_date,
  '[{"user_id":"92929292-0000-0000-0000-000000000002","score":8},{"user_id":"91919191-0000-0000-0000-000000000001","score":6.5}]'::jsonb);

reset role;
select test.expect_eq((select detail from public.activity where group_id = :fam and kind = 'watched_together' and list_item_id = :a), 'Pat, Quinn'::text, 'before: Pat is named in the watched-together log');

-- ---- Pat deletes his account (the auth server deletes the user, which deletes the profile) ----------
:as_auth_server
delete from auth.users where id = :pat;

select test.expect_eq((select count(*) from public.profiles where id = :pat), 0::bigint, 'the profile is gone');
select test.expect_eq((select count(*) from public.groups where id = :solo), 0::bigint, 'a family with nobody else in it is deleted');
select test.expect_eq((select count(*) from public.list_items where media_id = (select id from public.media where tmdb_id = 9503)), 0::bigint, 'and so is its list');
select test.expect_eq((select count(*) from public.groups where id = :fam), 1::bigint, 'the shared family carries on');
select test.expect_eq((select created_by from public.groups where id = :fam), null::uuid, 'it no longer points at Pat as its creator');
select test.expect_eq((select user_id from public.group_members where group_id = :fam and role = 'owner'), :quinn::uuid, 'the longest-standing member becomes the owner');
select test.expect_eq((select count(*) from public.group_members where group_id = :fam), 2::bigint, 'Quinn and Rae are still in it');

select test.expect_eq((select count(*) from public.list_items where id = :a), 1::bigint, 'the title Pat added stays on the family list');
select test.expect_eq((select added_by from public.list_items where id = :a), null::uuid, 'with nobody shown as having added it');
select test.expect_eq((select count(*) from public.list_items where id = :b), 0::bigint, 'Pat''s personal list is gone');
select test.expect_eq((select comment from public.ratings where list_item_id = :a and user_id = :quinn), 'Quinn liked it'::text, 'Quinn''s score and note stay');
select test.expect_eq((select count(*) from public.ratings where user_id = :pat), 0::bigint, 'Pat''s scores and notes are gone');
select test.expect_eq((select count(*) from public.reactions where user_id = :pat), 0::bigint, 'Pat''s reactions are gone');
select test.expect_eq((select count(*) from public.watches where user_id = :pat), 0::bigint, 'Pat''s watch records are gone');
select test.expect_eq((select count(*) from public.watches where list_item_id = :a and user_id = :quinn), 1::bigint, 'Quinn''s watch record stays');
select test.expect_eq((select count(*) from public.rate_limits where user_id = :pat), 0::bigint, 'Pat''s counters are gone');

select test.expect_eq((select count(*) from public.activity where actor_id = :pat or subject_id = :pat), 0::bigint, 'the family history no longer points at Pat');
select test.expect_eq((select count(*) from public.activity where actor_name = 'Pat' or subject_name = 'Pat'), 0::bigint, 'nor names him');
select test.expect_eq((select count(*) from public.activity where detail like '%private thoughts%'), 0::bigint, 'Pat''s notes are gone from the history too');
select test.expect_eq((select detail from public.activity where group_id = :fam and kind = 'watched_together' and list_item_id = :a), 'someone, Quinn'::text, 'watched-together logs say "someone" instead of Pat');
select test.expect_eq((select count(*) from public.activity where group_id = :fam and kind = 'left' and actor_id is null), 1::bigint, 'the feed shows that someone left');
select test.expect_eq((select subject_id from public.activity where group_id = :fam and kind = 'new_owner' order by created_at desc limit 1), :quinn::uuid, 'and that Quinn is now the owner');

:as_quinn
select test.expect_eq((select count(*) from public.list_items where group_id = :fam), 2::bigint, 'Quinn still sees both family titles');

-- ---- Rae (a member, not the owner) deletes hers: she just leaves ------------------------------------
:as_auth_server
delete from auth.users where id = :rae;
select test.expect_eq((select array_agg(user_id) from public.group_members where group_id = :fam), array[:quinn::uuid], 'only Quinn is left');
select test.expect_eq((select user_id from public.group_members where group_id = :fam and role = 'owner'), :quinn::uuid, 'and he is still the owner');

-- ---- The last member deleting their account deletes the family ---------------------------------------
:as_auth_server
delete from auth.users where id = :quinn;
select test.expect_eq((select count(*) from public.groups where id = :fam), 0::bigint, 'the family goes with its last member');
select test.expect_eq((select count(*) from public.activity where group_id = (select v::uuid from test.vals where k = 'del_fam')), 0::bigint, 'with its history');

-- Nobody can delete a profile through the API (only the auth server, via Settings -> Delete account).
insert into auth.users (id, email, raw_user_meta_data) values ('94949494-0000-0000-0000-000000000004', 'sam@x.test', '{"full_name":"Sam"}');
reset role; select set_config('request.jwt.claim.sub', '94949494-0000-0000-0000-000000000004', false); set role authenticated;
select test.expect_error($$delete from public.profiles where id = '94949494-0000-0000-0000-000000000004'$$, 'permission denied');

reset role;
do $$ begin raise notice 'ALL DELETE ACCOUNT TESTS PASSED'; end $$;
