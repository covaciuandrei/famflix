-- ============================================================================
--  FamFlix — "watched together": who saw a family title, scores filled in on
--  someone's behalf, and the rating requests that follow.
--  Run this after 0001_init.sql.
-- ============================================================================

-- Joining a family must go through join_group(), which checks the invite code.
drop policy if exists gm_insert_self on public.group_members;

-- ---------------------------------------------------------------------------
--  Scores filled in on someone's behalf
-- ---------------------------------------------------------------------------

-- No foreign key: a second ratings -> profiles link would make the app's profiles() embed ambiguous.
alter table public.ratings add column if not exists rated_by uuid;

-- rated_by always records who really wrote the row, so it can't be faked.
create or replace function public.set_rated_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.rated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists ratings_set_rated_by on public.ratings;
create trigger ratings_set_rated_by
  before insert or update on public.ratings
  for each row execute function public.set_rated_by();

-- ---------------------------------------------------------------------------
--  Who has watched a family-list title
-- ---------------------------------------------------------------------------

-- Own id key (like ratings) so PostgREST doesn't treat this as a list_items <-> profiles join table.
create table if not exists public.watches (
  id           uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  watched_on   date not null default current_date,
  logged_by    uuid references public.profiles (id) on delete set null,
  skipped_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (list_item_id, user_id)
);
create index if not exists watches_user_idx on public.watches (user_id);

alter table public.watches enable row level security;

create policy watches_select on public.watches for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id
      and li.group_id is not null
      and public.is_group_member(li.group_id, auth.uid())
  )
);
create policy watches_update_own on public.watches for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy watches_delete_own on public.watches for delete
  using (user_id = auth.uid());

-- People may only skip their own request; all other writes go through log_watch().
revoke insert, update on public.watches from anon, authenticated;
grant update (skipped_at) on public.watches to authenticated;

-- ---------------------------------------------------------------------------
--  Log a "watched together" for a family-list title
--  p_viewers: [{"user_id": "<uuid>", "score": 1-10 or null}, ...]
-- ---------------------------------------------------------------------------

create or replace function public.log_watch(
  p_item uuid,
  p_watched_on date,
  p_viewers jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select group_id into v_group from public.list_items where id = p_item;
  if v_group is null or not public.is_group_member(v_group, auth.uid()) then
    raise exception 'This title is not on one of your family lists';
  end if;

  -- One day of slack: the browser's "today" can be ahead of the server's (UTC).
  if p_watched_on is null or p_watched_on > current_date + 1 then
    raise exception 'Pick a date that is not in the future';
  end if;

  if jsonb_typeof(p_viewers) is distinct from 'array'
     or jsonb_array_length(p_viewers) = 0 then
    raise exception 'Pick at least one person who watched it';
  end if;

  for v in
    select x.user_id, x.score
    from jsonb_to_recordset(p_viewers) as x(user_id uuid, score int)
  loop
    if v.user_id is null or not public.is_group_member(v_group, v.user_id) then
      raise exception 'Only members of this family can be added';
    end if;
    if v.score is not null and (v.score < 1 or v.score > 10) then
      raise exception 'Scores must be between 1 and 10';
    end if;

    insert into public.watches as w (list_item_id, user_id, watched_on, logged_by)
    values (p_item, v.user_id, p_watched_on, auth.uid())
    on conflict (list_item_id, user_id) do update
      set watched_on = greatest(w.watched_on, excluded.watched_on),
          logged_by = excluded.logged_by;

    -- Only fills in a missing score; never overwrites one that already exists.
    if v.score is not null then
      insert into public.ratings as r (list_item_id, user_id, score)
      values (p_item, v.user_id, v.score)
      on conflict (list_item_id, user_id) do update
        set score = excluded.score, updated_at = now()
        where r.score is null;
    end if;
  end loop;

  update public.list_items
  set status = 'watched', watched_at = now()
  where id = p_item and status <> 'watched';
end;
$$;

-- ---------------------------------------------------------------------------
--  The caller's open rating requests: family titles they were marked as
--  having watched, but haven't rated (score or note) or skipped yet.
-- ---------------------------------------------------------------------------

create or replace function public.pending_rating_requests()
returns table (
  list_item_id   uuid,
  group_name     text,
  watched_on     date,
  logged_by      uuid,
  logged_by_name text,
  media_type     text,
  tmdb_id        integer,
  title          text,
  release_year   integer,
  poster_path    text
)
language sql
stable
security invoker
set search_path = public
as $$
  select w.list_item_id, g.name, w.watched_on, w.logged_by, p.display_name,
         m.media_type, m.tmdb_id, m.title, m.release_year, m.poster_path
  from public.watches w
  join public.list_items li on li.id = w.list_item_id
  join public.groups g on g.id = li.group_id
  join public.media m on m.id = li.media_id
  left join public.profiles p on p.id = w.logged_by
  where w.user_id = auth.uid()
    and w.skipped_at is null
    and public.is_group_member(li.group_id, auth.uid())
    and not exists (
      select 1 from public.ratings r
      where r.list_item_id = w.list_item_id and r.user_id = auth.uid()
    )
  order by w.watched_on desc, w.created_at desc;
$$;

revoke execute on function public.log_watch(uuid, date, jsonb) from public, anon;
grant execute on function public.log_watch(uuid, date, jsonb) to authenticated;
revoke execute on function public.pending_rating_requests() from public, anon;
grant execute on function public.pending_rating_requests() to authenticated;
