\set ON_ERROR_STOP 1
insert into auth.users(id, email, raw_user_meta_data) values
 ('71717171-0000-0000-0000-000000000001', 'upgrade-a@x.test', '{"full_name":"Upgrade Ana"}'),
 ('72727272-0000-0000-0000-000000000002', 'upgrade-b@x.test', '{"full_name":"Upgrade Ben"}');
select set_config('request.jwt.claim.sub', '71717171-0000-0000-0000-000000000001', false);
set role authenticated;
select (public.create_group('Upgrade family')).id as family \gset
reset role;
insert into public.group_members(group_id, user_id) values(:'family', '72727272-0000-0000-0000-000000000002');
insert into public.media(tmdb_id, media_type, title) values(99036, 'movie', 'Upgrade A'), (99037, 'movie', 'Upgrade B');
insert into public.list_items(group_id, added_by, media_id)
 select :'family', '71717171-0000-0000-0000-000000000001', id from public.media where tmdb_id = 99036 returning id as item_a \gset
insert into public.list_items(group_id, added_by, media_id)
 select :'family', '71717171-0000-0000-0000-000000000001', id from public.media where tmdb_id = 99037 returning id as item_b \gset
set role authenticated;
select public.log_watch(:'item_a', current_date - 10,
 '[{"user_id":"71717171-0000-0000-0000-000000000001","score":8},{"user_id":"72727272-0000-0000-0000-000000000002","score":6}]');
select public.watched_again(:'item_a', current_date - 2, '[{"user_id":"71717171-0000-0000-0000-000000000001"}]');
select public.log_watch(:'item_b', current_date - 5, '[{"user_id":"71717171-0000-0000-0000-000000000001"},{"user_id":"72727272-0000-0000-0000-000000000002"}]');
reset role;
insert into public.movie_night_guests(night_id, name, secret_hash)
 select id, 'Daria', sha256(id::text::bytea) from public.movie_nights
 where picked_list_item_id = :'item_b' or happened_on = current_date - 10;
update public.movie_nights set source = 'swipe' where picked_list_item_id = :'item_b';
insert into public.movie_night_stacks(night_id, position, created_by)
 select id, 1, '71717171-0000-0000-0000-000000000001' from public.movie_nights where picked_list_item_id = :'item_b'
 returning id as stack_id, night_id \gset
insert into public.movie_night_candidates(night_id, stack_id, position, origin, media_id, list_item_id)
 select :'night_id', :'stack_id', 1, 'list', media_id, id from public.list_items where id = :'item_b' returning id as candidate_id \gset
insert into public.movie_night_guest_votes(candidate_id, guest_id, vote)
 select :'candidate_id', id, 'love' from public.movie_night_guests where night_id = :'night_id';
create table test.upgrade_snapshot as select
 (select count(*) from auth.users) users,
 (select count(*) from public.list_items) items,
 (select count(*) from public.ratings) ratings,
 (select count(*) from public.reactions) reactions,
 (select count(*) from public.watches) watches,
 (select count(*) from public.watch_history) history,
 (select count(*) from public.movie_nights) nights,
 (select jsonb_agg(to_jsonb(v) order by guest_id, candidate_id) from public.movie_night_guest_votes v) votes;

-- Exercise the older deployed guards as well as a previously applied attendance upgrade.
create function test.use_older_family_guards() returns void language plpgsql as $$
declare signatures text[] := array['join_group(text)', 'rename_group(uuid,text)', 'regenerate_invite_code(uuid)', 'remove_member(uuid,uuid)', 'leave_group(uuid)'];
  signature text; definition text; field text;
begin
  signatures := array_append(signatures, case when to_regprocedure('public.export_my_data_base()') is null
    then 'export_my_data()' else 'export_my_data_base()' end);
  if to_regprocedure('public.claim_family_guest(text)') is not null then signatures := array_append(signatures, 'claim_family_guest(text)'); end if;
  foreach signature in array signatures loop
    definition := replace(pg_get_functiondef(('public.' || signature)::regprocedure), 'for no key update', '');
    if signature like 'export_my_data%' then
      foreach field in array array['g.name', 'li.status', 'li.deleted_at', 'n.status', 'n.happened_on', 'pm.title', 'p.status'] loop
        definition := replace(definition, 'case when public.is_group_member(g.id, v_me) then ' || field || ' end', field);
      end loop;
    end if;
    execute definition;
  end loop;
end;
$$;
select test.use_older_family_guards();
select test.expect_eq((select position('for no key update' in prosrc) from pg_proc
  where oid = 'public.join_group(text)'::regprocedure), 0, 'upgrade fixture starts without the unpublished admission guard');
