-- ============================================================================
--  FamFlix — initial schema, security policies and helper functions
--  Run this in the Supabase SQL editor (or via `supabase db push`).
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------------

-- Public mirror of auth.users. One row is created automatically per new user.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- A "family"/circle. Users create or join one via its invite code.
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Membership of a user in a group.
create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Cached TMDB metadata (shared across all users).
create table if not exists public.media (
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
create table if not exists public.list_items (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups (id) on delete cascade,
  added_by   uuid not null references public.profiles (id) on delete cascade,
  media_id   uuid not null references public.media (id) on delete cascade,
  status     text not null default 'want' check (status in ('want', 'watched')),
  created_at timestamptz not null default now(),
  watched_at timestamptz
);

-- Prevent duplicates within a single list.
create unique index if not exists list_items_personal_uniq
  on public.list_items (added_by, media_id)
  where group_id is null;
create unique index if not exists list_items_shared_uniq
  on public.list_items (group_id, media_id)
  where group_id is not null;

create index if not exists list_items_group_idx on public.list_items (group_id);
create index if not exists list_items_added_by_idx on public.list_items (added_by);
create index if not exists list_items_created_idx on public.list_items (created_at desc);

-- A user's score and/or written note for a list item.
create table if not exists public.ratings (
  id           uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  score        integer check (score between 1 and 10),
  comment      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (list_item_id, user_id)
);
create index if not exists ratings_item_idx on public.ratings (list_item_id);

-- A user's like/dislike on a list item.
create table if not exists public.reactions (
  id           uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  value        text not null check (value in ('like', 'dislike')),
  created_at   timestamptz not null default now(),
  unique (list_item_id, user_id)
);
create index if not exists reactions_item_idx on public.reactions (list_item_id);

-- ---------------------------------------------------------------------------
--  Helper functions (SECURITY DEFINER => bypass RLS to avoid recursion)
-- ---------------------------------------------------------------------------

create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid and gm.user_id = uid
  );
$$;

create or replace function public.shares_group(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members x
    join public.group_members y on x.group_id = y.group_id
    where x.user_id = a and y.user_id = b
  );
$$;

-- Create a group and add the caller as its owner. Returns the new group.
create or replace function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g    public.groups;
  code text;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Group name is required';
  end if;

  code := upper(substr(md5(gen_random_uuid()::text), 1, 6));

  insert into public.groups (name, invite_code, created_by)
  values (trim(p_name), code, auth.uid())
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, auth.uid(), 'owner');

  return g;
end;
$$;

-- Join an existing group by invite code. Returns the group id.
create or replace function public.join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  g_id uuid;
begin
  select id into g_id
  from public.groups
  where invite_code = upper(trim(p_invite_code));

  if g_id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (g_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;

  return g_id;
end;
$$;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;

-- Automatically create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.media         enable row level security;
alter table public.list_items    enable row level security;
alter table public.ratings       enable row level security;
alter table public.reactions     enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_group(auth.uid(), id));
create policy profiles_insert_self on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- groups --------------------------------------------------------------------
create policy groups_select_member on public.groups for select
  using (public.is_group_member(id, auth.uid()));
create policy groups_insert_own on public.groups for insert
  with check (created_by = auth.uid());
create policy groups_update_creator on public.groups for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy groups_delete_creator on public.groups for delete
  using (created_by = auth.uid());

-- group_members -------------------------------------------------------------
create policy gm_select on public.group_members for select
  using (public.is_group_member(group_id, auth.uid()));
create policy gm_insert_self on public.group_members for insert
  with check (user_id = auth.uid());
create policy gm_delete_self on public.group_members for delete
  using (user_id = auth.uid());

-- media (shared cache, readable + writable by any signed-in user) -----------
create policy media_select_authed on public.media for select
  using (auth.uid() is not null);
create policy media_insert_authed on public.media for insert
  with check (auth.uid() is not null);
create policy media_update_authed on public.media for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- list_items ----------------------------------------------------------------
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
create policy li_delete on public.list_items for delete using (
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
create policy ratings_insert_own on public.ratings for insert
  with check (user_id = auth.uid());
create policy ratings_update_own on public.ratings for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
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
  with check (user_id = auth.uid());
create policy reactions_update_own on public.reactions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reactions_delete_own on public.reactions for delete
  using (user_id = auth.uid());
