\set ON_ERROR_STOP 1
\set ana '''a736ca00-0000-4000-8000-000000000001'''
\set ben '''a736ca00-0000-4000-8000-000000000002'''
\set daria '''a736ca00-0000-4000-8000-000000000003'''
\set outsider '''a736ca00-0000-4000-8000-000000000004'''
\set as_ana 'reset role; select set_config(''request.jwt.claim.sub'', ''a736ca00-0000-4000-8000-000000000001'', false); set role authenticated;'
\set as_ben 'reset role; select set_config(''request.jwt.claim.sub'', ''a736ca00-0000-4000-8000-000000000002'', false); set role authenticated;'
\set as_daria 'reset role; select set_config(''request.jwt.claim.sub'', ''a736ca00-0000-4000-8000-000000000003'', false); set role authenticated;'
\set as_outsider 'reset role; select set_config(''request.jwt.claim.sub'', ''a736ca00-0000-4000-8000-000000000004'', false); set role authenticated;'
reset role;
begin;
insert into auth.users(id, email, raw_user_meta_data) values
  (:ana, 'a36@x.test', '{"full_name":"Attendance Ana"}'), (:ben, 'b36@x.test', '{"full_name":"Attendance Ben"}'),
  (:daria, 'd36@x.test', '{"full_name":"Daria"}'), (:outsider, 'o36@x.test', '{"full_name":"Outsider"}');
:as_ana
select (public.create_group('Attendance family')).id as family \gset
reset role;
insert into public.group_members(group_id, user_id) values(:'family', :ben);
insert into public.media(tmdb_id, media_type, title) values(7936, 'movie', 'Attendance movie'), (7937, 'movie', 'Another attendance movie');
insert into public.list_items(group_id, added_by, media_id)
  select :'family', :ana, id from public.media where tmdb_id = 7936 returning id as item \gset
insert into public.list_items(group_id, added_by, media_id)
  select :'family', :ana, id from public.media where tmdb_id = 7937 returning id as item2 \gset
:as_ana
select public.save_family_guest(:'family', ' Daria ') as guest \gset
select test.expect_error(format('select public.save_family_guest(%L, %L)', :'family', 'daria'), 'already uses');
select public.save_family_watch(:'item', null,
  jsonb_build_array(jsonb_build_object('user_id', :ana, 'score', 8.5), jsonb_build_object('user_id', :ben, 'score', null)),
  jsonb_build_array(jsonb_build_object('guest_id', :'guest', 'score', 9.5))) ->> 'viewing_id' as first_view \gset
select test.expect_eq((select count(*) from public.watches where list_item_id = :'item' and watched_on is null), 2::bigint, 'family unknown date is null for both attendees');
select test.expect_eq((select count(*) from public.family_viewing_members where viewing_id = :'first_view'), 2::bigint, 'the undated viewing has two members but one identity');
select test.expect_eq((select happened_on from public.movie_nights where viewing_id = :'first_view'), null::date, 'a logged night keeps an unknown date');
select test.expect_eq((select watched_at from public.list_items where group_id is null and added_by = :ana), null::timestamptz, 'personal copy does not invent today');
select test.expect_eq((select score from public.guest_ratings where guest_id = :'guest'), 9.5::numeric, 'guest movie score is saved');
select public.save_family_watch(:'item', current_date - 1,
  jsonb_build_array(jsonb_build_object('user_id', :ana)), jsonb_build_array(jsonb_build_object('guest_id', :'guest')), true)
  ->> 'viewing_id' as second_view \gset
select test.expect_eq((select count(*) from public.family_viewings where list_item_id = :'item'), 2::bigint, 'rewatching creates a separate viewing identity');
select test.expect_eq((select count(*) from public.watch_history where viewing_id = :'first_view'), 2::bigint, 'archiving keeps both undated member records');
select test.expect_error(format('select public.delete_movie_night(%L, true)',
  (select id from public.movie_nights where viewing_id = :'first_view')), 'earlier viewing');
select public.edit_family_viewing(:'first_view', current_date - 5, array[:ana::uuid, :ben::uuid], array[:'guest'::uuid], 1);
select test.expect_eq((select watched_on from public.family_viewings where id = :'second_view'), current_date - 1, 'editing old date leaves later viewing untouched');
select test.expect_eq((select watched_at::date from public.list_items where group_id is null and added_by = :ana), current_date - 1, 'old date does not replace current personal date');
select public.edit_family_viewing(:'first_view', current_date, array[:ana::uuid, :ben::uuid], array[:'guest'::uuid], 2);
select test.expect_eq((select watched_on from public.family_viewings where id = :'first_view'), current_date, 'old date may cross the later viewing without a blocking chronology restriction');
select test.expect_error(format('select public.edit_family_viewing(%L, null, array[%L::uuid], array[]::uuid[], 1)', :'first_view', :ana), 'Someone changed');
savepoint capacity_check;
select array_agg(id) as boundary_ids from (select public.save_family_guest(:'family', 'Boundary guest ' || n) id from generate_series(1, 10) n) guests \gset
select public.edit_family_viewing(:'first_view', current_date, array[:ana::uuid, :ben::uuid],
  array[:'guest'::uuid] || (:'boundary_ids'::uuid[])[1:9], 3);
select test.expect_eq((select count(*) from public.family_viewing_guests where viewing_id = :'first_view'), 10::bigint, 'exactly ten guest attendees are accepted');
select test.expect_error(format('select public.edit_family_viewing(%L, current_date, %L::uuid[], %L::uuid[], 4)',
  :'first_view', array[:ana::uuid, :ben::uuid], array[:'guest'::uuid] || :'boundary_ids'::uuid[]), 'at most 10');
rollback to capacity_check;
release capacity_check;
select public.save_family_watch(:'item2', null, jsonb_build_array(jsonb_build_object('user_id', :ana)),
  jsonb_build_array(jsonb_build_object('guest_id', :'guest', 'score', 7))) ->> 'viewing_id' as other_view \gset
select test.expect_eq((select count(*) from public.family_guests where group_id = :'family'), 1::bigint, 'two movies reuse one saved guest');
select public.save_family_guest(:'family', 'Daria P', :'guest');
select test.expect_eq((select name from public.family_guests where id = :'guest'), 'Daria P', 'family can correct a guest profile name');
savepoint merge_check;
select public.save_family_guest(:'family', 'Legacy Daria') as legacy_guest \gset
select public.edit_family_viewing(:'first_view', current_date, array[:ana::uuid, :ben::uuid], array[:'guest'::uuid, :'legacy_guest'::uuid], 3);
select public.set_guest_rating(:'item', :'legacy_guest', 6);
select public.merge_family_guests(:'legacy_guest', :'guest');
select test.expect_eq((select revision from public.family_viewings where id = :'first_view'), 5, 'merging guests invalidates stale attendance editors');
select test.expect_eq((select count(*) from public.family_viewing_guests where viewing_id = :'first_view'), 1::bigint, 'merging the same person does not duplicate attendance');
select test.expect_eq((select score from public.guest_ratings where list_item_id = :'item' and guest_id = :'guest'), 9.5::numeric, 'combining profiles preserves the chosen destination score');
rollback to merge_check;
release merge_check;
select public.create_guest_invitation(:'guest') as claim_token \gset
select public.create_guest_invitation(:'guest', null) as second_claim \gset
reset role;
insert into public.movie_nights(group_id, started_by) values(:'family', :ana) returning id as open_night \gset
:as_ana
select public.create_guest_invitation(:'guest', :'open_night') as personal_token \gset
savepoint revoked_invitation;
select public.revoke_guest_invitations(:'guest', :'open_night');
reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;
select test.expect_eq((public.guest_link_info(:'personal_token')->>'open')::boolean, false, 'revoked personal invitations reveal no open night');
select test.expect_error(format('select public.guest_join(%L, %L)', :'personal_token', 'Daria P'), 'is over');
rollback to revoked_invitation;
release revoked_invitation;
savepoint expired_invitation;
reset role;
update public.guest_invitations set expires_at = now() - interval '1 minute' where token_hash = sha256(convert_to(:'personal_token', 'UTF8'));
select set_config('request.jwt.claim.sub', '', false); set role service_role;
select test.expect_eq((public.guest_link_info(:'personal_token')->>'open')::boolean, false, 'expired personal invitations are unavailable');
rollback to expired_invitation;
release expired_invitation;
reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;
select public.guest_link_info(:'personal_token') ->> 'guest_name' as invited_name \gset
select test.expect_eq(:'invited_name', 'Daria P', 'named invite identifies only the selected guest');
select public.guest_join(:'personal_token', 'Not used') ->> 'guest_id' as session_id \gset
select test.expect_error(format('select public.guest_join(%L, %L)', :'personal_token', 'Daria P'), 'already joined');
select test.expect_eq((public.guest_account_invitation(:'personal_token')->>'valid')::boolean, false, 'night invitations cannot claim accounts');
:as_daria
select test.expect_error(format('select public.claim_family_guest(%L)', :'claim_token'), 'Finish your active');
select test.expect_eq((select count(*) from public.group_members where group_id = :'family' and user_id = :daria), 0::bigint, 'active-night refusal does not partially join family');
reset role;
update public.movie_nights set status = 'cancelled', ended_at = now() where id = :'open_night';
:as_daria
select public.claim_family_guest(:'claim_token') as imported \gset
select test.expect_eq((:'imported'::jsonb ->> 'viewings')::integer, 3, 'account imports all past guest attendance');
select test.expect_eq((select count(*) from public.family_viewing_members where user_id = :daria), 3::bigint, 'import produces one member attendance per viewing');
select test.expect_eq((select count(*) from public.family_viewing_guests where guest_id = :'guest'), 0::bigint, 'conversion does not leave duplicate guest attendance');
select test.expect_eq((select count(*) from public.ratings where user_id = :daria and score is not null), 4::bigint, 'family and missing personal scores are imported');
select test.expect_eq((select count(*) from public.reactions where user_id = :daria), 0::bigint, 'import does not manufacture likes or dislikes');
select test.expect_eq((public.claim_family_guest(:'claim_token')->>'alreadyLinked')::boolean, true, 'claim retry is idempotent');
select test.expect_eq((public.guest_claim_result(:'claim_token')->>'viewings')::integer, 3, 'the import receipt persists across refreshes');
select test.expect_error(format('select public.claim_family_guest(%L)', :'personal_token'), 'not available');
:as_ana
select public.save_family_guest(:'family', 'Ben as guest') as ben_guest \gset
select public.save_family_watch(:'item2', null, jsonb_build_array(jsonb_build_object('user_id', :ana)),
  jsonb_build_array(jsonb_build_object('guest_id', :'ben_guest', 'score', 9)));
select public.create_guest_invitation(:'ben_guest') as ben_claim \gset
:as_ben
insert into public.ratings(list_item_id, user_id, score, comment) values(:'item2', :ben, 6.5, 'Keep my note');
insert into public.list_items(added_by, media_id, status)
  select :ben, media_id, 'want' from public.list_items where id = :'item2' returning id as private_item \gset
insert into public.ratings(list_item_id, user_id, score, comment) values(:'private_item', :ben, 4.2, 'Private note');
update public.reactions set value = 'like' where list_item_id = :'private_item' and user_id = :ben;
select public.claim_family_guest(:'ben_claim');
select test.expect_eq((select score from public.ratings where list_item_id = :'item2' and user_id = :ben), 6.5::numeric, 'existing family score wins over imported guest score');
select test.expect_eq((select comment from public.ratings where list_item_id = :'item2' and user_id = :ben), 'Keep my note', 'existing family note stays untouched');
select test.expect_eq((select score from public.ratings where list_item_id = :'private_item' and user_id = :ben), 4.2::numeric, 'existing personal score stays untouched');
select test.expect_eq((select status from public.list_items where id = :'private_item'), 'want', 'import does not override an existing personal-list status');
select test.expect_eq((select value from public.reactions where list_item_id = :'private_item' and user_id = :ben), 'like', 'import does not change an existing personal reaction');
select test.expect_eq((select count(*) from public.family_viewing_members where viewing_id = :'other_view' and user_id = :ben), 1::bigint, 'import has one canonical attendance for an existing account');
select test.expect_eq((public.export_my_data()->'family_viewings'->0) ? 'viewing_id', true, 'download carries explicit viewing identities');
:as_outsider
select test.expect_eq(public.guest_claim_result(:'claim_token'), null::jsonb, 'an import receipt is private to the account that accepted');
select test.expect_eq((select count(*) from public.family_guests where group_id = :'family'), 0::bigint, 'outsider cannot read saved guest directory');
select test.expect_error(format('select public.save_family_guest(%L, %L)', :'family', 'Intruder'), 'not available');
select test.expect_error(format('select public.claim_family_guest(%L)', :'second_claim'), 'already been used');
reset role;
delete from auth.users where id = :daria;
select test.expect_eq((select count(*) from public.family_guests where id = :'guest'), 0::bigint, 'account deletion removes the linked guest alias rather than resurrecting its identity');
rollback;
