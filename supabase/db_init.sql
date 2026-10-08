-- ============================================================================
--  FamFlix — the whole database in one script: tables, row-level security,
--  functions and triggers. Same result as the old migrations 0001–0006.
--  For an EMPTY Supabase database only: SQL Editor → paste → Run, once.
--  All or nothing: if anything fails (say, the tables already exist), nothing changes.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------------

-- Public mirror of auth.users. One row is created automatically per new user.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- A "family"/circle. Users create or join one via its invite code.
create table public.groups (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  invite_code            text not null unique,
  created_by             uuid not null references public.profiles (id) on delete cascade,
  created_at             timestamptz not null default now(),
  -- Codes last 24 hours, then refresh_invite_codes() replaces them.
  invite_code_expires_at timestamptz not null default now() + interval '24 hours'
);

-- Membership of a user in a group.
create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Cached TMDB metadata (shared across all users).
create table public.media (
  id            uuid primary key default gen_random_uuid(),
  tmdb_id       integer not null,
  media_type    text not null check (media_type in ('movie', 'tv')),
  title         text not null,
  release_year  integer,
  poster_path   text,
  backdrop_path text,
  overview      text,
  tmdb_rating   numeric,
  runtime       integer,
  genres        jsonb not null default '[]'::jsonb,
  trailer_key   text,
  updated_at    timestamptz not null default now(),
  unique (tmdb_id, media_type)
);

-- An entry in a watchlist. group_id NULL => personal list owned by added_by.
create table public.list_items (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups (id) on delete cascade,
  added_by   uuid not null references public.profiles (id) on delete cascade,
  media_id   uuid not null references public.media (id) on delete cascade,
  status     text not null default 'want' check (status in ('want', 'watched')),
  created_at timestamptz not null default now(),
  watched_at timestamptz,
  -- Removing a title only hides it, so it can be restored.
  deleted_at timestamptz,
  -- No foreign key: a second list_items -> profiles link would make the app's profiles() embed ambiguous.
  deleted_by uuid
);

-- Prevent duplicates within a single list.
create unique index list_items_personal_uniq
  on public.list_items (added_by, media_id)
  where group_id is null;
create unique index list_items_shared_uniq
  on public.list_items (group_id, media_id)
  where group_id is not null;

create index list_items_group_idx on public.list_items (group_id);
create index list_items_added_by_idx on public.list_items (added_by);
create index list_items_created_idx on public.list_items (created_at desc);

-- A user's score and/or written note for a list item.
create table public.ratings (
  id           uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- numeric(3,1) rounds anything finer to one decimal (6.7, 8.5, ...).
  score        numeric(3,1) check (score between 1 and 10),
  comment      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- No foreign key: a second ratings -> profiles link would make the app's profiles() embed ambiguous.
  rated_by     uuid,
  unique (list_item_id, user_id)
);
create index ratings_item_idx on public.ratings (list_item_id);

-- A user's like/dislike on a list item.
create table public.reactions (
  id           uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  value        text not null check (value in ('like', 'dislike')),
  created_at   timestamptz not null default now(),
  unique (list_item_id, user_id)
);
create index reactions_item_idx on public.reactions (list_item_id);

-- Who has watched a family-list title.
create table public.watches (
  -- Own id key (like ratings) so PostgREST doesn't treat this as a list_items <-> profiles join table.
  id           uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  watched_on   date not null default current_date,
  logged_by    uuid references public.profiles (id) on delete set null,
  skipped_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (list_item_id, user_id)
);
create index watches_user_idx on public.watches (user_id);

-- Family activity feed. Names and titles are copied in, so history stays readable after people leave.
create table public.activity (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  actor_id     uuid,
  actor_name   text,
  kind         text not null,
  list_item_id uuid,
  media_title  text,
  subject_id   uuid,
  subject_name text,
  score        numeric(3,1),
  detail       text,
  -- clock_timestamp (not now) keeps several events from one action in order.
  created_at   timestamptz not null default clock_timestamp()
);
create index activity_group_created_idx
  on public.activity (group_id, created_at desc);

-- ---------------------------------------------------------------------------
--  Helper functions
-- ---------------------------------------------------------------------------

-- Membership checks. SECURITY DEFINER => bypass RLS to avoid recursion.
-- Anyone can call them through the API, so they only answer about the signed-in user's own families:
-- nobody can use them to find out who is in someone else's family.
create function public.is_group_member(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid and gm.user_id = uid
  )
  and (
    coalesce(uid = auth.uid(), false)
    or exists (
      select 1 from public.group_members me
      where me.group_id = gid and me.user_id = auth.uid()
    )
  );
$$;

create function public.shares_group(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.uid() in (a, b), false)
    and exists (
      select 1
      from public.group_members x
      join public.group_members y on x.group_id = y.group_id
      where x.user_id = a and y.user_id = b
    );
$$;

create function public.is_group_owner(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = uid and role = 'owner'
  );
$$;

-- True if the signed-in user can see this list item: it is on their own list or on a family list they belong to.
create function public.can_see_item(item uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.list_items li
    where li.id = item
      and (
        (li.group_id is null and li.added_by = auth.uid())
        or (li.group_id is not null and public.is_group_member(li.group_id, auth.uid()))
      )
  );
$$;

-- Invite codes: 8 characters from 32 easy-to-read symbols.
create function public.new_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw bytea := uuid_send(gen_random_uuid());
  code text := '';
  i int;
begin
  -- Skips bytes 6 and 8, which hold the UUID's fixed version/variant bits.
  foreach i in array array[0, 1, 2, 3, 4, 5, 7, 9] loop
    code := code || substr(alphabet, 1 + get_byte(raw, i) % 32, 1);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
--  Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.media         enable row level security;
alter table public.list_items    enable row level security;
alter table public.ratings       enable row level security;
alter table public.reactions     enable row level security;
alter table public.watches       enable row level security;
alter table public.activity      enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_group(auth.uid(), id));
create policy profiles_insert_self on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- groups + group_members: read-only here; they change only through the family functions below.
create policy groups_select_member on public.groups for select
  using (public.is_group_member(id, auth.uid()));
create policy gm_select on public.group_members for select
  using (public.is_group_member(group_id, auth.uid()));

-- media (shared cache of TMDB data): any signed-in user can read it. Nobody writes it from
-- the browser: the app's server saves it with the service-role key, which skips these rules.
create policy media_select_authed on public.media for select
  using (auth.uid() is not null);

-- list_items: no delete policy; the app never hard-deletes titles, so every removal can be undone.
create policy li_select on public.list_items for select using (
  (group_id is null and added_by = auth.uid())
  or (group_id is not null and public.is_group_member(group_id, auth.uid()))
);
create policy li_insert on public.list_items for insert with check (
  added_by = auth.uid()
  and (
    group_id is null
    or public.is_group_member(group_id, auth.uid())
  )
);
create policy li_update on public.list_items for update using (
  (group_id is null and added_by = auth.uid())
  or (group_id is not null and public.is_group_member(group_id, auth.uid()))
);

-- ratings -------------------------------------------------------------------
create policy ratings_select on public.ratings for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id
      and (
        (li.group_id is null and li.added_by = auth.uid())
        or (li.group_id is not null and public.is_group_member(li.group_id, auth.uid()))
      )
  )
);
-- Your own scores, and only on titles you can still see (not after you leave a family).
create policy ratings_insert_own on public.ratings for insert
  with check (user_id = auth.uid() and public.can_see_item(list_item_id));
create policy ratings_update_own on public.ratings for update
  using (user_id = auth.uid() and public.can_see_item(list_item_id))
  with check (user_id = auth.uid() and public.can_see_item(list_item_id));
create policy ratings_delete_own on public.ratings for delete
  using (user_id = auth.uid());

-- reactions -----------------------------------------------------------------
create policy reactions_select on public.reactions for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id
      and (
        (li.group_id is null and li.added_by = auth.uid())
        or (li.group_id is not null and public.is_group_member(li.group_id, auth.uid()))
      )
  )
);
create policy reactions_insert_own on public.reactions for insert
  with check (user_id = auth.uid() and public.can_see_item(list_item_id));
create policy reactions_update_own on public.reactions for update
  using (user_id = auth.uid() and public.can_see_item(list_item_id))
  with check (user_id = auth.uid() and public.can_see_item(list_item_id));
create policy reactions_delete_own on public.reactions for delete
  using (user_id = auth.uid());

-- watches: no insert policy; log_watch() writes these ------------------------
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

-- activity: read-only; only the triggers and functions below write it --------
create policy activity_select on public.activity for select
  using (public.is_group_member(group_id, auth.uid()));

-- ---------------------------------------------------------------------------
--  New users
-- ---------------------------------------------------------------------------

-- Automatically create a profile row when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
--  Family functions: families and memberships change only through these
-- ---------------------------------------------------------------------------

-- Create a group and add the caller as its owner. Returns the new group.
create function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Group name is required';
  end if;

  insert into public.groups (name, invite_code, created_by)
  values (trim(p_name), public.new_invite_code(), auth.uid())
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, auth.uid(), 'owner');

  return g;
end;
$$;

-- Join an existing group by invite code. Returns the group id.
create function public.join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  g_id      uuid;
  g_expires timestamptz;
begin
  select id, invite_code_expires_at into g_id, g_expires
  from public.groups
  where invite_code = upper(trim(p_invite_code));

  if g_id is null then
    raise exception 'Invalid invite code';
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

-- Members get the new code the next time they look; the app calls this before showing codes.
create function public.refresh_invite_codes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.groups g
  set invite_code = public.new_invite_code(),
      invite_code_expires_at = now() + interval '24 hours'
  where g.invite_code_expires_at <= now()
    and public.is_group_member(g.id, auth.uid());
end;
$$;

create function public.rename_group(p_group uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_owner(p_group, auth.uid()) then
    raise exception 'Only the family owner can do this';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Please enter a family name';
  end if;
  update public.groups set name = trim(p_name) where id = p_group;
end;
$$;

-- A new code also starts a new 24 hours. Only this, not the daily change, goes in the feed.
create function public.regenerate_invite_code(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.new_invite_code();
begin
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

create function public.remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- The last person out deletes the family; if the owner leaves, the longest-standing member takes over.
create function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_next uuid;
begin
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

-- ---------------------------------------------------------------------------
--  Removed titles: who removed it is recorded by the database, not the app
-- ---------------------------------------------------------------------------

create function public.set_deleted_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Neither the time nor the person can be supplied by the app, so a removal can't be backdated or blamed on someone else.
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is null then
      new.deleted_by := null;
    else
      new.deleted_at := now();
      new.deleted_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

create trigger list_items_set_deleted_by
  before update on public.list_items
  for each row execute function public.set_deleted_by();

-- ---------------------------------------------------------------------------
--  Watched together: who saw a family title, scores filled in for others, rating requests
-- ---------------------------------------------------------------------------

-- rated_by always records who really wrote the row, so it can't be faked.
create function public.set_rated_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.rated_by := auth.uid();
  return new;
end;
$$;

create trigger ratings_set_rated_by
  before insert or update on public.ratings
  for each row execute function public.set_rated_by();

-- Log who watched a family title. p_viewers: [{"user_id": "<uuid>", "score": 1-10 or null}, ...]
create function public.log_watch(
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
  v_names text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select group_id into v_group from public.list_items
  where id = p_item and deleted_at is null;
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
    select x.user_id, round(x.score, 1) as score
    from jsonb_to_recordset(p_viewers) as x(user_id uuid, score numeric)
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

  select string_agg(coalesce(p.display_name, 'someone'), ', ' order by p.display_name)
  into v_names
  from (select distinct x.user_id
        from jsonb_to_recordset(p_viewers) as x(user_id uuid)) u
  left join public.profiles p on p.id = u.user_id;

  perform public.add_activity(v_group, 'watched_together', p_item, null, null, v_names);

  perform set_config('famflix.logging_watch', 'on', true);
  update public.list_items
  set status = 'watched', watched_at = now()
  where id = p_item and status <> 'watched';
end;
$$;

-- The caller's open rating requests: titles they were marked as having watched but haven't rated or skipped.
create function public.pending_rating_requests()
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
    and li.deleted_at is null
    and public.is_group_member(li.group_id, auth.uid())
    and not exists (
      select 1 from public.ratings r
      where r.list_item_id = w.list_item_id and r.user_id = auth.uid()
    )
  order by w.watched_on desc, w.created_at desc;
$$;

-- ---------------------------------------------------------------------------
--  Activity feed: written only by these triggers and functions
-- ---------------------------------------------------------------------------

create function public.add_activity(
  p_group   uuid,
  p_kind    text,
  p_item    uuid default null,
  p_subject uuid default null,
  p_score   numeric default null,
  p_detail  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity
    (group_id, actor_id, actor_name, kind, list_item_id, media_title,
     subject_id, subject_name, score, detail)
  values (
    p_group,
    auth.uid(),
    (select display_name from public.profiles where id = auth.uid()),
    p_kind,
    p_item,
    (select m.title from public.list_items li
       join public.media m on m.id = li.media_id
     where li.id = p_item),
    p_subject,
    (select display_name from public.profiles where id = p_subject),
    p_score,
    p_detail
  );
end;
$$;

create function public.list_items_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.group_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.add_activity(new.group_id, 'added', new.id);
  elsif old.deleted_at is null and new.deleted_at is not null then
    perform public.add_activity(new.group_id, 'removed', new.id);
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform public.add_activity(new.group_id, 'restored', new.id);
  -- log_watch() writes its own "watched together" event instead.
  elsif old.status = 'want' and new.status = 'watched'
        and current_setting('famflix.logging_watch', true) is distinct from 'on' then
    perform public.add_activity(new.group_id, 'watched', new.id);
  end if;
  return null;
end;
$$;

create trigger list_items_activity
  after insert or update on public.list_items
  for each row execute function public.list_items_activity();

create function public.ratings_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
begin
  select group_id into v_group from public.list_items where id = new.list_item_id;
  if v_group is null then
    return null;
  end if;
  if (tg_op = 'INSERT'
      or new.score is distinct from old.score
      or new.comment is distinct from old.comment)
     and (new.score is not null or new.comment is not null) then
    perform public.add_activity(v_group, 'rated', new.list_item_id, new.user_id,
                                new.score, left(new.comment, 140));
  end if;
  return null;
end;
$$;

create trigger ratings_activity
  after insert or update on public.ratings
  for each row execute function public.ratings_activity();

create function public.group_members_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.add_activity(
      new.group_id, case when new.role = 'owner' then 'created' else 'joined' end);
  -- Skipped when the whole family is being deleted.
  elsif exists (select 1 from public.groups where id = old.group_id) then
    if old.user_id = auth.uid() then
      perform public.add_activity(old.group_id, 'left');
    else
      perform public.add_activity(old.group_id, 'removed_member', null, old.user_id);
    end if;
  end if;
  return null;
end;
$$;

create trigger group_members_activity
  after insert or delete on public.group_members
  for each row execute function public.group_members_activity();

-- Renames only: regenerate_invite_code() posts new codes itself, and the daily code change isn't posted.
create function public.groups_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    perform public.add_activity(new.id, 'renamed', null, null, null, new.name);
  end if;
  return null;
end;
$$;

create trigger groups_activity
  after update on public.groups
  for each row execute function public.groups_activity();

-- ---------------------------------------------------------------------------
--  Ratings → reactions: over 7 likes the title, under 6 dislikes it, 6 to 7 leaves it alone
-- ---------------------------------------------------------------------------

create function public.react_to_score()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only scores you gave yourself (not ones filled in for you), and only when the score changes,
  -- so editing just the note keeps a reaction you picked by hand.
  if new.score is null or new.rated_by is distinct from new.user_id then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.score is not distinct from old.score then
    return null;
  end if;

  if new.score > 7 or new.score < 6 then
    insert into public.reactions (list_item_id, user_id, value)
    values (new.list_item_id, new.user_id,
            case when new.score > 7 then 'like' else 'dislike' end)
    on conflict (list_item_id, user_id) do update set value = excluded.value;
  end if;
  return null;
end;
$$;

create trigger ratings_react_to_score
  after insert or update of score on public.ratings
  for each row execute function public.react_to_score();

-- ---------------------------------------------------------------------------
--  Grants: narrow Supabase's defaults (anon and authenticated may use every table and function)
-- ---------------------------------------------------------------------------

-- People may only skip their own request; all other writes go through log_watch().
revoke insert, update on public.watches from anon, authenticated;
grant update (skipped_at) on public.watches to authenticated;
-- Only the database's own triggers and functions write the feed, so events can't be faked.
revoke insert, update, delete on public.activity from anon, authenticated;
-- Everyone shares the movie info, so nobody can rewrite titles and posters for the rest; only the server saves it.
revoke insert, update, delete on public.media from anon, authenticated;
-- A list item's list, movie and author are fixed once it's added; afterwards people only mark it watched or
-- remove/restore it (the database fills in who removed it and when).
revoke insert, update on public.list_items from anon, authenticated;
grant insert (group_id, added_by, media_id, status) on public.list_items to authenticated;
grant update (status, watched_at, deleted_at) on public.list_items to authenticated;

-- Internal helpers, used only inside the functions above.
revoke execute on function public.add_activity(uuid, text, uuid, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.new_invite_code() from public, anon, authenticated;
revoke execute on function public.is_group_owner(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
revoke execute on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;
-- is_group_member() and shares_group() stay executable for everyone: the security rules call them for visitors too
-- (who then simply see nothing), and they only ever answer about the caller's own families.
-- Trigger functions only ever run as triggers (which doesn't need EXECUTE), never through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_deleted_by() from public, anon, authenticated;
revoke execute on function public.set_rated_by() from public, anon, authenticated;
revoke execute on function public.list_items_activity() from public, anon, authenticated;
revoke execute on function public.ratings_activity() from public, anon, authenticated;
revoke execute on function public.group_members_activity() from public, anon, authenticated;
revoke execute on function public.groups_activity() from public, anon, authenticated;
revoke execute on function public.react_to_score() from public, anon, authenticated;

-- Signed-in users only.
revoke execute on function public.refresh_invite_codes() from public, anon;
grant execute on function public.refresh_invite_codes() to authenticated;
revoke execute on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;
revoke execute on function public.regenerate_invite_code(uuid) from public, anon;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
revoke execute on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;
revoke execute on function public.log_watch(uuid, date, jsonb) from public, anon;
grant execute on function public.log_watch(uuid, date, jsonb) to authenticated;
revoke execute on function public.pending_rating_requests() from public, anon;
grant execute on function public.pending_rating_requests() to authenticated;
revoke execute on function public.can_see_item(uuid) from public, anon;
grant execute on function public.can_see_item(uuid) to authenticated;

-- Let the Supabase API pick up the new tables and functions right away.
notify pgrst, 'reload schema';

commit;
