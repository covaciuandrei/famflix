-- For installations that already applied upgrade_movie_night_attendance.sql before
-- the release-guard correction. Back up first. Safe to run again.
begin;

do $$
begin
  if to_regprocedure('public.export_my_data_base()') is null then
    raise exception 'Apply upgrade_movie_night_attendance.sql before this follow-up patch';
  end if;
end;
$$;

-- BEGIN:family-release-guards
create or replace function public.join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  g_id      uuid;
  g_expires timestamptz;
begin
  perform public.hit_rate_limit(auth.uid(), 'join_group', 10, 600);

  select id, invite_code_expires_at into g_id, g_expires
  from public.groups
  where invite_code = upper(trim(p_invite_code))
  for no key update;

  if g_id is null then
    return null;
  end if;
  if g_expires <= now() then
    raise exception 'This invite code has expired. Ask the family for the new one';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (g_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return g_id;
end;
$$;

create or replace function public.rename_group(p_group uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.groups where id = p_group for no key update;
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'Only the family owner can do this';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Please enter a family name';
  end if;
  if char_length(trim(p_name)) > 250 then
    raise exception 'Family names can be at most 250 characters';
  end if;
  update public.groups set name = trim(p_name) where id = p_group;
end;
$$;

create or replace function public.regenerate_invite_code(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.new_invite_code();
begin
  perform 1 from public.groups where id = p_group for no key update;
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'Only the family owner can do this';
  end if;
  update public.groups
  set invite_code = v_code,
      invite_code_expires_at = now() + interval '24 hours'
  where id = p_group;
  perform public.add_activity(p_group, 'new_code');
  return v_code;
end;
$$;

create or replace function public.remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Lock the family before membership rows, as joining and leaving do.
  perform 1 from public.groups where id = p_group for no key update;
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'Only the family owner can do this';
  end if;
  if p_user = auth.uid() then
    raise exception 'Use Leave family to remove yourself';
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  if not found then
    raise exception 'That person is not in this family';
  end if;
  -- They knew the old code, so it changes too; otherwise they could rejoin straight away.
  update public.groups
  set invite_code = public.new_invite_code(),
      invite_code_expires_at = now() + interval '24 hours'
  where id = p_group;
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_next uuid;
begin
  perform 1 from public.groups where id = p_group for no key update;
  select role into v_role from public.group_members
  where group_id = p_group and user_id = auth.uid();
  if v_role is null then
    raise exception 'You are not in this family';
  end if;

  delete from public.group_members where group_id = p_group and user_id = auth.uid();

  if not exists (select 1 from public.group_members where group_id = p_group) then
    delete from public.groups where id = p_group;
    return;
  end if;

  if v_role = 'owner' then
    select user_id into v_next from public.group_members
    where group_id = p_group
    order by joined_at, user_id
    limit 1;
    update public.group_members set role = 'owner'
    where group_id = p_group and user_id = v_next;
    perform public.add_activity(p_group, 'new_owner', null, v_next);
  end if;
end;
$$;

create or replace function public.export_my_data_base()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;
  perform public.hit_rate_limit(v_me, 'export', 5, 3600);

  return jsonb_build_object(
    'exported_at', now(),
    'account', (
      select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
                                'created_at', p.created_at, 'share_my_list_with_my_families', p.share_my_list)
      from public.profiles p
      where p.id = v_me
    ),
    'families', (
      select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'role', gm.role, 'joined_at', gm.joined_at)
                                order by gm.joined_at, g.name), '[]'::jsonb)
      from public.group_members gm
      join public.groups g on g.id = gm.group_id
      where gm.user_id = v_me
    ),
    'my_list', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'title', m.title,
          'type', m.media_type,
          'tmdb_id', m.tmdb_id,
          'year', m.release_year,
          'status', li.status,
          'added_at', li.created_at,
          'watched_at', li.watched_at,
          'removed_at', li.deleted_at,
          'my_score', r.score,
          'my_note', r.comment,
          'my_reaction', x.value,
          'watched_with', case when wf.family is null then null
                               else jsonb_build_object('family', wf.family, 'people', wf.people) end,
          'episodes', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'season', e.season_number, 'episode', e.episode_number, 'watched_on', e.watched_on,
                                 'score', e.score, 'note', e.comment) order by e.season_number, e.episode_number),
                               '[]'::jsonb)
                       from public.episode_logs e where e.list_item_id = li.id),
          'earlier_episode_viewings', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'season', h.season_number, 'episode', h.episode_number, 'watched_on', h.watched_on,
                                 'pass', h.pass, 'score', h.score, 'note', h.comment)
                               order by h.season_number, h.episode_number, h.watched_on), '[]'::jsonb)
                       from public.episode_history h where h.list_item_id = li.id)
        ) order by li.created_at, m.title), '[]'::jsonb)
      from public.list_items li
      join public.media m on m.id = li.media_id
      left join public.ratings r on r.list_item_id = li.id and r.user_id = v_me
      left join public.reactions x on x.list_item_id = li.id and x.user_id = v_me
      left join lateral (
        select g.name as family,
               coalesce(jsonb_agg(p.display_name order by p.display_name) filter (where p.id is not null),
                        '[]'::jsonb) as people
        from public.list_items fi
        join public.groups g on g.id = fi.group_id
        left join public.watches w on w.list_item_id = fi.id and w.user_id <> v_me
        left join public.profiles p on p.id = w.user_id
        where fi.id = li.source_item_id and public.is_group_member(fi.group_id, v_me)
        group by g.name
      ) wf on true
      where li.group_id is null and li.added_by = v_me
    ),
    'watch_history', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'title', m.title,
          'type', m.media_type,
          'tmdb_id', m.tmdb_id,
          'year', m.release_year,
          'watched_on', h.watched_on,
          'family', case when public.is_group_member(h.group_id, v_me) then g.name end
        ) order by h.watched_on, m.title), '[]'::jsonb)
      from public.watch_history h
      join public.media m on m.id = h.media_id
      left join public.groups g on g.id = h.group_id
      where h.user_id = v_me
    ),
    'family_lists', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'family', case when public.is_group_member(g.id, v_me) then g.name end,
          'still_a_member', public.is_group_member(g.id, v_me),
          'titles', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'title', m.title,
                'type', m.media_type,
                'tmdb_id', m.tmdb_id,
                'year', m.release_year,
                'added_by_me', li.added_by = v_me,
                'added_at', li.created_at,
                'status', case when public.is_group_member(g.id, v_me) then li.status end,
                'removed_at', case when public.is_group_member(g.id, v_me) then li.deleted_at end,
                'my_score', r.score,
                'my_note', r.comment,
                'score_entered_by', case when r.id is null then null
                                         when r.rated_by = v_me then 'me'
                                         when public.is_group_member(g.id, v_me) then coalesce(rb.display_name, 'someone')
                                         else 'someone' end,
                'my_reaction', x.value,
                'i_watched_on', w.watched_on,
                'rating_request_skipped', case when w.list_item_id is null then null else w.skipped_at is not null end,
                'watch_logged_by', case when w.list_item_id is null then null
                                        when w.logged_by = v_me then 'me'
                                        when public.is_group_member(g.id, v_me) then coalesce(lb.display_name, 'someone')
                                        else 'someone' end
              ) order by li.created_at, m.title), '[]'::jsonb)
            from public.list_items li
            join public.media m on m.id = li.media_id
            left join public.ratings r on r.list_item_id = li.id and r.user_id = v_me
            left join public.profiles rb on rb.id = r.rated_by and r.rated_by <> v_me
            left join public.reactions x on x.list_item_id = li.id and x.user_id = v_me
            left join public.watches w on w.list_item_id = li.id and w.user_id = v_me
            left join public.profiles lb on lb.id = w.logged_by and w.logged_by <> v_me
            where li.group_id = g.id
              and (li.added_by = v_me or r.id is not null or x.list_item_id is not null or w.list_item_id is not null)
          )
        ) order by case when public.is_group_member(g.id, v_me) then g.name end, g.id), '[]'::jsonb)
      from public.groups g
      where g.id in (
        select gm.group_id from public.group_members gm where gm.user_id = v_me
        union select li.group_id from public.list_items li where li.group_id is not null and li.added_by = v_me
        union select li.group_id from public.list_items li join public.ratings r2 on r2.list_item_id = li.id
              where li.group_id is not null and r2.user_id = v_me
        union select li.group_id from public.list_items li join public.reactions x2 on x2.list_item_id = li.id
              where li.group_id is not null and x2.user_id = v_me
        union select li.group_id from public.list_items li join public.watches w2 on w2.list_item_id = li.id
              where li.group_id is not null and w2.user_id = v_me
      )
    ),
    'movie_nights', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'family', case when public.is_group_member(g.id, v_me) then g.name end,
          'started_at', n.created_at,
          'started_by_me', n.started_by = v_me,
          'source', n.source,
          'status', case when public.is_group_member(g.id, v_me) then n.status end,
          'mood', to_jsonb(n.genres),
          'happened_on', case when public.is_group_member(g.id, v_me) then n.happened_on end,
          'picked_title', case when public.is_group_member(g.id, v_me) then pm.title end,
          'i_joined_at', mm.joined_at,
          'i_watched_it', mm.watched,
          'stacks_i_finished', (select count(*) from public.movie_night_finishes f
                                join public.movie_night_stacks s on s.id = f.stack_id
                                where s.night_id = n.id and f.user_id = v_me),
          'my_votes', (select coalesce(jsonb_agg(jsonb_build_object('title', vm.title, 'vote', v.vote, 'voted_at', v.voted_at)
                                                 order by v.voted_at, vm.title), '[]'::jsonb)
                       from public.movie_night_votes v
                       join public.movie_night_candidates c on c.id = v.candidate_id
                       join public.media vm on vm.id = c.media_id
                       where c.night_id = n.id and v.user_id = v_me)
        ) order by n.created_at), '[]'::jsonb)
      from public.movie_nights n
      join public.groups g on g.id = n.group_id
      left join public.movie_night_members mm on mm.night_id = n.id and mm.user_id = v_me
      left join public.media pm on pm.id = n.picked_media_id
      where mm.user_id is not null
         or n.started_by = v_me
         or exists (select 1 from public.movie_night_votes v2
                    join public.movie_night_candidates c2 on c2.id = v2.candidate_id
                    where c2.night_id = n.id and v2.user_id = v_me)
    ),
    'movie_night_plans', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'family', case when public.is_group_member(g.id, v_me) then g.name end,
          'starts_at', p.starts_at,
          'status', case when public.is_group_member(g.id, v_me) then p.status end,
          'mood', to_jsonb(p.genres),
          'planned_by_me', p.created_by is not distinct from v_me,
          'note', case when p.created_by = v_me then p.note end,
          'my_answer', r.answer,
          'answered_at', r.updated_at
        ) order by p.starts_at, p.id), '[]'::jsonb)
      from public.movie_night_plans p
      join public.groups g on g.id = p.group_id
      left join public.movie_night_plan_rsvps r on r.plan_id = p.id and r.user_id = v_me
      where p.created_by = v_me or r.user_id is not null
    ),
    'feed_events', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'family', case when public.is_group_member(g.id, v_me) then g.name end,
          'kind', a.kind,
          'title', a.media_title,
          'at', a.created_at,
          'score', a.score,
          'detail', case when public.is_group_member(a.group_id, v_me) then a.detail end,
          'about', case when public.is_group_member(a.group_id, v_me) then a.subject_name end
        ) order by a.created_at, a.id), '[]'::jsonb)
      from public.activity a
      join public.groups g on g.id = a.group_id
      where a.actor_id = v_me
    ),
    'not_included', jsonb_build_array(
      'Other people''s scores, notes, reactions and e-mail addresses.',
      'The guests of movie nights, and the links used to invite them.',
      'Invite codes, and anything else that gives access to a family.',
      'The temporary counters that limit how fast the app can be used.',
      'The details of titles (posters, descriptions, cast): they come from TMDB and are shared by everyone.'
    )
  );
end;
$$;
-- END:family-release-guards

-- BEGIN:guest-admission-guard
create or replace function public.claim_family_guest(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.guest_invitations; g public.family_guests; v record; r record; v_count integer := 0; v_scores integer := 0;
  v_user uuid := auth.uid(); v_night uuid; v_existing boolean;
begin
  if v_user is null then raise exception 'You must be signed in'; end if;
  perform public.hit_rate_limit(v_user, 'claim_guest', 10, 600);
  select * into i from public.guest_invitations where token_hash = sha256(convert_to(p_token, 'UTF8')) and purpose = 'account';
  if not found then raise exception 'This account invitation is not available'; end if;
  perform 1 from public.groups where id = (select group_id from public.family_guests where id = i.guest_id) for no key update;
  if not found then raise exception 'This account invitation is not available'; end if;
  select * into g from public.family_guests where id = i.guest_id for update;
  select * into i from public.guest_invitations where id = i.id for update;
  if i.consumed_by = v_user and g.account_id = v_user then
    return jsonb_build_object('familyId', g.group_id, 'alreadyLinked', true, 'viewings', i.imported_viewings, 'scores', i.imported_scores);
  end if;
  if i.revoked_at is not null or i.expires_at <= now() or i.consumed_by is not null or g.account_id is not null
    or not exists(select 1 from public.group_members where group_id = g.group_id and user_id = i.created_by) then raise exception 'This account invitation expired, was revoked, or has already been used'; end if;
  for v_night in select n.id from public.movie_nights n join public.movie_night_guests s on s.night_id = n.id
    where s.profile_id = g.id and n.status = 'open' loop perform public.settle_movie_night(v_night); end loop;
  if exists(select 1 from public.movie_nights n join public.movie_night_guests s on s.night_id = n.id where s.profile_id = g.id and n.status = 'open')
    then raise exception 'Finish your active guest movie night first, then return here to link your history'; end if;
  insert into public.group_members(group_id, user_id, role) values(g.group_id, v_user, 'member') on conflict do nothing;
  for v in select fv.* from public.family_viewing_guests a join public.family_viewings fv on fv.id = a.viewing_id
    where a.guest_id = g.id order by fv.watched_on desc nulls last, fv.created_at desc loop
    select exists(select 1 from public.family_viewing_members where viewing_id = v.id and user_id = v_user) into v_existing;
    insert into public.family_viewing_members(viewing_id, user_id, logged_by) values(v.id, v_user, g.created_by) on conflict do nothing;
    if not v_existing then v_count := v_count + 1; end if;
    insert into public.watch_history(user_id, media_id, watched_on, group_id, logged_by, viewing_id)
      values(v_user, v.media_id, v.watched_on, g.group_id, g.created_by, v.id)
      on conflict(user_id, viewing_id) where viewing_id is not null do nothing;
    if exists(select 1 from public.watches where viewing_id = v.id) then
      insert into public.watches(list_item_id, user_id, watched_on, logged_by, viewing_id)
        values(v.list_item_id, v_user, v.watched_on, g.created_by, v.id) on conflict(list_item_id, user_id) do nothing;
    end if;
    insert into public.list_items(added_by, media_id, status, watched_at, source_item_id, source_viewing_id, watch_origin)
      values(v_user, v.media_id, 'watched', case when v.watched_on is null then null else least(now(), v.watched_on::timestamptz + interval '12 hours') end,
        v.list_item_id, v.id, 'created') on conflict(added_by, media_id) where group_id is null do nothing;
    insert into public.movie_night_members(night_id, user_id, watched)
      select id, v_user, true from public.movie_nights where viewing_id = v.id
      on conflict(night_id, user_id) do update set watched = true;
    update public.family_viewings set revision = revision + 1 where id = v.id;
  end loop;
  perform set_config('famflix.copying_rating', 'on', true);
  perform set_config('famflix.importing_guest', 'on', true);
  for r in select * from public.guest_ratings where guest_id = g.id loop
    if not exists(select 1 from public.ratings where list_item_id = r.list_item_id and user_id = v_user and score is not null) then
      insert into public.ratings(list_item_id, user_id, score, rated_by) values(r.list_item_id, v_user, r.score, r.rated_by)
      on conflict(list_item_id, user_id) do update set score = excluded.score, rated_by = excluded.rated_by where public.ratings.score is null;
      v_scores := v_scores + 1;
    end if;
    insert into public.ratings(list_item_id, user_id, score, rated_by)
      select li.id, v_user, r.score, r.rated_by from public.list_items li join public.list_items fi on fi.media_id = li.media_id
      where fi.id = r.list_item_id and li.group_id is null and li.added_by = v_user
      on conflict(list_item_id, user_id) do update set score = excluded.score, rated_by = excluded.rated_by where public.ratings.score is null;
  end loop;
  perform set_config('famflix.copying_rating', 'off', true);
  perform set_config('famflix.importing_guest', 'off', true);
  update public.family_guests set account_id = v_user where id = g.id;
  delete from public.family_viewing_guests where guest_id = g.id;
  update public.guest_invitations set consumed_by = v_user, imported_viewings = v_count, imported_scores = v_scores where id = i.id;
  update public.guest_invitations set revoked_at = now() where guest_id = g.id and id <> i.id;
  return jsonb_build_object('familyId', g.group_id, 'viewings', v_count, 'scores', v_scores, 'alreadyLinked', false);
end;
$$;
-- END:guest-admission-guard
revoke all on function public.join_group(text), public.rename_group(uuid, text), public.regenerate_invite_code(uuid),
  public.remove_member(uuid, uuid), public.leave_group(uuid), public.export_my_data_base(), public.claim_family_guest(text)
  from public, anon, authenticated, service_role;
grant execute on function public.join_group(text), public.rename_group(uuid, text), public.regenerate_invite_code(uuid),
  public.remove_member(uuid, uuid), public.leave_group(uuid), public.claim_family_guest(text) to authenticated;

notify pgrst, 'reload schema';
commit;
