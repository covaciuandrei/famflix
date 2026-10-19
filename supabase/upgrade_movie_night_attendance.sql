-- Existing installations: back up first, then run once before deploying the matching app.
-- This same upgrade is included at the end of db_init.sql for fresh installations.
begin;

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

create or replace function public.export_my_data()
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
revoke all on function public.join_group(text), public.rename_group(uuid, text), public.regenerate_invite_code(uuid),
  public.remove_member(uuid, uuid), public.leave_group(uuid), public.export_my_data()
  from public, anon, authenticated, service_role;
grant execute on function public.join_group(text), public.rename_group(uuid, text), public.regenerate_invite_code(uuid),
  public.remove_member(uuid, uuid), public.leave_group(uuid), public.export_my_data() to authenticated;

create table public.family_viewings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete set null,
  media_id uuid not null references public.media(id) on delete cascade,
  list_item_id uuid references public.list_items(id) on delete set null,
  watched_on date,
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create index family_viewings_group_idx on public.family_viewings(group_id, media_id);
create index family_viewings_media_idx on public.family_viewings(media_id);
create index family_viewings_item_idx on public.family_viewings(list_item_id);
create table public.family_viewing_members (
  viewing_id uuid not null references public.family_viewings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  logged_by uuid references public.profiles(id) on delete set null,
  primary key (viewing_id, user_id)
);
create index family_viewing_members_user_idx on public.family_viewing_members(user_id);
create index family_viewing_members_logger_idx on public.family_viewing_members(logged_by);

alter table public.watches alter column watched_on drop not null;
alter table public.movie_nights alter column happened_on drop not null;
alter table public.watches add column viewing_id uuid references public.family_viewings(id) on delete set null;
alter table public.watch_history add column viewing_id uuid references public.family_viewings(id) on delete set null;
alter table public.list_items add column source_viewing_id uuid references public.family_viewings(id) on delete set null;
alter table public.movie_nights add column viewing_id uuid references public.family_viewings(id) on delete set null;
create index watches_viewing_idx on public.watches(viewing_id);
create index watch_history_viewing_idx on public.watch_history(viewing_id);
create index list_items_viewing_idx on public.list_items(source_viewing_id);
create index movie_nights_viewing_idx on public.movie_nights(viewing_id);
alter table public.watch_history drop constraint watch_history_user_id_media_id_watched_on_key;
create unique index watch_history_own_day_uniq on public.watch_history(user_id, media_id, watched_on) where viewing_id is null;
create unique index watch_history_viewing_uniq on public.watch_history(user_id, viewing_id) where viewing_id is not null;

do $$
declare old_night record; v_id uuid; old_watch record;
begin
  for old_night in select * from public.movie_nights where status = 'closed' and picked_media_id is not null order by created_at, id loop
    insert into public.family_viewings(group_id, media_id, list_item_id, watched_on, created_at)
    values (old_night.group_id, old_night.picked_media_id, old_night.picked_list_item_id, old_night.happened_on, old_night.created_at) returning id into v_id;
    update public.movie_nights set viewing_id = v_id where id = old_night.id;
    insert into public.family_viewing_members(viewing_id, user_id, logged_by)
      select v_id, user_id, old_night.ended_by from public.movie_night_members where night_id = old_night.id and watched;
  end loop;
  for old_watch in select w.*, li.group_id, li.media_id from public.watches w join public.list_items li on li.id = w.list_item_id loop
    select n.viewing_id into v_id from public.movie_nights n
      join public.family_viewing_members p on p.viewing_id = n.viewing_id and p.user_id = old_watch.user_id
      where n.picked_list_item_id = old_watch.list_item_id and n.happened_on is not distinct from old_watch.watched_on
      order by n.created_at desc, n.id desc limit 1;
    if v_id is null then
      select id into v_id from public.family_viewings
        where list_item_id = old_watch.list_item_id and watched_on is not distinct from old_watch.watched_on
        order by created_at desc limit 1;
    end if;
    if v_id is null then
      insert into public.family_viewings(group_id, media_id, list_item_id, watched_on)
      values (old_watch.group_id, old_watch.media_id, old_watch.list_item_id, old_watch.watched_on) returning id into v_id;
    end if;
    update public.watches set viewing_id = v_id where id = old_watch.id;
    insert into public.family_viewing_members values (v_id, old_watch.user_id, old_watch.logged_by) on conflict do nothing;
  end loop;
  update public.list_items li set source_viewing_id = w.viewing_id
    from public.watches w where li.group_id is null and li.source_item_id = w.list_item_id and li.added_by = w.user_id;
  update public.watch_history h set viewing_id = (
    select v.id from public.family_viewings v join public.family_viewing_members p on p.viewing_id = v.id
    where v.group_id = h.group_id and v.media_id = h.media_id and p.user_id = h.user_id
      and v.watched_on is not distinct from h.watched_on order by v.created_at limit 1
  ) where h.group_id is not null;
  insert into public.watch_history(user_id, media_id, watched_on, group_id, logged_by, viewing_id)
    select p.user_id, v.media_id, v.watched_on, v.group_id, p.logged_by, v.id
    from public.family_viewings v join public.family_viewing_members p on p.viewing_id = v.id
    where not exists (select 1 from public.watches w where w.viewing_id = v.id and w.user_id = p.user_id)
    on conflict (user_id, viewing_id) where viewing_id is not null do nothing;
end;
$$;

create function public.can_see_viewing(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.family_viewings v where v.id = p_id
    and (public.is_group_member(v.group_id, auth.uid())
      or exists (select 1 from public.family_viewing_members p where p.viewing_id = v.id and p.user_id = auth.uid())));
$$;
alter table public.family_viewings enable row level security;
alter table public.family_viewing_members enable row level security;
create policy viewings_read on public.family_viewings for select using (public.can_see_viewing(id));
create policy viewing_members_read on public.family_viewing_members for select using (public.can_see_viewing(viewing_id));

create or replace function public.archive_family_viewing(p_item uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer; v_legacy integer;
begin
  perform 1 from public.list_items where id = p_item for update;
  insert into public.watch_history(user_id, media_id, watched_on, group_id, logged_by, viewing_id)
    select w.user_id, li.media_id, w.watched_on, li.group_id, w.logged_by, w.viewing_id
    from public.watches w join public.list_items li on li.id = w.list_item_id where li.id = p_item and w.viewing_id is not null
    on conflict (user_id, viewing_id) where viewing_id is not null do nothing;
  get diagnostics v_count = row_count;
  insert into public.watch_history(user_id, media_id, watched_on, group_id, logged_by)
    select w.user_id, li.media_id, w.watched_on, li.group_id, w.logged_by
    from public.watches w join public.list_items li on li.id = w.list_item_id where li.id = p_item and w.viewing_id is null
    on conflict(user_id, media_id, watched_on) where viewing_id is null do nothing;
  get diagnostics v_legacy = row_count;
  perform set_config('famflix.archiving_watch', 'on', true);
  delete from public.watches where list_item_id = p_item;
  perform set_config('famflix.archiving_watch', 'off', true);
  update public.list_items set status = 'want', watched_at = null where id = p_item and status = 'watched';
  return v_count + v_legacy;
end;
$$;

create or replace function public.archive_my_viewing(p_item uuid, p_status text, p_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare li public.list_items; v_group uuid;
begin
  select * into li from public.list_items where id = p_item;
  if li.status = 'watched' then
    select group_id into v_group from public.list_items where id = li.source_item_id;
    if li.source_viewing_id is not null then
      insert into public.watch_history(user_id, media_id, watched_on, group_id, viewing_id)
      values (li.added_by, li.media_id, (li.watched_at at time zone 'UTC')::date, v_group, li.source_viewing_id)
      on conflict (user_id, viewing_id) where viewing_id is not null do nothing;
    else
      insert into public.watch_history(user_id, media_id, watched_on, group_id)
      values (li.added_by, li.media_id, (li.watched_at at time zone 'UTC')::date, v_group)
      on conflict (user_id, media_id, watched_on) where viewing_id is null do nothing;
    end if;
  end if;
  update public.list_items set status = p_status,
    watched_at = case when p_status = 'watched' and p_on is not null then least(now(), p_on::timestamptz + interval '12 hours') end,
    source_item_id = null, source_viewing_id = null, watch_origin = null where id = p_item;
end;
$$;

create or replace function public.record_movie_night_watch(p_item uuid, p_date date, p_viewers uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare li public.list_items; v_type text; v_night uuid; v_view uuid;
begin
  select * into li from public.list_items where id = p_item;
  if li.group_id is null then return; end if;
  select media_type into v_type from public.media where id = li.media_id;
  select w.viewing_id into v_view from public.watches w
    where w.list_item_id = p_item and w.watched_on is not distinct from p_date and w.viewing_id is not null limit 1;
  if v_view is null then
    insert into public.family_viewings(group_id, media_id, list_item_id, watched_on)
    values (li.group_id, li.media_id, p_item, p_date) returning id into v_view;
  else
    update public.family_viewings set revision = revision + 1 where id = v_view;
  end if;
  update public.watches set viewing_id = v_view
    where list_item_id = p_item and watched_on is not distinct from p_date;
  insert into public.family_viewing_members(viewing_id, user_id, logged_by)
    select v_view, user_id, logged_by from public.watches where viewing_id = v_view
    on conflict do nothing;
  insert into public.family_viewing_members(viewing_id, user_id, logged_by)
    select v_view, u, auth.uid() from unnest(p_viewers) u on conflict do nothing;
  insert into public.watch_history(user_id, media_id, watched_on, group_id, logged_by, viewing_id)
    select u, li.media_id, p_date, li.group_id, auth.uid(), v_view from unnest(p_viewers) u
    where not exists (select 1 from public.watches w where w.viewing_id = v_view and w.user_id = u)
    on conflict (user_id, viewing_id) where viewing_id is not null do nothing;
  update public.list_items m set source_viewing_id = w.viewing_id,
    watched_at = case when w.watched_on is null then null else least(now(), w.watched_on::timestamptz + interval '12 hours') end
    from public.watches w where m.source_item_id = p_item and m.added_by = w.user_id
      and w.list_item_id = p_item and m.watch_origin is not null and m.status = 'watched';
  update public.movie_nights set status = 'expired', ended_at = now()
    where group_id = li.group_id and status = 'open' and last_activity_at < now() - interval '12 hours';
  select n.id into v_night from public.movie_nights n
    where n.group_id = li.group_id and n.status = 'open'
      and exists (select 1 from public.movie_night_candidates c where c.night_id = n.id and c.media_id = li.media_id)
    limit 1;
  if v_night is not null then
    update public.movie_nights set status = 'closed', ended_at = now(), ended_by = auth.uid(),
      picked_media_id = li.media_id, picked_list_item_id = p_item, happened_on = p_date,
      viewing_id = v_view, last_activity_at = now() where id = v_night;
    perform public.movie_night_add_top_titles(v_night);
  else
    if v_type <> 'movie' then return; end if;
    select id into v_night from public.movie_nights where viewing_id = v_view order by created_at limit 1;
    if v_night is null then
      -- pick_movie_night_title closes its night before calling log_watch.
      select id into v_night from public.movie_nights where picked_list_item_id = p_item
        and viewing_id is null and happened_on is not distinct from p_date and status = 'closed'
        order by ended_at desc limit 1;
    end if;
    if v_night is null then
      insert into public.movie_nights(group_id, source, status, started_by, ended_at, ended_by,
        picked_media_id, picked_list_item_id, happened_on, viewing_id)
      values (li.group_id, 'logged', 'closed', auth.uid(), now(), auth.uid(), li.media_id, p_item, p_date, v_view)
      returning id into v_night;
    else
      update public.movie_nights set viewing_id = v_view where id = v_night;
    end if;
  end if;
  insert into public.movie_night_members(night_id, user_id, watched)
    select v_night, user_id, true from public.family_viewing_members where viewing_id = v_view
    on conflict (night_id, user_id) do update set watched = true;
  insert into public.family_viewing_guests(viewing_id, guest_id)
    select v_view, profile_id from public.movie_night_guests where night_id = v_night and profile_id is not null
    on conflict do nothing;
end;
$$;

create or replace function public.log_watch(p_item uuid, p_watched_on date, p_viewers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare li public.list_items; v record; v_users uuid[] := '{}'; v_on date; v_names text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into li from public.list_items where id = p_item and deleted_at is null for update;
  if li.group_id is null or not public.is_group_member(li.group_id, auth.uid()) then
    raise exception 'This title is not on one of your family lists';
  end if;
  if p_watched_on > current_date + 1 then raise exception 'Pick a date that is not in the future'; end if;
  if jsonb_typeof(p_viewers) is distinct from 'array' or jsonb_array_length(p_viewers) not between 1 and 50 then
    raise exception 'Pick at least one person who watched it';
  end if;
  for v in select x.user_id, round(x.score, 1) score from jsonb_to_recordset(p_viewers) x(user_id uuid, score numeric) loop
    if v.user_id is null or not public.is_group_member(li.group_id, v.user_id) then raise exception 'Only members of this family can be added'; end if;
    if v.user_id = any(v_users) then raise exception 'Pick each person only once'; end if;
    if v.score is not null and (v.score < 1 or v.score > 10) then raise exception 'Scores must be between 1 and 10'; end if;
    v_users := v_users || v.user_id;
    insert into public.watch_history(user_id, media_id, watched_on, group_id, logged_by, viewing_id)
      select w.user_id, li.media_id, w.watched_on, li.group_id, w.logged_by, w.viewing_id from public.watches w
      where w.list_item_id = p_item and w.user_id = v.user_id and w.viewing_id is not null
        and w.watched_on is distinct from p_watched_on
      on conflict(user_id, viewing_id) where viewing_id is not null do nothing;
    insert into public.watches as w(list_item_id, user_id, watched_on, logged_by)
    values (p_item, v.user_id, p_watched_on, auth.uid())
    on conflict (list_item_id, user_id) do update set
      watched_on = case when excluded.watched_on is null then null else greatest(w.watched_on, excluded.watched_on) end,
      viewing_id = case when w.watched_on is not distinct from excluded.watched_on
        or (excluded.watched_on is not null and w.watched_on > excluded.watched_on) then w.viewing_id end,
      logged_by = excluded.logged_by returning watched_on into v_on;
    perform public.add_to_my_list_watched(p_item, v.user_id, v_on);
    if v.score is not null then
      insert into public.ratings as r(list_item_id, user_id, score) values(p_item, v.user_id, v.score)
      on conflict(list_item_id, user_id) do update set score = excluded.score, updated_at = now() where r.score is null;
    end if;
  end loop;
  select string_agg(display_name, ', ' order by display_name) into v_names from public.profiles where id = any(v_users);
  perform public.add_activity(li.group_id, 'watched_together', p_item, null, null, v_names);
  perform set_config('famflix.logging_watch', 'on', true);
  update public.list_items set status = 'watched',
    watched_at = case when p_watched_on is null then null else least(now(), p_watched_on::timestamptz + interval '12 hours') end
    where id = p_item;
  perform public.record_movie_night_watch(p_item, p_watched_on, v_users);
end;
$$;

create or replace function public.watched_again(p_item uuid, p_watched_on date, p_viewers jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare li public.list_items;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into li from public.list_items where id = p_item and deleted_at is null for update;
  if not found or (li.group_id is null and li.added_by is distinct from auth.uid())
    or (li.group_id is not null and not public.is_group_member(li.group_id, auth.uid())) then raise exception 'This title is not on one of your lists'; end if;
  perform public.hit_rate_limit(auth.uid(), 'watch_again', 60, 3600);
  if li.group_id is not null then
    if exists(select 1 from public.watches where list_item_id = p_item) then perform public.archive_family_viewing(p_item); end if;
    perform public.log_watch(p_item, p_watched_on, p_viewers);
  else
    if exists(select 1 from public.media where id = li.media_id and series is not null) then raise exception 'Start a series again from its page'; end if;
    if p_watched_on > current_date + 1 then raise exception 'Pick a date that is not in the future'; end if;
    perform public.archive_my_viewing(p_item, 'watched', p_watched_on);
  end if;
end;
$$;

create or replace function public.after_watch_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('famflix.archiving_watch', true) = 'on' then return null; end if;
  if current_setting('famflix.editing_night', true) is distinct from 'on' and old.viewing_id is not null then
    delete from public.family_viewing_members where viewing_id = old.viewing_id and user_id = old.user_id;
    update public.family_viewings set revision = revision + 1 where id = old.viewing_id;
    update public.movie_night_members m set watched = false from public.movie_nights n
      where n.id = m.night_id and n.viewing_id = old.viewing_id and m.user_id = old.user_id;
    delete from public.movie_nights n where n.viewing_id = old.viewing_id and n.source = 'logged'
      and not exists(select 1 from public.family_viewing_members p where p.viewing_id = old.viewing_id);
  end if;
  perform public.remove_from_my_list_watched(old.list_item_id, old.user_id);
  if not exists(select 1 from public.watches where list_item_id = old.list_item_id) then
    update public.list_items set status = 'want', watched_at = null where id = old.list_item_id and status = 'watched';
  end if;
  return null;
end;
$$;

-- Keep the stricter check exclusively for the destructive "also put back on To watch" operation.
alter function public.movie_night_edit_problem(public.movie_nights) rename to movie_night_undo_problem;
create function public.movie_night_edit_problem(n public.movie_nights) returns text
language sql stable security definer set search_path = public as $$
  select case when n.status <> 'closed' or n.viewing_id is null then 'Only a movie night that picked a title can be edited' end;
$$;

create table public.family_guests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30 and name !~ '[[:cntrl:]]'),
  account_id uuid references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index family_guests_name_uniq on public.family_guests(group_id, lower(name));
create index family_guests_account_idx on public.family_guests(account_id) where account_id is not null;
create index family_guests_creator_idx on public.family_guests(created_by);
create table public.family_viewing_guests (
  viewing_id uuid not null references public.family_viewings(id) on delete cascade,
  guest_id uuid not null references public.family_guests(id) on delete cascade,
  primary key(viewing_id, guest_id)
);
create index family_viewing_guests_guest_idx on public.family_viewing_guests(guest_id);
create table public.guest_ratings (
  id uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items(id) on delete cascade,
  guest_id uuid not null references public.family_guests(id) on delete cascade,
  score numeric(3,1) not null check (score between 1 and 10),
  rated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(list_item_id, guest_id)
);
create index guest_ratings_guest_idx on public.guest_ratings(guest_id);
create index guest_ratings_author_idx on public.guest_ratings(rated_by);
alter table public.movie_night_guests add column profile_id uuid references public.family_guests(id) on delete cascade;
create unique index movie_night_guests_profile_uniq on public.movie_night_guests(night_id, profile_id);
create index movie_night_guests_profile_idx on public.movie_night_guests(profile_id);

-- Legacy sessions retain their original identity; equal names are disambiguated, never silently merged.
do $$
declare old_guest record; v_id uuid; v_name text; i integer;
begin
  for old_guest in select g.*, n.group_id, n.viewing_id from public.movie_night_guests g
    join public.movie_nights n on n.id = g.night_id order by g.joined_at, g.id loop
    v_name := old_guest.name; i := 1;
    while exists(select 1 from public.family_guests where group_id = old_guest.group_id and lower(name) = lower(v_name)) loop
      i := i + 1; v_name := left(old_guest.name, 27 - char_length(i::text)) || ' (' || i::text || ')';
    end loop;
    insert into public.family_guests(group_id, name) values (old_guest.group_id, v_name) returning id into v_id;
    update public.movie_night_guests set profile_id = v_id where id = old_guest.id;
    if old_guest.viewing_id is not null then insert into public.family_viewing_guests values(old_guest.viewing_id, v_id); end if;
  end loop;
end;
$$;
alter table public.family_guests enable row level security;
alter table public.family_viewing_guests enable row level security;
alter table public.guest_ratings enable row level security;
create policy family_guests_read on public.family_guests for select using(public.is_group_member(group_id, (select auth.uid())));
create policy viewing_guests_read on public.family_viewing_guests for select using(public.can_see_viewing(viewing_id));
create policy guest_ratings_read on public.guest_ratings for select using(public.can_see_item(list_item_id));

create function public.save_family_guest(p_group uuid, p_name text, p_guest uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_id uuid;
begin
  if not public.is_group_member(p_group, auth.uid()) then raise exception 'This family is not available'; end if;
  perform public.hit_rate_limit(auth.uid(), 'family_guest', 60, 3600);
  if char_length(v_name) not between 1 and 30 or v_name ~ '[[:cntrl:]]' then raise exception 'Please enter a plain name of 1 to 30 characters'; end if;
  if p_guest is null then
    insert into public.family_guests(group_id, name, created_by) values(p_group, v_name, auth.uid()) returning id into v_id;
  else
    update public.family_guests set name = v_name where id = p_guest and group_id = p_group and account_id is null returning id into v_id;
    if v_id is null then raise exception 'This guest is not available or already has an account'; end if;
    update public.movie_night_guests set name = v_name where profile_id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'A guest already uses that name in this family. Select them or add an initial';
end;
$$;

create function public.set_guest_rating(p_item uuid, p_guest uuid, p_score numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from public.list_items where id = p_item and deleted_at is null;
  if v_group is null or not public.is_group_member(v_group, auth.uid())
    or not exists(select 1 from public.family_guests where id = p_guest and group_id = v_group and account_id is null)
    then raise exception 'This guest or title is not available'; end if;
  if p_score is not null and (p_score < 1 or p_score > 10) then raise exception 'Scores must be between 1 and 10'; end if;
  perform public.hit_rate_limit(auth.uid(), 'guest_rating', 120, 3600);
  if p_score is null then delete from public.guest_ratings where list_item_id = p_item and guest_id = p_guest;
  else
    insert into public.guest_ratings(list_item_id, guest_id, score, rated_by) values(p_item, p_guest, round(p_score, 1), auth.uid())
    on conflict(list_item_id, guest_id) do update set score = excluded.score, rated_by = excluded.rated_by, updated_at = now();
  end if;
end;
$$;

create function public.check_viewing_guests(p_viewing uuid, p_guests uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from public.family_viewings where id = p_viewing;
  if not public.is_group_member(v_group, auth.uid()) then raise exception 'This viewing is not available'; end if;
  if coalesce(cardinality(p_guests), 0) <> (select count(distinct g) from unnest(p_guests) g)
    then raise exception 'Select each guest only once'; end if;
  if exists(select 1 from unnest(p_guests) g where not exists(select 1 from public.family_guests p where p.id = g and p.group_id = v_group and p.account_id is null))
    then raise exception 'Only guests from this family can be added'; end if;
  if (select count(*) from (
    select g from unnest(p_guests) g
    union
    select s.profile_id from public.movie_night_guests s join public.movie_nights n on n.id = s.night_id
      join public.family_guests g on g.id = s.profile_id and g.account_id is null where n.viewing_id = p_viewing
  ) people) > 10 then raise exception 'A movie night can have at most 10 guests, including its voting guests'; end if;
end;
$$;
revoke all on function public.check_viewing_guests(uuid, uuid[]) from public, anon, authenticated, service_role;

create function public.edit_family_viewing(
  p_viewing uuid, p_on date, p_members uuid[], p_guests uuid[], p_revision integer
) returns void language plpgsql security definer set search_path = public as $$
declare v public.family_viewings; u uuid; v_current boolean; v_old uuid[]; v_removed uuid[];
begin
  select * into v from public.family_viewings where id = p_viewing;
  if not found or not public.is_group_member(v.group_id, auth.uid()) then raise exception 'This viewing is not available'; end if;
  perform 1 from public.list_items where id = v.list_item_id for update;
  select * into v from public.family_viewings where id = p_viewing for update;
  if not found or not public.is_group_member(v.group_id, auth.uid()) then raise exception 'This viewing is not available'; end if;
  if p_revision is null or p_revision <> v.revision then raise exception 'Someone changed this viewing. Close this window and open it again'; end if;
  if p_on > current_date + 1 then raise exception 'Pick a date that is not in the future'; end if;
  if coalesce(cardinality(p_members), 0) not between 1 and 50 or coalesce(cardinality(p_guests), 0) > 10
    then raise exception 'Pick at least one person who watched it (a family member), and at most 10 guests'; end if;
  if exists(select 1 from unnest(p_members) m where not public.is_group_member(v.group_id, m))
    then raise exception 'Only members of this family can be added'; end if;
  perform public.check_viewing_guests(v.id, p_guests);
  perform public.hit_rate_limit(auth.uid(), 'edit_night', 60, 3600);
  select coalesce(array_agg(user_id), '{}') into v_old from public.family_viewing_members
    where viewing_id = v.id and public.is_group_member(v.group_id, user_id);
  v_removed := array(select unnest(v_old) except select unnest(p_members));
  foreach u in array v_removed loop
    if public.watcher_has_own_state(v.list_item_id, u) then
      raise exception '%', case when u = auth.uid() then 'You can only take yourself off this movie night ("I wasn''t there" on the family list)'
        else coalesce((select display_name from public.profiles where id = u), 'Someone') || ' can only take themselves off this movie night ("I wasn''t there" on the family list)' end;
    end if;
  end loop;
  if p_on is not distinct from v.watched_on and v_old @> p_members and v_old <@ p_members
    and (select coalesce(array_agg(guest_id order by guest_id), '{}') from public.family_viewing_guests where viewing_id = v.id)
      = array(select x from unnest(coalesce(p_guests, '{}')) x order by x) then return; end if;
  select exists(select 1 from public.watches where viewing_id = v.id) into v_current;
  if not v_current and not exists(select 1 from public.watches where list_item_id = v.list_item_id)
    and not exists(select 1 from public.watch_history where viewing_id = v.id)
    and not exists(select 1 from public.family_viewing_members where viewing_id = v.id) then v_current := true; end if;
  perform set_config('famflix.editing_night', 'on', true);
  if v_current then
    perform set_config('famflix.logging_watch', 'on', true);
    update public.list_items set status = 'watched',
      watched_at = case when p_on is null then null else least(now(), p_on::timestamptz + interval '12 hours') end
      where id = v.list_item_id;
  end if;
  update public.family_viewings set watched_on = p_on, revision = revision + 1 where id = v.id;
  update public.watches set watched_on = p_on where viewing_id = v.id;
  update public.watch_history set watched_on = p_on where viewing_id = v.id;
  update public.list_items set watched_at = case when p_on is null then null else least(now(), p_on::timestamptz + interval '12 hours') end
    where source_viewing_id = v.id and watch_origin is not null and status = 'watched' and deleted_at is null;
  insert into public.family_viewing_members(viewing_id, user_id, logged_by)
    select v.id, m, auth.uid() from unnest(p_members) m on conflict do nothing;
  foreach u in array p_members loop
    if not (u = any(v_old)) then
      if v_current and not exists(select 1 from public.watches where list_item_id = v.list_item_id and user_id = u) then
        insert into public.watches(list_item_id, user_id, watched_on, logged_by, viewing_id)
        values(v.list_item_id, u, p_on, auth.uid(), v.id);
        perform public.add_to_my_list_watched(v.list_item_id, u, p_on);
        update public.list_items set source_viewing_id = v.id,
          watched_at = case when p_on is null then null else least(now(), p_on::timestamptz + interval '12 hours') end
          where group_id is null and added_by = u and source_item_id = v.list_item_id and watch_origin is not null;
      else
        insert into public.watch_history(user_id, media_id, watched_on, group_id, logged_by, viewing_id)
        values(u, v.media_id, p_on, v.group_id, auth.uid(), v.id)
        on conflict(user_id, viewing_id) where viewing_id is not null do nothing;
        insert into public.list_items(added_by, media_id, status, watched_at, source_item_id, source_viewing_id, watch_origin)
        values(u, v.media_id, 'watched', case when p_on is null then null else least(now(), p_on::timestamptz + interval '12 hours') end, v.list_item_id, v.id, 'created')
        on conflict(added_by, media_id) where group_id is null do nothing;
      end if;
    end if;
  end loop;
  delete from public.family_viewing_members where viewing_id = v.id and user_id = any(v_removed);
  delete from public.watch_history where viewing_id = v.id and user_id = any(v_removed);
  delete from public.watches where viewing_id = v.id and user_id = any(v_removed);
  delete from public.ratings r where r.list_item_id = v.list_item_id and r.user_id = any(v_removed)
    and not exists(select 1 from public.family_viewing_members p join public.family_viewings other on other.id = p.viewing_id
      where p.user_id = r.user_id and other.group_id = v.group_id and other.media_id = v.media_id);
  delete from public.family_viewing_guests where viewing_id = v.id and not(guest_id = any(coalesce(p_guests, '{}')));
  insert into public.family_viewing_guests select v.id, g from unnest(p_guests) g on conflict do nothing;
  update public.movie_nights set happened_on = p_on where viewing_id = v.id;
  update public.movie_night_members m set watched = (m.user_id = any(p_members))
    from public.movie_nights n where n.id = m.night_id and n.viewing_id = v.id and public.is_group_member(v.group_id, m.user_id);
  insert into public.movie_night_members(night_id, user_id, watched)
    select n.id, attendee.user_id, true from public.movie_nights n, unnest(p_members) attendee(user_id) where n.viewing_id = v.id
    on conflict(night_id, user_id) do update set watched = true;
  perform set_config('famflix.editing_night', 'off', true);
  perform public.add_activity(v.group_id, 'movie_night_edited', v.list_item_id, null, null,
    (select string_agg(display_name, ', ' order by display_name) from public.profiles where id = any(p_members)));
end;
$$;

create or replace function public.update_movie_night(p_night uuid, p_watched_on date, p_viewers jsonb,
  p_expected_on date default null, p_expected_viewers uuid[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare n public.movie_nights; v public.family_viewings; v_users uuid[]; v_old uuid[]; v_guests uuid[]; r record;
begin
  n := public.movie_night_for_member(p_night);
  select * into v from public.family_viewings where id = n.viewing_id;
  if not found then raise exception 'Only a movie night that picked a title can be edited'; end if;
  if jsonb_typeof(p_viewers) is distinct from 'array' or jsonb_array_length(p_viewers) = 0
    then raise exception 'Pick at least one person who watched it'; end if;
  select coalesce(array_agg(user_id), '{}') into v_old from public.family_viewing_members
    where viewing_id = v.id and public.is_group_member(v.group_id, user_id);
  if (p_expected_on is not null and p_expected_on is distinct from v.watched_on)
    or (p_expected_viewers is not null and not(v_old @> p_expected_viewers and v_old <@ p_expected_viewers))
    then raise exception 'Someone changed this movie night while you were editing it'; end if;
  select array_agg(distinct x.user_id) into v_users from jsonb_to_recordset(p_viewers) x(user_id uuid, score numeric);
  select coalesce(array_agg(guest_id), '{}') into v_guests from public.family_viewing_guests where viewing_id = v.id;
  perform public.edit_family_viewing(v.id, p_watched_on, v_users, v_guests, v.revision);
  for r in select * from jsonb_to_recordset(p_viewers) x(user_id uuid, score numeric) loop
    if r.score is not null and (r.score < 1 or r.score > 10) then raise exception 'Scores must be between 1 and 10'; end if;
    if r.score is not null and not(r.user_id = any(v_old)) then
      insert into public.ratings(list_item_id, user_id, score) values(v.list_item_id, r.user_id, round(r.score, 1))
      on conflict(list_item_id, user_id) do update set score = excluded.score where public.ratings.score is null;
    end if;
  end loop;
end;
$$;

create function public.save_family_watch(
  p_item uuid, p_on date, p_members jsonb, p_guests jsonb default '[]', p_again boolean default false,
  p_night uuid default null, p_candidate uuid default null, p_media uuid default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_item uuid := p_item; v_view uuid; v_group uuid; g record; n public.movie_nights;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_note is not null and char_length(p_note) > 250 then raise exception 'Notes can be at most 250 characters'; end if;
  if jsonb_typeof(p_guests) is distinct from 'array' or jsonb_array_length(p_guests) > 10 then raise exception 'Pick at most 10 guests'; end if;
  if p_night is not null then
    n := public.movie_night_for_member(p_night);
    perform public.movie_night_require_open(n);
    select id into v_item from public.list_items where group_id = n.group_id and media_id = coalesce(p_media,
      (select media_id from public.movie_night_candidates where id = p_candidate and night_id = n.id));
    if v_item is not null and exists(select 1 from public.watches where list_item_id = v_item) then
      perform public.archive_family_viewing(v_item);
    end if;
    if p_candidate is not null then v_item := public.pick_movie_night_card(p_night, p_candidate, p_on, p_members);
    else v_item := public.pick_movie_night_title(p_night, p_media, p_on, p_members); end if;
    select viewing_id into v_view from public.movie_nights where id = p_night;
  else
    if p_again then perform public.watched_again(v_item, p_on, p_members);
    else perform public.log_watch(v_item, p_on, p_members); end if;
    select id into v_view from public.family_viewings where list_item_id = v_item and watched_on is not distinct from p_on
      order by created_at desc, id desc limit 1;
  end if;
  select group_id into v_group from public.family_viewings where id = v_view;
  if v_view is null or not public.is_group_member(v_group, auth.uid()) then raise exception 'This viewing is not available'; end if;
  perform public.check_viewing_guests(v_view, array(select guest_id from jsonb_to_recordset(p_guests) x(guest_id uuid)));
  delete from public.family_viewing_guests where viewing_id = v_view
    and guest_id not in(select guest_id from jsonb_to_recordset(p_guests) x(guest_id uuid));
  for g in select * from jsonb_to_recordset(p_guests) x(guest_id uuid, score numeric) loop
    if not exists(select 1 from public.family_guests where id = g.guest_id and group_id = v_group and account_id is null)
      then raise exception 'Only guests from this family can be added'; end if;
    insert into public.family_viewing_guests values(v_view, g.guest_id) on conflict do nothing;
    if g.score is not null then perform public.set_guest_rating(v_item, g.guest_id, g.score); end if;
  end loop;
  if p_note is not null and exists(select 1 from jsonb_to_recordset(p_members) x(user_id uuid) where user_id = auth.uid()) then
    if nullif(btrim(p_note), '') is not null then
      insert into public.ratings(list_item_id, user_id, comment) values(v_item, auth.uid(), btrim(p_note))
      on conflict(list_item_id, user_id) do update set comment = excluded.comment, updated_at = now();
    else update public.ratings set comment = null where list_item_id = v_item and user_id = auth.uid(); end if;
  end if;
  return jsonb_build_object('item_id', v_item, 'viewing_id', v_view);
end;
$$;

create function public.family_viewing_details(p_viewing uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.family_viewings;
begin
  select * into v from public.family_viewings where id = p_viewing;
  if not found or not public.is_group_member(v.group_id, auth.uid()) then raise exception 'This viewing is not available'; end if;
  return jsonb_build_object(
    'viewingId', v.id, 'groupId', v.group_id, 'itemId', v.list_item_id, 'watchedOn', v.watched_on, 'revision', v.revision,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
      order by p.display_name), '[]') from public.group_members gm join public.profiles p on p.id = gm.user_id where gm.group_id = v.group_id),
    'viewerIds', (select coalesce(jsonb_agg(user_id), '[]') from public.family_viewing_members where viewing_id = v.id and public.is_group_member(v.group_id, user_id)),
    'guestIds', (select coalesce(jsonb_agg(guest_id), '[]') from public.family_viewing_guests where viewing_id = v.id),
    'lockedIds', (select coalesce(jsonb_agg(user_id), '[]') from public.family_viewing_members
      where viewing_id = v.id and public.watcher_has_own_state(v.list_item_id, user_id)),
    'ratings', (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('profiles', to_jsonb(p))), '[]')
      from public.ratings r left join public.profiles p on p.id = r.user_id where r.list_item_id = v.list_item_id)
  );
end;
$$;

create table public.guest_invitations (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.family_guests(id) on delete cascade,
  night_id uuid references public.movie_nights(id) on delete cascade,
  token_hash bytea not null unique,
  purpose text not null check(purpose in ('night', 'account')),
  created_by uuid references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '24 hours',
  consumed_by uuid references public.profiles(id) on delete cascade,
  imported_viewings integer not null default 0,
  imported_scores integer not null default 0,
  revoked_at timestamptz,
  check ((purpose = 'night') = (night_id is not null))
);
create index guest_invitations_guest_idx on public.guest_invitations(guest_id);
create index guest_invitations_night_idx on public.guest_invitations(night_id);
create index guest_invitations_creator_idx on public.guest_invitations(created_by);
create index guest_invitations_consumer_idx on public.guest_invitations(consumed_by);
alter table public.guest_invitations enable row level security;

create function public.create_guest_invitation(p_guest uuid, p_night uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare g public.family_guests; n public.movie_nights; v_token text;
begin
  select * into g from public.family_guests where id = p_guest for update;
  if not found or g.account_id is not null or not public.is_group_member(g.group_id, auth.uid()) then raise exception 'This guest is not available'; end if;
  perform public.hit_rate_limit(auth.uid(), 'guest_invitation', 60, 3600);
  if p_night is not null then
    n := public.movie_night_for_member(p_night);
    perform public.movie_night_require_open(n);
    if n.group_id <> g.group_id then raise exception 'This guest is not in this family'; end if;
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.guest_invitations(guest_id, night_id, token_hash, purpose, created_by)
  values(g.id, p_night, sha256(convert_to(v_token, 'UTF8')), case when p_night is null then 'account' else 'night' end, auth.uid());
  return v_token;
end;
$$;

create function public.revoke_guest_invitations(p_guest uuid, p_night uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.family_guests g where g.id = p_guest and public.is_group_member(g.group_id, auth.uid()))
    then raise exception 'This guest is not available'; end if;
  update public.guest_invitations set revoked_at = now() where guest_id = p_guest and night_id is not distinct from p_night;
end;
$$;

alter function public.guest_link_info(text) rename to generic_guest_link_info;
create function public.guest_link_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.guest_invitations; g public.family_guests; n public.movie_nights;
begin
  select * into i from public.guest_invitations where token_hash = sha256(convert_to(p_token, 'UTF8'))
    and purpose = 'night' and revoked_at is null and expires_at > now();
  if not found then return public.generic_guest_link_info(p_token); end if;
  select * into g from public.family_guests where id = i.guest_id;
  perform public.settle_movie_night(i.night_id);
  select * into n from public.movie_nights where id = i.night_id;
  if n.status <> 'open' or g.account_id is not null or not exists(select 1 from public.group_members where group_id = g.group_id and user_id = i.created_by) then return '{"open":false}'::jsonb; end if;
  return jsonb_build_object('open', true, 'night_id', n.id, 'family_name', (select name from public.groups where id = n.group_id),
    'guest_name', g.name, 'full', (select count(*) >= 10 from public.movie_night_guests where night_id = n.id));
end;
$$;

alter function public.guest_join(text, text) rename to generic_guest_join;
create function public.guest_join(p_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.guest_invitations; g public.family_guests; v_night uuid; v_name text;
  v_secret text; v_session uuid; v_result jsonb;
begin
  select * into i from public.guest_invitations where token_hash = sha256(convert_to(p_token, 'UTF8'))
    and purpose = 'night' and revoked_at is null and expires_at > now();
  if found then
    select * into g from public.family_guests where id = i.guest_id for update;
    if g.account_id is not null or not exists(select 1 from public.group_members where group_id = g.group_id and user_id = i.created_by) then raise exception 'This invitation is no longer available'; end if;
    perform public.settle_movie_night(i.night_id);
    perform 1 from public.movie_nights where id = i.night_id and status = 'open' for update;
    if not found then raise exception 'This movie night is over'; end if;
    if exists(select 1 from public.movie_night_guests where night_id = i.night_id and profile_id = g.id) then
      raise exception 'This guest has already joined. Continue in the original browser or ask the family for help';
    end if;
    if (select count(*) from public.movie_night_guests where night_id = i.night_id) >= 10 then raise exception 'This movie night has all the guests it can take'; end if;
    v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.movie_night_guests(night_id, name, secret_hash, profile_id)
      values(i.night_id, g.name, sha256(convert_to(v_secret, 'UTF8')), g.id) returning id into v_session;
    update public.movie_nights set last_activity_at = now() where id = i.night_id;
    return jsonb_build_object('secret', v_secret, 'guest_id', v_session, 'night_id', i.night_id);
  end if;
  v_night := public.guest_link_night(p_token);
  if v_night is null then raise exception 'This movie night is over'; end if;
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if exists(select 1 from public.family_guests fg join public.movie_nights n on n.group_id = fg.group_id
    where n.id = v_night and lower(fg.name) = lower(v_name)) then
    raise exception 'That name is taken in this family. Ask for a returning-guest invitation, or add an initial if you are a different person';
  end if;
  v_result := public.generic_guest_join(p_token, p_name);
  insert into public.family_guests(group_id, name)
    select group_id, v_name from public.movie_nights where id = v_night returning * into g;
  update public.movie_night_guests set profile_id = g.id where id = (v_result->>'guest_id')::uuid;
  return v_result;
exception when unique_violation then
  raise exception 'That name is taken in this family. Ask for a returning-guest invitation or add an initial';
end;
$$;

create function public.guest_account_invitation(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('valid', true, 'name', g.name, 'family', f.name)
    from public.guest_invitations i join public.family_guests g on g.id = i.guest_id join public.groups f on f.id = g.group_id
    where i.token_hash = sha256(convert_to(p_token, 'UTF8')) and i.purpose = 'account' and i.revoked_at is null
      and i.expires_at > now() and i.consumed_by is null and g.account_id is null
      and exists(select 1 from public.group_members where group_id = g.group_id and user_id = i.created_by)),
    '{"valid":false}'::jsonb);
$$;

create function public.claim_family_guest(p_token text) returns jsonb
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

create function public.guest_claim_result(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('familyId', g.group_id, 'familyName',
    case when public.is_group_member(g.group_id, auth.uid()) then f.name else 'your former family' end,
    'viewings', i.imported_viewings, 'scores', i.imported_scores, 'alreadyLinked', true)
    from public.guest_invitations i join public.family_guests g on g.id = i.guest_id
    join public.groups f on f.id = g.group_id
    where i.token_hash = sha256(convert_to(p_token, 'UTF8')) and i.purpose = 'account'
      and i.consumed_by = auth.uid() and g.account_id = auth.uid();
$$;

create function public.merge_family_guests(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.family_guests; target public.family_guests;
begin
  if p_from = p_into then raise exception 'Select two different guests'; end if;
  perform 1 from public.family_guests where id in(p_from, p_into) order by id for update;
  select * into g from public.family_guests where id = p_from;
  select * into target from public.family_guests where id = p_into;
  if g.group_id is distinct from target.group_id or not public.is_group_member(g.group_id, auth.uid())
    or g.account_id is not null or target.account_id is not null then raise exception 'These guests are not available'; end if;
  if exists(select 1 from public.movie_night_guests a join public.movie_night_guests b on b.night_id = a.night_id
    where a.profile_id = p_from and b.profile_id = p_into) then raise exception 'Both profiles voted in the same night. Correct attendance on that night instead'; end if;
  update public.family_viewings set revision = revision + 1 where id in (
    select viewing_id from public.family_viewing_guests where guest_id in(p_from, p_into)
  );
  update public.movie_night_guests set profile_id = p_into, name = target.name where profile_id = p_from;
  insert into public.family_viewing_guests select viewing_id, p_into from public.family_viewing_guests where guest_id = p_from on conflict do nothing;
  insert into public.guest_ratings(list_item_id, guest_id, score, rated_by, updated_at)
    select list_item_id, p_into, score, rated_by, updated_at from public.guest_ratings where guest_id = p_from on conflict do nothing;
  delete from public.family_guests where id = p_from;
end;
$$;

alter function public.movie_night_state_for(uuid, boolean, uuid, boolean) rename to movie_night_state_base;
create function public.movie_night_state_for(p_night uuid, p_full boolean, p_voter uuid, p_guest boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb; n public.movie_nights; v_members jsonb;
begin
  result := public.movie_night_state_base(p_night, p_full, p_voter, p_guest);
  select * into n from public.movie_nights where id = p_night;
  result := jsonb_set(result, '{night}', (result->'night') || jsonb_build_object(
    'viewing_id', n.viewing_id, 'revision', (select revision from public.family_viewings where id = n.viewing_id),
    'can_undo', not p_guest and public.movie_night_undo_problem(n) is null
      and exists(select 1 from public.watches where viewing_id = n.viewing_id)
      and not exists(select 1 from public.watches where list_item_id = n.picked_list_item_id and viewing_id is distinct from n.viewing_id)));
  select coalesce(jsonb_agg(person), '[]') into v_members from (
    select case when (m->>'guest')::boolean then m || jsonb_build_object(
      'profile_id', s.profile_id, 'name', coalesce(profile.name, m->>'name'),
      'watched', exists(select 1 from public.family_viewing_guests a
        where a.viewing_id = n.viewing_id and a.guest_id = s.profile_id)) else m end person
    from jsonb_array_elements(result->'members') m left join public.movie_night_guests s on s.id = (m->>'user_id')::uuid
    left join public.family_guests profile on profile.id = s.profile_id
    union all
    select jsonb_build_object('user_id', g.id, 'profile_id', g.id, 'name', g.name, 'avatar_url', null,
      'guest', true, 'joined', false, 'watched', true, 'stacks', '[]'::jsonb)
      from public.family_viewing_guests a join public.family_guests g on g.id = a.guest_id
      where a.viewing_id = n.viewing_id and g.account_id is null
        and not exists(select 1 from public.movie_night_guests s where s.night_id = n.id and s.profile_id = g.id)
  ) people;
  return jsonb_set(result, '{members}', v_members);
end;
$$;

create or replace function public.movie_night_guest_names(p_nights uuid[]) returns table(night_id uuid, name text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if cardinality(p_nights) > 50 then raise exception 'That is too many movie nights at once'; end if;
  return query
    select people.night_id, people.name from (
    select n.id as night_id, g.name from public.movie_nights n join public.family_viewing_guests a on a.viewing_id = n.viewing_id
      join public.family_guests g on g.id = a.guest_id
      where n.id = any(p_nights) and n.status = 'closed' and g.account_id is null and public.is_group_member(n.group_id, auth.uid())
    union all
    select n.id, s.name from public.movie_nights n join public.movie_night_guests s on s.night_id = n.id
      where n.id = any(p_nights) and n.status <> 'closed' and public.is_group_member(n.group_id, auth.uid())
    ) people order by people.night_id, lower(people.name), people.name;
end;
$$;

create or replace function public.react_to_score() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_setting('famflix.importing_guest', true) = 'on'
    or new.score is null or new.rated_by is distinct from new.user_id then return null; end if;
  if tg_op = 'UPDATE' and new.score is not distinct from old.score and new.rated_by is not distinct from old.rated_by then return null; end if;
  if new.score > 7 or new.score < 6 then
    insert into public.reactions(list_item_id, user_id, value)
    values(new.list_item_id, new.user_id, case when new.score > 7 then 'like' else 'dislike' end)
    on conflict(list_item_id, user_id) do update set value = excluded.value;
  end if;
  return null;
end;
$$;

alter function public.delete_movie_night(uuid, boolean) rename to delete_movie_night_base;
create function public.delete_movie_night(p_night uuid, p_undo_watch boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare n public.movie_nights; v_problem text;
begin
  n := public.movie_night_for_member(p_night);
  if p_undo_watch then
    perform 1 from public.list_items where id = n.picked_list_item_id for update;
    perform 1 from public.watches where list_item_id = n.picked_list_item_id order by user_id for update;
    select * into n from public.movie_nights where id = p_night for update;
    if not exists(select 1 from public.watches where viewing_id = n.viewing_id)
      or exists(select 1 from public.watches where list_item_id = n.picked_list_item_id and viewing_id is distinct from n.viewing_id)
      then raise exception 'This is an earlier viewing: only its latest viewing can be undone'; end if;
    v_problem := public.movie_night_undo_problem(n);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end if;
  perform public.delete_movie_night_base(p_night, p_undo_watch);
  if p_undo_watch then
    delete from public.family_viewing_guests where viewing_id = n.viewing_id;
    delete from public.family_viewing_members where viewing_id = n.viewing_id;
  end if;
end;
$$;

revoke all on function public.delete_movie_night(uuid, boolean), public.delete_movie_night_base(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_movie_night(uuid, boolean) to authenticated;

alter function public.export_my_data() rename to export_my_data_base;
create function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb; v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'You must be signed in'; end if;
  result := public.export_my_data_base();
  result := jsonb_set(result, '{not_included,1}', to_jsonb('Other people''s guest profiles and votes, and invitation links. Your own viewing companions and linked guest votes are included.'::text));
  result := jsonb_set(result, '{my_list}', (
    select coalesce(jsonb_agg(entry || jsonb_build_object('viewing_id', li.source_viewing_id)), '[]')
    from jsonb_array_elements(result->'my_list') entry
    left join public.media m on m.tmdb_id = (entry->>'tmdb_id')::integer and m.media_type = entry->>'type'
    left join public.list_items li on li.media_id = m.id and li.group_id is null and li.added_by = v_me
  ));
  result := jsonb_set(result, '{watch_history}', (
    select coalesce(jsonb_agg(jsonb_build_object('title', m.title, 'type', m.media_type, 'tmdb_id', m.tmdb_id,
      'year', m.release_year, 'watched_on', h.watched_on, 'viewing_id', h.viewing_id,
      'family', case when public.is_group_member(h.group_id, v_me) then g.name end)
      order by h.watched_on, m.title), '[]')
    from public.watch_history h join public.media m on m.id = h.media_id left join public.groups g on g.id = h.group_id
    where h.user_id = v_me
  ));
  return result || jsonb_build_object(
    'family_viewings', (
      select coalesce(jsonb_agg(jsonb_build_object('viewing_id', v.id, 'title', m.title, 'type', m.media_type,
        'tmdb_id', m.tmdb_id, 'year', m.release_year, 'watched_on', v.watched_on,
        'family', case when public.is_group_member(v.group_id, v_me) then g.name end,
        'score', r.score, 'note', r.comment,
        'people', case when public.is_group_member(v.group_id, v_me) then (
          select coalesce(jsonb_agg(name order by name), '[]') from (
            select p.display_name name from public.family_viewing_members a join public.profiles p on p.id = a.user_id
              where a.viewing_id = v.id and p.id <> v_me
            union all
            select fg.name || ' (guest)' from public.family_viewing_guests a join public.family_guests fg on fg.id = a.guest_id
              where a.viewing_id = v.id and fg.account_id is null
          ) companions
        ) else '[]'::jsonb end) order by v.watched_on, v.id), '[]')
      from public.family_viewings v join public.family_viewing_members a on a.viewing_id = v.id and a.user_id = v_me
      join public.media m on m.id = v.media_id left join public.groups g on g.id = v.group_id
      left join public.ratings r on r.list_item_id = v.list_item_id and r.user_id = v_me
    ),
    'my_guest_votes', (
      select coalesce(jsonb_agg(jsonb_build_object('night_id', n.id, 'title', m.title, 'vote', vote.vote, 'voted_at', vote.voted_at,
        'family', case when public.is_group_member(n.group_id, v_me) then f.name end)), '[]')
      from public.family_guests fg join public.movie_night_guests s on s.profile_id = fg.id
      join public.movie_night_guest_votes vote on vote.guest_id = s.id
      join public.movie_night_candidates c on c.id = vote.candidate_id join public.media m on m.id = c.media_id
      join public.movie_nights n on n.id = c.night_id join public.groups f on f.id = n.group_id
      where fg.account_id = v_me
    )
  );
end;
$$;
revoke all on function public.export_my_data(), public.export_my_data_base() from public, anon, authenticated, service_role;
grant execute on function public.export_my_data() to authenticated;

revoke all on public.guest_invitations from anon, authenticated, service_role;
grant select, insert, update, delete on public.guest_invitations to service_role;
revoke all on function public.save_family_watch(uuid, date, jsonb, jsonb, boolean, uuid, uuid, uuid, text),
  public.family_viewing_details(uuid), public.create_guest_invitation(uuid, uuid),
  public.revoke_guest_invitations(uuid, uuid), public.guest_account_invitation(text), public.claim_family_guest(text),
  public.guest_claim_result(text),
  public.merge_family_guests(uuid, uuid), public.generic_guest_join(text, text), public.generic_guest_link_info(text),
  public.guest_join(text, text), public.guest_link_info(text),
  public.movie_night_state_for(uuid, boolean, uuid, boolean), public.movie_night_state_base(uuid, boolean, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_family_watch(uuid, date, jsonb, jsonb, boolean, uuid, uuid, uuid, text),
  public.family_viewing_details(uuid), public.create_guest_invitation(uuid, uuid),
  public.revoke_guest_invitations(uuid, uuid), public.claim_family_guest(text), public.merge_family_guests(uuid, uuid) to authenticated;
grant execute on function public.guest_claim_result(text) to authenticated;
grant execute on function public.guest_account_invitation(text), public.guest_join(text, text), public.guest_link_info(text) to service_role;

revoke all on public.family_viewings, public.family_viewing_members, public.family_guests,
  public.family_viewing_guests, public.guest_ratings from anon, authenticated, service_role;
grant select on public.family_viewings, public.family_viewing_members, public.family_guests,
  public.family_viewing_guests, public.guest_ratings to authenticated;
grant select, insert, update, delete on public.family_viewings, public.family_viewing_members, public.family_guests,
  public.family_viewing_guests, public.guest_ratings to service_role;
revoke all on function public.can_see_viewing(uuid), public.movie_night_undo_problem(public.movie_nights),
  public.save_family_guest(uuid, text, uuid), public.set_guest_rating(uuid, uuid, numeric),
  public.edit_family_viewing(uuid, date, uuid[], uuid[], integer) from public, anon, authenticated, service_role;
grant execute on function public.can_see_viewing(uuid), public.save_family_guest(uuid, text, uuid),
  public.set_guest_rating(uuid, uuid, numeric), public.edit_family_viewing(uuid, date, uuid[], uuid[], integer) to authenticated;
revoke all on function public.movie_night_edit_problem(public.movie_nights) from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
