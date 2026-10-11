-- ============================================================================
--  FamFlix — the whole database in one script: tables, row-level security,
--  functions and triggers (families and lists, ratings, watched together, series
--  episodes, the activity feed, rate limits, movie nights and their guests) and,
--  at the end, exactly what each Supabase role may do with them.
--  For an EMPTY Supabase database only: SQL Editor → paste → Run, once.
--  All or nothing: if anything fails (say, the tables already exist), nothing changes.
--  It doesn't count on Supabase's default privileges, so it also works where new
--  tables and functions aren't handed to the API automatically (every new project
--  since 30 May 2026, every project from 30 October 2026). See "Grants" at the end.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------------

-- Public mirror of auth.users. One row is created automatically per new user.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 250),
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- A "family"/circle. Users create or join one via its invite code.
create table public.groups (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(name) <= 250),
  invite_code            text not null unique,
  -- Null once the person who created it has deleted their account; the family carries on.
  created_by             uuid references public.profiles (id) on delete set null,
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
create index group_members_user_idx on public.group_members (user_id);
create index groups_created_by_idx on public.groups (created_by);

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
  -- A series' seasons and how far it has aired, from TMDB: {"status": "Ended", "seasons": [{"n": 1, "episodes": 10}],
  -- "last_aired": {"s": 1, "e": 10} or null, "next_air": "2026-10-18" or null}. Regular seasons only (no specials).
  -- Written only by the server, like the rest of this table; null for a movie, or a series not saved with it yet.
  series        jsonb,
  unique (tmdb_id, media_type),
  constraint media_series_shape check (
    series is null
    or (media_type = 'tv' and jsonb_typeof(series) = 'object' and coalesce(jsonb_typeof(series -> 'seasons') = 'array', false))
  )
);

-- An entry in a watchlist. group_id NULL => personal list owned by added_by.
create table public.list_items (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups (id) on delete cascade,
  -- Personal titles go with their owner's account. On family titles it becomes null when the person
  -- who added it deletes their account (before_profile_delete), so the title stays on the list.
  added_by   uuid references public.profiles (id) on delete cascade,
  media_id   uuid not null references public.media (id) on delete cascade,
  status     text not null default 'want' check (status in ('want', 'watched')),
  created_at timestamptz not null default now(),
  watched_at timestamptz,
  -- Removing a title only hides it, so it can be restored.
  deleted_at timestamptz,
  -- No foreign key: a second list_items -> profiles link would make the app's profiles() embed ambiguous.
  deleted_by uuid,
  -- On My list: the family title this one came from when a Watched together log put it there, and what the log did to
  -- it ('created' it, or 'converted' it from To watch to Watched), so "I wasn't there" can undo exactly that.
  -- Only the watch functions write these.
  source_item_id uuid references public.list_items (id) on delete set null,
  watch_origin   text check (watch_origin in ('created', 'converted'))
);

-- Prevent duplicates within a single list.
create unique index list_items_personal_uniq
  on public.list_items (added_by, media_id)
  where group_id is null;
create unique index list_items_shared_uniq
  on public.list_items (group_id, media_id)
  where group_id is not null;
create index list_items_source_item_idx on public.list_items (source_item_id);

create index list_items_group_idx on public.list_items (group_id);
-- added_by needs no index of its own: list_items_personal_uniq starts with it.
create index list_items_media_idx on public.list_items (media_id);
create index list_items_created_idx on public.list_items (created_at desc);

-- A user's score and/or written note for a list item.
create table public.ratings (
  id           uuid primary key default gen_random_uuid(),
  list_item_id uuid not null references public.list_items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- numeric(3,1) rounds anything finer to one decimal (6.7, 8.5, ...).
  score        numeric(3,1) check (score between 1 and 10),
  comment      text check (char_length(comment) <= 250),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- No foreign key: a second ratings -> profiles link would make the app's profiles() embed ambiguous.
  rated_by     uuid,
  unique (list_item_id, user_id)
);
create index ratings_item_idx on public.ratings (list_item_id);
create index ratings_user_idx on public.ratings (user_id);

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
create index reactions_user_idx on public.reactions (user_id);

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
create index watches_logged_by_idx on public.watches (logged_by);

-- The episodes someone has ticked on a series on their My list, with their own score and note for each. One row per
-- ticked episode, so Not started is no rows. Only mark_episodes(), mark_next_episode() and rate_episode() write it.
create table public.episode_logs (
  list_item_id   uuid not null references public.list_items (id) on delete cascade,
  season_number  smallint not null check (season_number between 1 and 200),
  episode_number smallint not null check (episode_number between 1 and 20000),
  watched_on     date not null default current_date,
  score          numeric(3,1) check (score between 1 and 10),
  comment        text check (char_length(comment) <= 250),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (list_item_id, season_number, episode_number)
);

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

-- How often each person did something, per fixed time window (hit_rate_limit). Not readable through the API.
create table public.rate_limits (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  action       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (user_id, action, window_start)
);

-- Movie nights. A family swipes through stacks of titles, votes, and picks one to watch together; every night is kept
-- in the family's history. source 'swipe' is a night started from the Movie night page; 'logged' is one made when
-- someone logs Watched together with no night going on.
create table public.movie_nights (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups (id) on delete cascade,
  source              text not null default 'swipe' check (source in ('swipe', 'logged')),
  status              text not null default 'open' check (status in ('open', 'closed', 'cancelled', 'expired')),
  started_by          uuid references public.profiles (id) on delete set null,
  -- Browse category slugs the night was started with (at most 5; start_movie_night checks each one).
  genres              text[] not null default '{}' check (cardinality(genres) <= 5),
  options             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  -- Votes, finished or new stacks, shown results and people joining move this forward; a night that goes 12 hours
  -- without any of that expires.
  last_activity_at    timestamptz not null default now(),
  ended_at            timestamptz,
  -- Who picked or cancelled. No foreign key (like rated_by): it is cleared when that person deletes their account.
  ended_by            uuid,
  picked_media_id     uuid references public.media (id) on delete set null,
  picked_list_item_id uuid references public.list_items (id) on delete set null,
  -- When it started; once a title is picked, the day it was watched.
  happened_on         date not null default current_date,
  check (source = 'swipe' or status = 'closed')
);
-- One night at a time per family.
create unique index movie_nights_one_open_idx on public.movie_nights (group_id) where status = 'open';
create index movie_nights_history_idx on public.movie_nights (group_id, happened_on desc, created_at desc);
create index movie_nights_started_by_idx on public.movie_nights (started_by);
create index movie_nights_picked_media_idx on public.movie_nights (picked_media_id);
create index movie_nights_picked_item_idx on public.movie_nights (picked_list_item_id);

-- A deck of cards inside a night: the first one when it starts, then one for each "more suggestions" (up to 5).
create table public.movie_night_stacks (
  id          uuid primary key default gen_random_uuid(),
  night_id    uuid not null references public.movie_nights (id) on delete cascade,
  position    smallint not null check (position between 1 and 5),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Set when someone shows the results early: voting on this stack is over and everyone may see its results.
  revealed_at timestamptz,
  unique (night_id, position)
);
create index movie_night_stacks_created_by_idx on public.movie_night_stacks (created_by);

-- One card: a title in a stack. A title is in a night at most once.
create table public.movie_night_candidates (
  id           uuid primary key default gen_random_uuid(),
  night_id     uuid not null references public.movie_nights (id) on delete cascade,
  stack_id     uuid not null references public.movie_night_stacks (id) on delete cascade,
  media_id     uuid not null references public.media (id) on delete cascade,
  -- The family list entry it came from; empty for suggestions.
  list_item_id uuid references public.list_items (id) on delete set null,
  origin       text not null check (origin in ('list', 'suggested')),
  position     smallint not null,
  unique (night_id, media_id),
  unique (stack_id, position)
);
create index movie_night_candidates_media_idx on public.movie_night_candidates (media_id);
create index movie_night_candidates_item_idx on public.movie_night_candidates (list_item_id);

create table public.movie_night_votes (
  candidate_id uuid not null references public.movie_night_candidates (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  vote         text not null check (vote in ('nope', 'yes', 'love', 'seen')),
  voted_at     timestamptz not null default now(),
  primary key (candidate_id, user_id)
);
create index movie_night_votes_user_idx on public.movie_night_votes (user_id);

-- Who has swiped through a whole stack.
create table public.movie_night_finishes (
  stack_id    uuid not null references public.movie_night_stacks (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  finished_at timestamptz not null default now(),
  primary key (stack_id, user_id)
);
create index movie_night_finishes_user_idx on public.movie_night_finishes (user_id);

-- Who took part in a night, and (once a title is picked) who watched it.
create table public.movie_night_members (
  night_id  uuid not null references public.movie_nights (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  watched   boolean not null default false,
  primary key (night_id, user_id)
);
create index movie_night_members_user_idx on public.movie_night_members (user_id);

-- Guests: people without an account who vote in one night through a link a member shares. They have no standing in the
-- database at all (no account, no family): the server speaks for them with the service-role key, through the guest_*
-- functions, each of which checks the guest's secret. These tables are readable by nobody through the API; members see
-- guests, and what they voted, in movie_night_state().
-- A night's link is one long random token; a member can replace it (the old one stops working) or turn it off.
create table public.movie_night_links (
  night_id   uuid primary key references public.movie_nights (id) on delete cascade,
  token      text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index movie_night_links_created_by_idx on public.movie_night_links (created_by);

-- A guest of a night: the name they gave, and the hash of the secret kept in their browser (the secret itself is
-- never stored). At most 10 per night, with names that differ (whatever the case).
create table public.movie_night_guests (
  id          uuid primary key default gen_random_uuid(),
  night_id    uuid not null references public.movie_nights (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  secret_hash bytea not null unique,
  joined_at   timestamptz not null default now()
);
create unique index movie_night_guests_name_uniq on public.movie_night_guests (night_id, lower(name));

-- What guests vote and which stacks they have swiped through: like movie_night_votes and movie_night_finishes, which
-- stay for the family's members.
create table public.movie_night_guest_votes (
  candidate_id uuid not null references public.movie_night_candidates (id) on delete cascade,
  guest_id     uuid not null references public.movie_night_guests (id) on delete cascade,
  vote         text not null check (vote in ('nope', 'yes', 'love', 'seen')),
  voted_at     timestamptz not null default now(),
  primary key (candidate_id, guest_id)
);
create index movie_night_guest_votes_guest_idx on public.movie_night_guest_votes (guest_id);

create table public.movie_night_guest_finishes (
  stack_id    uuid not null references public.movie_night_stacks (id) on delete cascade,
  guest_id    uuid not null references public.movie_night_guests (id) on delete cascade,
  finished_at timestamptz not null default now(),
  primary key (stack_id, guest_id)
);
create index movie_night_guest_finishes_guest_idx on public.movie_night_guest_finishes (guest_id);

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

-- True if the signed-in user belongs to the family this movie night is for.
create function public.can_see_night(night uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.movie_nights n
    where n.id = night and public.is_group_member(n.group_id, auth.uid())
  );
$$;

-- Counts one go at p_action for p_user in the current p_seconds-long window, and refuses once there have
-- been more than p_max. Called by the functions below and, through the service-role key, by the app's server.
create function public.hit_rate_limit(p_user uuid, p_action text, p_max integer, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
  v_hits  integer;
begin
  if p_user is null then
    return;
  end if;
  -- Windows older than a day are no longer needed.
  delete from public.rate_limits where user_id = p_user and window_start < now() - interval '1 day';

  insert into public.rate_limits as r (user_id, action, window_start, hits)
  values (p_user, p_action, v_start, 1)
  on conflict (user_id, action, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  if v_hits > p_max then
    raise exception 'You''re doing that too often. Please wait a bit and try again.';
  end if;
end;
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

-- auth.uid() is always wrapped as (select auth.uid()), so Postgres works it out once per query instead of
-- once per row (Supabase Performance Advisor: "Auth RLS Initialization Plan").
-- rate_limits has row-level security and no policies: nobody reads or writes it through the API.
alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.media         enable row level security;
alter table public.list_items    enable row level security;
alter table public.ratings       enable row level security;
alter table public.reactions     enable row level security;
alter table public.watches       enable row level security;
alter table public.episode_logs  enable row level security;
alter table public.activity      enable row level security;
alter table public.rate_limits   enable row level security;
alter table public.movie_nights           enable row level security;
alter table public.movie_night_stacks     enable row level security;
alter table public.movie_night_candidates enable row level security;
alter table public.movie_night_votes      enable row level security;
alter table public.movie_night_finishes   enable row level security;
alter table public.movie_night_members    enable row level security;
alter table public.movie_night_links          enable row level security;
alter table public.movie_night_guests         enable row level security;
alter table public.movie_night_guest_votes    enable row level security;
alter table public.movie_night_guest_finishes enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()) or public.shares_group((select auth.uid()), id));
create policy profiles_insert_self on public.profiles for insert
  with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- groups + group_members: read-only here; they change only through the family functions below.
create policy groups_select_member on public.groups for select
  using (public.is_group_member(id, (select auth.uid())));
create policy gm_select on public.group_members for select
  using (public.is_group_member(group_id, (select auth.uid())));

-- media (shared cache of TMDB data): any signed-in user can read it. Nobody writes it from
-- the browser: the app's server saves it with the service-role key, which skips these rules.
create policy media_select_authed on public.media for select
  using ((select auth.uid()) is not null);

-- list_items: no delete policy; the app never hard-deletes titles, so every removal can be undone.
create policy li_select on public.list_items for select using (
  (group_id is null and added_by = (select auth.uid()))
  or (group_id is not null and public.is_group_member(group_id, (select auth.uid())))
);
create policy li_insert on public.list_items for insert with check (
  added_by = (select auth.uid())
  and (
    group_id is null
    or public.is_group_member(group_id, (select auth.uid()))
  )
);
create policy li_update on public.list_items for update using (
  (group_id is null and added_by = (select auth.uid()))
  or (group_id is not null and public.is_group_member(group_id, (select auth.uid())))
);

-- ratings -------------------------------------------------------------------
create policy ratings_select on public.ratings for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id
      and (
        (li.group_id is null and li.added_by = (select auth.uid()))
        or (li.group_id is not null and public.is_group_member(li.group_id, (select auth.uid())))
      )
  )
);
-- Your own scores, and only on titles you can still see (not after you leave a family).
create policy ratings_insert_own on public.ratings for insert
  with check (user_id = (select auth.uid()) and public.can_see_item(list_item_id));
create policy ratings_update_own on public.ratings for update
  using (user_id = (select auth.uid()) and public.can_see_item(list_item_id))
  with check (user_id = (select auth.uid()) and public.can_see_item(list_item_id));
create policy ratings_delete_own on public.ratings for delete
  using (user_id = (select auth.uid()));

-- reactions -----------------------------------------------------------------
create policy reactions_select on public.reactions for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id
      and (
        (li.group_id is null and li.added_by = (select auth.uid()))
        or (li.group_id is not null and public.is_group_member(li.group_id, (select auth.uid())))
      )
  )
);
create policy reactions_insert_own on public.reactions for insert
  with check (user_id = (select auth.uid()) and public.can_see_item(list_item_id));
create policy reactions_update_own on public.reactions for update
  using (user_id = (select auth.uid()) and public.can_see_item(list_item_id))
  with check (user_id = (select auth.uid()) and public.can_see_item(list_item_id));
create policy reactions_delete_own on public.reactions for delete
  using (user_id = (select auth.uid()));

-- watches: no insert policy; log_watch() writes these ------------------------
create policy watches_select on public.watches for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id
      and li.group_id is not null
      and public.is_group_member(li.group_id, (select auth.uid()))
  )
);
-- episode_logs: your own episodes on your My list only (nobody else's, and not a family's); no write policies, the
-- functions below write them.
create policy episode_logs_select on public.episode_logs for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id and li.group_id is null and li.added_by = (select auth.uid())
  )
);
create policy watches_update_own on public.watches for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy watches_delete_own on public.watches for delete
  using (user_id = (select auth.uid()));

-- activity: read-only; only the triggers and functions below write it --------
create policy activity_select on public.activity for select
  using (public.is_group_member(group_id, (select auth.uid())));

-- movie nights: the family reads everything about its nights except other people's votes, which only come out
-- of movie_night_state() once the viewer may see them. All changes go through the movie night functions.
create policy movie_nights_select on public.movie_nights for select
  using (public.is_group_member(group_id, (select auth.uid())));
create policy movie_night_stacks_select on public.movie_night_stacks for select
  using (public.can_see_night(night_id));
create policy movie_night_candidates_select on public.movie_night_candidates for select
  using (public.can_see_night(night_id));
create policy movie_night_members_select on public.movie_night_members for select
  using (public.can_see_night(night_id));
create policy movie_night_finishes_select on public.movie_night_finishes for select
  using (exists (
    select 1 from public.movie_night_stacks s
    where s.id = stack_id and public.can_see_night(s.night_id)
  ));
create policy movie_night_votes_select on public.movie_night_votes for select
  using (user_id = (select auth.uid()));

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
    left(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ), 250),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Deleting an account (Settings -> Delete account, or removing the user in the Supabase dashboard) deletes the
-- profile, and everything of theirs goes with it: personal list, scores, notes, reactions and watch records.
-- First, though, they leave each family, so the others keep the family and the titles on its list: an owner
-- hands over to the longest-standing member, and a family with nobody else in it is deleted. Their name is
-- also removed from the family histories.
create function public.before_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m      record;
  v_next uuid;
begin
  perform set_config('famflix.deleting_account', 'on', true);

  for m in select group_id, role from public.group_members where user_id = old.id loop
    if not exists (select 1 from public.group_members
                   where group_id = m.group_id and user_id <> old.id) then
      delete from public.groups where id = m.group_id;
      continue;
    end if;
    if m.role = 'owner' then
      select user_id into v_next from public.group_members
      where group_id = m.group_id and user_id <> old.id
      order by joined_at, user_id
      limit 1;
      update public.group_members set role = 'owner'
      where group_id = m.group_id and user_id = v_next;
      perform public.add_activity(m.group_id, 'new_owner', null, v_next);
    end if;
    delete from public.group_members where group_id = m.group_id and user_id = old.id;
  end loop;

  -- Family titles they added stay on the family lists (personal ones go with the account).
  update public.list_items set added_by = null
  where added_by = old.id and group_id is not null;

  -- Movie nights they picked or cancelled stay in the history without their name (their votes go with the account).
  update public.movie_nights set ended_by = null where ended_by = old.id;

  -- Their name and notes leave the family histories.
  update public.activity
  set actor_id = null,
      actor_name = null,
      detail = case when kind = 'rated' then null else detail end
  where actor_id = old.id;
  update public.activity set subject_id = null, subject_name = null
  where subject_id = old.id;
  if coalesce(old.display_name, '') <> '' then
    update public.activity
    set detail = array_to_string(array(
          select case when n = old.display_name then 'someone' else n end
          from unnest(string_to_array(detail, ', ')) as n
        ), ', ')
    where kind = 'watched_together'
      and old.display_name = any (string_to_array(detail, ', '));
  end if;

  return old;
end;
$$;

create trigger profiles_before_delete
  before delete on public.profiles
  for each row execute function public.before_profile_delete();

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
  if char_length(trim(p_name)) > 250 then
    raise exception 'Family names can be at most 250 characters';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'create_group', 10, 3600);

  insert into public.groups (name, invite_code, created_by)
  values (trim(p_name), public.new_invite_code(), auth.uid())
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, auth.uid(), 'owner');

  return g;
end;
$$;

-- Join an existing group by invite code. Returns the group id, or null if no family has that code.
-- At most 10 tries per 10 minutes. A wrong code returns null instead of raising an error, because an error
-- would also undo the try's count, and then nothing would stop someone from guessing codes.
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
  perform public.hit_rate_limit(auth.uid(), 'join_group', 10, 600);

  select id, invite_code_expires_at into g_id, g_expires
  from public.groups
  where invite_code = upper(trim(p_invite_code));

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
  if char_length(trim(p_name)) > 250 then
    raise exception 'Family names can be at most 250 characters';
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
  -- A score copied over by the database (ratings_follow_family) keeps who gave it; any other is the signed-in person's.
  if current_setting('famflix.copying_rating', true) is distinct from 'on' then
    new.rated_by := auth.uid();
  end if;
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
  v_users uuid[] := '{}';
  v_on date;
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
    v_users := v_users || v.user_id;

    insert into public.watches as w (list_item_id, user_id, watched_on, logged_by)
    values (p_item, v.user_id, p_watched_on, auth.uid())
    on conflict (list_item_id, user_id) do update
      set watched_on = greatest(w.watched_on, excluded.watched_on),
          logged_by = excluded.logged_by
    returning w.watched_on into v_on;

    -- It goes on their My list as Watched too, with the others who were there. (Before the score below, which then
    -- follows it there.)
    perform public.add_to_my_list_watched(p_item, v.user_id, v_on);

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

  -- A movie night the family has going for this title ends with it; otherwise it goes in the history as a night.
  perform public.record_movie_night_watch(p_item, p_watched_on, v_users);
end;
$$;

-- The caller's open rating requests: titles they were marked as having watched and haven't skipped, while they
-- have no rating of their own yet: none at all, or only a score someone else filled in (they can confirm or change
-- it, and add their note).
create function public.pending_rating_requests()
returns table (
  list_item_id      uuid,
  group_name        text,
  watched_on        date,
  logged_by         uuid,
  logged_by_name    text,
  media_type        text,
  tmdb_id           integer,
  title             text,
  release_year      integer,
  poster_path       text,
  filled_in_score   numeric,
  filled_in_by_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  select w.list_item_id, g.name, w.watched_on, w.logged_by, p.display_name,
         m.media_type, m.tmdb_id, m.title, m.release_year, m.poster_path,
         r.score, fp.display_name
  from public.watches w
  join public.list_items li on li.id = w.list_item_id
  join public.groups g on g.id = li.group_id
  join public.media m on m.id = li.media_id
  left join public.profiles p on p.id = w.logged_by
  left join public.ratings r on r.list_item_id = w.list_item_id and r.user_id = auth.uid()
  left join public.profiles fp on fp.id = r.rated_by
  where w.user_id = auth.uid()
    and w.skipped_at is null
    and li.deleted_at is null
    and public.is_group_member(li.group_id, auth.uid())
    and (r.id is null or r.rated_by is distinct from auth.uid())
  order by w.watched_on desc, w.created_at desc;
$$;

-- When the last person leaves a title's watch record ("I wasn't there", or deleting their account), nobody is left
-- who watched it, so the title goes back to To watch, as if Watched had been unmarked. While anyone else is still
-- on the record it stays watched together.
create function public.after_watch_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- What the watch put on their My list goes off it again.
  perform public.remove_from_my_list_watched(old.list_item_id, old.user_id);

  if not exists (select 1 from public.watches where list_item_id = old.list_item_id) then
    update public.list_items
    set status = 'want', watched_at = null
    where id = old.list_item_id and status = 'watched';
  end if;

  -- The movie night history follows: that person didn't watch it after all, and a "logged" night nobody is left
  -- on never happened.
  update public.movie_night_members m
  set watched = false
  from public.movie_nights n
  where n.id = m.night_id and n.picked_list_item_id = old.list_item_id and m.user_id = old.user_id;
  delete from public.movie_nights n
  where n.source = 'logged' and n.picked_list_item_id = old.list_item_id
    and not exists (select 1 from public.movie_night_members m where m.night_id = n.id and m.watched);
  return null;
end;
$$;

create trigger watches_after_delete
  after delete on public.watches
  for each row execute function public.after_watch_delete();

-- ---------------------------------------------------------------------------
--  Watched together also lands on My list
-- ---------------------------------------------------------------------------

-- Puts a title the family watched together on one person's My list as Watched, with the family's score and note for
-- them, so it is in their Watched tab. log_watch calls it for everyone on the log.
--   - Not on their My list: a new entry (the watch 'created' it).
--   - Removed from My list earlier: it comes back, as Watched.
--   - On their To watch: marked Watched (the watch 'converted' it).
--   - Already watched by them on their own: left as it is.
-- The entry remembers the family title it came from, so its card can say who it was watched with, and so "I wasn't
-- there" can take it off again.
create function public.add_to_my_list_watched(p_family_item uuid, p_user uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media   uuid;
  v_group   uuid;
  v_at      timestamptz;
  v_rows    integer;
  v_mine    public.list_items;
  v_changed boolean;
begin
  select media_id, group_id into v_media, v_group from public.list_items where id = p_family_item;
  if v_group is null then
    return;
  end if;
  -- The day it was watched, at midday (never in the future), so "recently watched" sorts by it.
  v_at := least(now(), p_date::timestamptz + interval '12 hours');

  insert into public.list_items (group_id, added_by, media_id, status, watched_at, source_item_id, watch_origin)
  values (null, p_user, v_media, 'watched', v_at, p_family_item, 'created')
  on conflict (added_by, media_id) where group_id is null do nothing;
  get diagnostics v_rows = row_count;
  v_changed := v_rows > 0;

  select * into v_mine from public.list_items
  where group_id is null and added_by = p_user and media_id = v_media
  for update;

  if not v_changed then
    if v_mine.deleted_at is not null then
      update public.list_items
      set deleted_at = null, status = 'watched', watched_at = v_at, source_item_id = p_family_item, watch_origin = 'created'
      where id = v_mine.id;
      v_changed := true;
    elsif v_mine.source_item_id is not distinct from p_family_item then
      -- Logged again (a later day, or someone else added to the log): the date follows.
      update public.list_items set watched_at = v_at
      where id = v_mine.id and status = 'watched' and watch_origin is not null;
    elsif v_mine.status = 'want' then
      update public.list_items
      set status = 'watched', watched_at = v_at, source_item_id = p_family_item, watch_origin = 'converted'
      where id = v_mine.id;
      v_changed := true;
    end if;
  end if;

  if v_changed then
    -- Their score and note on the family title come with it, unless they have ones of their own here already.
    perform set_config('famflix.copying_rating', 'on', true);
    insert into public.ratings (list_item_id, user_id, score, comment, rated_by)
    select v_mine.id, r.user_id, r.score, r.comment, r.rated_by
    from public.ratings r
    where r.list_item_id = p_family_item and r.user_id = p_user
    on conflict (list_item_id, user_id) do nothing;
    perform set_config('famflix.copying_rating', 'off', true);
  end if;
end;
$$;

-- Takes a title off someone's My list when they leave its Watched together record ("I wasn't there", or deleting their
-- account), if the watch is what put it there: an entry it created is removed; one it moved from To watch to Watched
-- goes back to To watch, without the score and note that came along; one the person has made their own since (they
-- unmarked it) just stops following the family title.
create function public.remove_from_my_list_watched(p_family_item uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mine public.list_items;
begin
  -- A family title that is going away (its family was deleted) takes its watches with it: the entries stay as they are.
  if not exists (select 1 from public.list_items where id = p_family_item) then
    return;
  end if;
  select * into v_mine from public.list_items
  where group_id is null and added_by = p_user and source_item_id = p_family_item;
  if not found then
    return;
  end if;

  if v_mine.status = 'watched' and v_mine.watch_origin = 'created' then
    delete from public.list_items where id = v_mine.id;
  elsif v_mine.status = 'watched' and v_mine.watch_origin = 'converted' then
    update public.list_items
    set status = 'want', watched_at = null, source_item_id = null, watch_origin = null
    where id = v_mine.id;
    -- What came with the watch goes (a score filled in by someone else, or a copy of the family's); what they wrote on
    -- My list themselves stays.
    delete from public.ratings m
    where m.list_item_id = v_mine.id and m.user_id = p_user
      and (m.rated_by is distinct from m.user_id
           or exists (select 1 from public.ratings f
                      where f.list_item_id = p_family_item and f.user_id = p_user
                        and f.score is not distinct from m.score and f.comment is not distinct from m.comment));
  else
    update public.list_items set source_item_id = null, watch_origin = null where id = v_mine.id;
  end if;
end;
$$;

-- A score or note someone gives a family title also goes to their entry on My list (the one a Watched together log put
-- there), for as long as the entry still has what the family's had: what they change on My list is theirs and stays.
-- It never goes the other way, so notes written on My list stay private.
create function public.ratings_follow_family()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item uuid;
  v_user uuid;
  v_copy uuid;
  v_mine public.ratings;
  v_has  boolean;
begin
  if current_setting('famflix.copying_rating', true) = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_item := old.list_item_id;
    v_user := old.user_id;
  else
    v_item := new.list_item_id;
    v_user := new.user_id;
  end if;
  select li.id into v_copy
  from public.list_items li
  where li.group_id is null and li.added_by = v_user and li.source_item_id = v_item and li.deleted_at is null;
  if v_copy is null then
    return null;
  end if;
  select * into v_mine from public.ratings where list_item_id = v_copy and user_id = v_user;
  v_has := found;

  perform set_config('famflix.copying_rating', 'on', true);
  if tg_op = 'DELETE' then
    if v_has and v_mine.score is not distinct from old.score and v_mine.comment is not distinct from old.comment then
      delete from public.ratings where id = v_mine.id;
    end if;
  elsif not v_has then
    insert into public.ratings (list_item_id, user_id, score, comment, rated_by)
    values (v_copy, v_user, new.score, new.comment, new.rated_by);
  elsif tg_op = 'UPDATE' and v_mine.score is not distinct from old.score and v_mine.comment is not distinct from old.comment then
    update public.ratings
    set score = new.score, comment = new.comment, rated_by = new.rated_by, updated_at = now()
    where id = v_mine.id;
  end if;
  perform set_config('famflix.copying_rating', 'off', true);
  return null;
end;
$$;

create trigger ratings_follow_family
  after insert or update or delete on public.ratings
  for each row execute function public.ratings_follow_family();

-- ---------------------------------------------------------------------------
--  Series: ticking episodes on My list
-- ---------------------------------------------------------------------------

-- How many episodes of a season have aired, from a series' info (media.series): 0 for a season it doesn't list.
create function public.series_aired(p_series jsonb, p_season integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce((
    select case
             when la.s is null then 0
             when p_season < la.s then x.episodes
             when p_season = la.s then least(la.e, x.episodes)
             else 0
           end
    from jsonb_to_recordset(p_series -> 'seasons') as x(n integer, episodes integer)
    cross join (select (p_series -> 'last_aired' ->> 's')::integer as s,
                       (p_series -> 'last_aired' ->> 'e')::integer as e) la
    where x.n = p_season
  ), 0);
$$;

create function public.series_aired_total(p_series jsonb)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce(sum(public.series_aired(p_series, x.n)), 0)::integer
  from jsonb_to_recordset(p_series -> 'seasons') as x(n integer, episodes integer);
$$;

-- The caller's own My list entry for a series (locked while they change its episodes): whether it is watched and when,
-- and its series info. Anything else is refused: someone else's entry, a family's, one that was removed, a movie, or a
-- series with no info saved yet.
create function public.episodes_my_item(p_item uuid, out status text, out watched_at timestamptz, out series jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'episodes', 180, 60);
  select li.status, li.watched_at, li.media_id into status, watched_at, v_media
  from public.list_items li
  where li.id = p_item and li.group_id is null and li.added_by = auth.uid() and li.deleted_at is null
  for update;
  if not found then
    raise exception 'This title is not on your My list';
  end if;
  select m.series into series from public.media m where m.id = v_media;
  if series is null then
    raise exception 'This series has no episode list yet';
  end if;
end;
$$;

-- A series that has ended and has every aired episode ticked is Watched. Returns whether it just became so.
create function public.episodes_complete_if_done(p_item uuid, p_series jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aired  integer := public.series_aired_total(p_series);
  v_ticked integer;
begin
  if v_aired = 0 or coalesce(p_series ->> 'status', '') not in ('Ended', 'Canceled') then
    return false;
  end if;
  select count(*) into v_ticked
  from public.episode_logs e
  where e.list_item_id = p_item
    and e.episode_number <= public.series_aired(p_series, e.season_number);
  if v_ticked < v_aired then
    return false;
  end if;
  update public.list_items set status = 'watched', watched_at = now()
  where id = p_item and status = 'want';
  return found;
end;
$$;

-- Where the caller is with each series on their My list that has an episode ticked: how many aired episodes are ticked
-- and which aired episode is next (none when everything that has aired is ticked). For the cards on My list, which
-- can't be given every tick (the API hands out at most 1000 rows at a time, and a long series has more).
create function public.my_series_progress()
returns table (list_item_id uuid, watched integer, next_season integer, next_episode integer)
language sql
stable
security definer
set search_path = public
as $$
  select li.id,
         (select count(*)::integer from public.episode_logs e
          where e.list_item_id = li.id and e.episode_number <= public.series_aired(m.series, e.season_number)),
         nx.n, nx.e
  from public.list_items li
  join public.media m on m.id = li.media_id and m.series is not null
  left join lateral (
    select x.n, g.e
    from jsonb_to_recordset(m.series -> 'seasons') as x(n integer, episodes integer)
    cross join lateral generate_series(1, public.series_aired(m.series, x.n)) as g(e)
    where not exists (
      select 1 from public.episode_logs l
      where l.list_item_id = li.id and l.season_number = x.n and l.episode_number = g.e
    )
    order by x.n, g.e
    limit 1
  ) nx on true
  where li.group_id is null and li.added_by = auth.uid() and li.deleted_at is null
    and exists (select 1 from public.episode_logs e where e.list_item_id = li.id);
$$;

-- Ticks (p_watched) or unticks the episodes from (p_from_season, p_from_episode) to (p_to_season, p_to_episode), both
-- included, on a series on the caller's My list: one episode, a season (to episode 20000: it stops at the last one), or
-- everything up to an episode (from 1, 1). Only aired episodes can be ticked. Ticking the last aired episode of a series
-- that has ended makes it Watched. Unticking on a series that is Watched first ticks every aired episode for real (a
-- Watched series shows all of them as watched), then takes these off and puts the series back to To watch. Unticking
-- also takes off the episodes' scores and notes. Returns {"changed": episodes ticked or unticked, "completed": it
-- became Watched, "reopened": it stopped being Watched}.
create function public.mark_episodes(
  p_item         uuid,
  p_watched      boolean,
  p_from_season  integer,
  p_from_episode integer,
  p_to_season    integer,
  p_to_episode   integer,
  p_on           date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_watched   timestamptz;
  v_series    jsonb;
  v_listed    integer;
  v_aired     integer;
  v_changed   integer := 0;
  v_completed boolean := false;
  v_reopened  boolean := false;
begin
  select m.status, m.watched_at, m.series into v_status, v_watched, v_series from public.episodes_my_item(p_item) as m;

  if p_watched is null or p_from_season is null or p_from_episode is null
     or p_to_season is null or p_to_episode is null then
    raise exception 'Pick the episodes';
  end if;
  if p_on is null or p_on > current_date + 1 then
    raise exception 'Pick a date that is not in the future';
  end if;
  if (select count(*) from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
      where x.n in (p_from_season, p_to_season)) < (case when p_from_season = p_to_season then 1 else 2 end) then
    raise exception 'That season is not listed for this series';
  end if;
  if p_from_episode < 1 or p_from_season > p_to_season
     or (p_from_season = p_to_season and p_from_episode > p_to_episode) then
    raise exception 'Pick the episodes in order';
  end if;
  if p_from_episode > (select x.episodes from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
                       where x.n = p_from_season) then
    raise exception 'That episode is not listed for this series';
  end if;

  -- The listed episodes asked for, and how many of them have aired.
  select count(*), count(*) filter (where g.e <= public.series_aired(v_series, x.n))
  into v_listed, v_aired
  from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
  cross join lateral generate_series(
    case when x.n = p_from_season then p_from_episode else 1 end,
    least(case when x.n = p_to_season then p_to_episode else x.episodes end, x.episodes)
  ) as g(e)
  where x.n between p_from_season and p_to_season;
  if v_listed > 5000 then
    raise exception 'That is too many episodes at once';
  end if;

  if p_watched then
    if v_aired = 0 then
      raise exception 'Those episodes have not aired yet';
    end if;
    insert into public.episode_logs (list_item_id, season_number, episode_number, watched_on)
    select p_item, x.n, g.e, p_on
    from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
    cross join lateral generate_series(
      case when x.n = p_from_season then p_from_episode else 1 end,
      least(case when x.n = p_to_season then p_to_episode else x.episodes end, x.episodes)
    ) as g(e)
    where x.n between p_from_season and p_to_season and g.e <= public.series_aired(v_series, x.n)
    on conflict do nothing;
    get diagnostics v_changed = row_count;
    v_completed := public.episodes_complete_if_done(p_item, v_series);
  else
    if v_status = 'watched' and v_aired > 0 then
      insert into public.episode_logs (list_item_id, season_number, episode_number, watched_on)
      select p_item, x.n, g.e, coalesce(v_watched::date, current_date)
      from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
      cross join lateral generate_series(1, public.series_aired(v_series, x.n)) as g(e)
      on conflict do nothing;
      update public.list_items set status = 'want', watched_at = null where id = p_item;
      v_reopened := true;
    end if;
    with r as (
      select x.n, g.e
      from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
      cross join lateral generate_series(
        case when x.n = p_from_season then p_from_episode else 1 end,
        least(case when x.n = p_to_season then p_to_episode else x.episodes end, x.episodes)
      ) as g(e)
      where x.n between p_from_season and p_to_season
    )
    delete from public.episode_logs l
    using r
    where l.list_item_id = p_item and l.season_number = r.n and l.episode_number = r.e;
    get diagnostics v_changed = row_count;
  end if;

  return jsonb_build_object('changed', v_changed, 'completed', v_completed, 'reopened', v_reopened);
end;
$$;

-- Ticks the first aired episode that isn't ticked yet. Returns {"season", "episode", "completed"}.
create function public.mark_next_episode(p_item uuid, p_on date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_series    jsonb;
  v_season    integer;
  v_episode   integer;
  v_completed boolean;
begin
  select m.status, m.series into v_status, v_series from public.episodes_my_item(p_item) as m;
  if p_on is null or p_on > current_date + 1 then
    raise exception 'Pick a date that is not in the future';
  end if;
  if v_status = 'watched' then
    raise exception 'This series is already marked as watched';
  end if;

  select x.n, g.e into v_season, v_episode
  from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
  cross join lateral generate_series(1, public.series_aired(v_series, x.n)) as g(e)
  where not exists (
    select 1 from public.episode_logs l
    where l.list_item_id = p_item and l.season_number = x.n and l.episode_number = g.e
  )
  order by x.n, g.e
  limit 1;
  if v_season is null then
    raise exception 'There is no new episode to tick';
  end if;

  insert into public.episode_logs (list_item_id, season_number, episode_number, watched_on)
  values (p_item, v_season, v_episode, p_on)
  on conflict do nothing;
  v_completed := public.episodes_complete_if_done(p_item, v_series);
  return jsonb_build_object('season', v_season, 'episode', v_episode, 'completed', v_completed);
end;
$$;

-- The caller's own score (1 to 10, one decimal) and/or note (up to 250 characters) for an aired episode of a series on
-- their My list. Rating an episode ticks it; with neither a score nor a note it only takes the old ones off (the tick
-- stays). Like the last tick of a series that has ended, rating its last aired episode can make it Watched. Returns
-- {"completed": it became Watched}.
create function public.rate_episode(p_item uuid, p_season integer, p_episode integer, p_score numeric, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series  jsonb;
  v_rounded numeric;
  v_score   numeric(3,1);
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  select m.series into v_series from public.episodes_my_item(p_item) as m;

  if p_season is null or p_episode is null or p_season < 1 or p_episode < 1 or not exists (
       select 1 from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
       where x.n = p_season and p_episode <= x.episodes) then
    raise exception 'That episode is not listed for this series';
  end if;
  if p_episode > public.series_aired(v_series, p_season) then
    raise exception 'That episode has not aired yet';
  end if;
  if char_length(v_comment) > 250 then
    raise exception 'Notes can be at most 250 characters';
  end if;
  if p_score is not null then
    v_rounded := round(p_score, 1);
    if v_rounded < 1 or v_rounded > 10 then
      raise exception 'Scores must be between 1 and 10';
    end if;
    v_score := v_rounded;
  end if;

  if v_score is null and v_comment is null then
    update public.episode_logs
    set score = null, comment = null, updated_at = now()
    where list_item_id = p_item and season_number = p_season and episode_number = p_episode;
  else
    insert into public.episode_logs (list_item_id, season_number, episode_number, score, comment)
    values (p_item, p_season, p_episode, v_score, v_comment)
    on conflict (list_item_id, season_number, episode_number)
    do update set score = excluded.score, comment = excluded.comment, updated_at = now();
  end if;
  return jsonb_build_object('completed', public.episodes_complete_if_done(p_item, v_series));
end;
$$;

-- ---------------------------------------------------------------------------
--  Movie nights: stacks of titles to swipe, votes, and the results
-- ---------------------------------------------------------------------------

-- A night nobody has touched for 12 hours is over. Everything that reads or changes a night calls this first.
create function public.settle_movie_night(p_night uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.movie_nights
  set status = 'expired', ended_at = now()
  where id = p_night and status = 'open' and last_activity_at < now() - interval '12 hours';
$$;

-- Loads a night for a member of its family (after expiring it if it went quiet); anyone else is told it isn't there.
create function public.movie_night_for_member(p_night uuid)
returns public.movie_nights
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  perform public.settle_movie_night(p_night);
  select * into n from public.movie_nights where id = p_night;
  if not found or not public.is_group_member(n.group_id, auth.uid()) then
    raise exception 'This movie night is not available';
  end if;
  return n;
end;
$$;

-- Stops with a plain message unless the night is still open.
create function public.movie_night_require_open(n public.movie_nights)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if n.status = 'open' then
    return;
  end if;
  if n.status = 'closed' then
    raise exception '% already picked %',
      coalesce((select display_name from public.profiles where id = n.ended_by), 'Someone'),
      coalesce((select title from public.media where id = n.picked_media_id), 'a title');
  elsif n.status = 'cancelled' then
    raise exception 'This movie night was cancelled';
  end if;
  raise exception 'This movie night ended after 12 hours without anyone voting';
end;
$$;

-- Checks the cards of a new stack: [{"media_id": ..., "list_item_id": ... or null, "origin": "list" or "suggested"}].
-- Only a night's first stack may use family list titles (p_allow_list), and every card is a movie.
create function public.movie_night_check_candidates(p_group uuid, p_candidates jsonb, p_allow_list boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if jsonb_typeof(p_candidates) is distinct from 'array' then
    raise exception 'Pick the titles for the stack';
  end if;
  v_n := jsonb_array_length(p_candidates);
  if v_n < 8 or v_n > 40 then
    raise exception 'A stack has 8 to 40 titles';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_candidates) as e(elem)
    where jsonb_typeof(e.elem) is distinct from 'object'
       or e.elem ->> 'media_id' is null
       or coalesce(e.elem ->> 'origin', '') not in ('list', 'suggested')
       or (e.elem ->> 'origin' = 'list' and (not p_allow_list or e.elem ->> 'list_item_id' is null))
       or (e.elem ->> 'origin' = 'suggested' and e.elem ->> 'list_item_id' is not null)
  ) then
    raise exception 'Some of these titles are not valid';
  end if;
  if (select count(distinct e.elem ->> 'media_id') from jsonb_array_elements(p_candidates) as e(elem)) <> v_n then
    raise exception 'A title can only be in a stack once';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_candidates) as e(elem)
    where not exists (select 1 from public.media m where m.id = (e.elem ->> 'media_id')::uuid)
  ) then
    raise exception 'Some of these titles are not valid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_candidates) as e(elem)
    join public.media m on m.id = (e.elem ->> 'media_id')::uuid
    where m.media_type <> 'movie'
  ) then
    raise exception 'Movie nights are for movies. Series are tracked on My list';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_candidates) as e(elem)
    where e.elem ->> 'origin' = 'list'
      and not exists (
        select 1 from public.list_items li
        where li.id = (e.elem ->> 'list_item_id')::uuid
          and li.group_id = p_group
          and li.media_id = (e.elem ->> 'media_id')::uuid
          and li.deleted_at is null
      )
  ) then
    raise exception 'Some of these titles are not on the family list';
  end if;
end;
$$;

-- Starts a movie night for a family with its first stack. Any member can; one night at a time per family.
-- p_genres: up to 5 browse category slugs. p_options: {"count": 8-40, "max": minutes or null} (movie nights are for
-- movies, so "series" is false or left out; it is kept in the saved options for the nights made before that).
create function public.start_movie_night(
  p_group      uuid,
  p_genres     text[],
  p_options    jsonb,
  p_candidates jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_genres  text[] := coalesce(p_genres, '{}');
  v_options jsonb;
  v_night   uuid;
  v_stack   uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if not public.is_group_member(p_group, auth.uid()) then
    raise exception 'You are not in this family';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'start_movie_night', 6, 3600);

  if cardinality(v_genres) > 5
     or exists (select 1 from unnest(v_genres) as g where g is null or g = '' or char_length(g) > 40) then
    raise exception 'Pick up to 5 genres';
  end if;
  if jsonb_typeof(coalesce(p_options, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Those options are not valid';
  end if;
  if coalesce((p_options ->> 'series')::boolean, false) then
    raise exception 'Movie nights are for movies. Series are tracked on My list';
  end if;
  v_options := jsonb_build_object(
    'series', false,
    'count',  coalesce((p_options ->> 'count')::integer, 25),
    'max',    (p_options ->> 'max')::integer
  );
  if (v_options ->> 'count')::integer not between 8 and 40 then
    raise exception 'A stack has 8 to 40 titles';
  end if;

  -- A night that went quiet is over; one that is still going blocks a new one.
  update public.movie_nights
  set status = 'expired', ended_at = now()
  where group_id = p_group and status = 'open' and last_activity_at < now() - interval '12 hours';
  if exists (select 1 from public.movie_nights where group_id = p_group and status = 'open') then
    raise exception 'This family already has a movie night open';
  end if;

  perform public.movie_night_check_candidates(p_group, p_candidates, true);

  insert into public.movie_nights (group_id, started_by, genres, options)
  values (p_group, auth.uid(), v_genres, v_options)
  returning id into v_night;
  insert into public.movie_night_members (night_id, user_id) values (v_night, auth.uid());
  insert into public.movie_night_stacks (night_id, position, created_by)
  values (v_night, 1, auth.uid())
  returning id into v_stack;
  insert into public.movie_night_candidates (night_id, stack_id, media_id, list_item_id, origin, position)
  select v_night, v_stack, (e.elem ->> 'media_id')::uuid, (e.elem ->> 'list_item_id')::uuid,
         e.elem ->> 'origin', e.pos::smallint
  from jsonb_array_elements(p_candidates) with ordinality as e(elem, pos);

  perform public.add_activity(
    p_group, 'movie_night_started', null, null, null,
    case when cardinality(v_genres) = 0 then null else array_to_string(v_genres, ', ') end
  );
  return v_night;
end;
$$;

-- Takes part in a night (so people can see who is in), without voting yet.
create function public.join_movie_night(p_night uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  n := public.movie_night_for_member(p_night);
  if n.status <> 'open' then
    return;
  end if;
  insert into public.movie_night_members (night_id, user_id)
  values (p_night, auth.uid())
  on conflict do nothing;
  if found then
    update public.movie_nights set last_activity_at = now() where id = p_night;
  end if;
end;
$$;

-- Saves a batch of votes on one stack: [{"candidate_id": ..., "vote": "nope"|"yes"|"love"|"seen" or null to take it back}].
-- At most 3 loves per person in a stack; any problem and none of the batch is saved. Returns the loves used.
create function public.cast_movie_night_votes(p_stack uuid, p_votes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n       public.movie_nights;
  v_stack public.movie_night_stacks;
  v_loves integer;
  r       record;
begin
  select * into v_stack from public.movie_night_stacks where id = p_stack;
  if not found then
    raise exception 'This movie night is not available';
  end if;
  n := public.movie_night_for_member(v_stack.night_id);
  perform public.movie_night_require_open(n);
  if v_stack.revealed_at is not null then
    raise exception 'The results for this stack are already out';
  end if;
  if exists (select 1 from public.movie_night_finishes where stack_id = p_stack and user_id = auth.uid()) then
    raise exception 'You have already finished this stack';
  end if;
  if jsonb_typeof(p_votes) is distinct from 'array' or jsonb_array_length(p_votes) > 60 then
    raise exception 'Too many votes at once';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_votes) as e(elem)
    where jsonb_typeof(e.elem) is distinct from 'object'
       or not exists (
            select 1 from public.movie_night_candidates c
            where c.id = (e.elem ->> 'candidate_id')::uuid and c.stack_id = p_stack)
       or (e.elem ->> 'vote' is not null and e.elem ->> 'vote' not in ('nope', 'yes', 'love', 'seen'))
  ) then
    raise exception 'Those votes are not for this stack';
  end if;

  for r in
    select (e.elem ->> 'candidate_id')::uuid as candidate_id, e.elem ->> 'vote' as vote
    from jsonb_array_elements(p_votes) with ordinality as e(elem, pos)
    order by e.pos
  loop
    if r.vote is null then
      delete from public.movie_night_votes where candidate_id = r.candidate_id and user_id = auth.uid();
    else
      insert into public.movie_night_votes (candidate_id, user_id, vote)
      values (r.candidate_id, auth.uid(), r.vote)
      on conflict (candidate_id, user_id) do update set vote = excluded.vote, voted_at = now();
    end if;
  end loop;

  select count(*) into v_loves
  from public.movie_night_votes v
  join public.movie_night_candidates c on c.id = v.candidate_id
  where c.stack_id = p_stack and v.user_id = auth.uid() and v.vote = 'love';
  if v_loves > 3 then
    raise exception 'You can love at most 3 titles in a stack';
  end if;

  insert into public.movie_night_members (night_id, user_id) values (n.id, auth.uid()) on conflict do nothing;
  update public.movie_nights set last_activity_at = now() where id = n.id;
  return v_loves;
end;
$$;

-- Marks the caller's swiping of a stack as done. Quietly does nothing once the night is over.
create function public.finish_movie_night_stack(p_stack uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n       public.movie_nights;
  v_stack public.movie_night_stacks;
begin
  select * into v_stack from public.movie_night_stacks where id = p_stack;
  if not found then
    raise exception 'This movie night is not available';
  end if;
  n := public.movie_night_for_member(v_stack.night_id);
  if n.status <> 'open' then
    return;
  end if;
  insert into public.movie_night_finishes (stack_id, user_id) values (p_stack, auth.uid()) on conflict do nothing;
  insert into public.movie_night_members (night_id, user_id) values (n.id, auth.uid()) on conflict do nothing;
  update public.movie_nights set last_activity_at = now() where id = n.id;
end;
$$;

-- Adds another stack of suggestions (up to 5 stacks per night). p_known_stacks is how many the caller can see:
-- if someone added one in the meantime, the caller gets that one back instead of a second.
create function public.add_movie_night_stack(p_night uuid, p_known_stacks integer, p_candidates jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  n       public.movie_nights;
  v_count integer;
  v_stack uuid;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  perform public.hit_rate_limit(auth.uid(), 'add_movie_night_stack', 10, 3600);

  -- Two people asking at once take turns.
  perform 1 from public.movie_nights where id = p_night for update;
  select count(*) into v_count from public.movie_night_stacks where night_id = p_night;
  if v_count <> p_known_stacks then
    select id into v_stack from public.movie_night_stacks where night_id = p_night order by position desc limit 1;
    return v_stack;
  end if;
  if v_count >= 5 then
    raise exception 'This movie night already has 5 stacks';
  end if;

  perform public.movie_night_check_candidates(n.group_id, p_candidates, false);
  if exists (
    select 1
    from jsonb_array_elements(p_candidates) as e(elem)
    join public.movie_night_candidates c
      on c.night_id = p_night and c.media_id = (e.elem ->> 'media_id')::uuid
  ) then
    raise exception 'Some of these titles are already in this movie night';
  end if;

  insert into public.movie_night_stacks (night_id, position, created_by)
  values (p_night, v_count + 1, auth.uid())
  returning id into v_stack;
  insert into public.movie_night_candidates (night_id, stack_id, media_id, origin, position)
  select p_night, v_stack, (e.elem ->> 'media_id')::uuid, 'suggested', e.pos::smallint
  from jsonb_array_elements(p_candidates) with ordinality as e(elem, pos);
  update public.movie_nights set last_activity_at = now() where id = p_night;
  return v_stack;
end;
$$;

-- Shows the results now: voting on the stacks that are still open ends, so everyone can see how they came out.
create function public.reveal_movie_night(p_night uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  update public.movie_night_stacks set revealed_at = now() where night_id = p_night and revealed_at is null;
  update public.movie_nights set last_activity_at = now() where id = p_night;
end;
$$;

create function public.cancel_movie_night(p_night uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  update public.movie_nights
  set status = 'cancelled', ended_at = now(), ended_by = auth.uid()
  where id = p_night;
  perform public.add_activity(n.group_id, 'movie_night_cancelled');
end;
$$;

-- Every vote of a night, the family's and its guests' together. `voter` is the member's id or the guest's, and `guest`
-- says which. A helper for the functions below: it is not for the API.
create function public.movie_night_all_votes(p_night uuid)
returns table (candidate_id uuid, voter uuid, vote text, voted_at timestamptz, guest boolean)
language sql
stable
security definer
set search_path = public
as $$
  select v.candidate_id, v.user_id, v.vote, v.voted_at, false
  from public.movie_night_votes v
  join public.movie_night_candidates c on c.id = v.candidate_id
  where c.night_id = p_night
  union all
  select v.candidate_id, v.guest_id, v.vote, v.voted_at, true
  from public.movie_night_guest_votes v
  join public.movie_night_candidates c on c.id = v.candidate_id
  where c.night_id = p_night;
$$;

-- Who has swiped through which stack of a night, members and guests together (a helper like the one above).
create function public.movie_night_all_finishes(p_night uuid)
returns table (stack_id uuid, voter uuid, guest boolean)
language sql
stable
security definer
set search_path = public
as $$
  select f.stack_id, f.user_id, false
  from public.movie_night_finishes f
  join public.movie_night_stacks s on s.id = f.stack_id
  where s.night_id = p_night
  union all
  select f.stack_id, f.guest_id, true
  from public.movie_night_guest_finishes f
  join public.movie_night_stacks s on s.id = f.stack_id
  where s.night_id = p_night;
$$;

-- Everything the room needs about one night, as one voter may see it, in one go: the night, its stacks, who is taking
-- part (the family and its guests) and how far they are, the voter's own votes and, for each stack the voter has
-- finished (or that someone revealed, or once the night is over), the ranked results with who voted what. p_full also
-- sends the cards. The voter is a member or, with p_guest, a guest, who is told nothing about the family's lists. The
-- callers check that the voter may see the night: movie_night_state() for members, guest_movie_night_state() for guests.
create function public.movie_night_state_for(p_night uuid, p_full boolean, p_voter uuid, p_guest boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n            public.movie_nights;
  v_me         uuid := p_voter;
  v_ended      boolean;
  v_night      jsonb;
  v_stacks     jsonb;
  v_members    jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_votes      jsonb;
  v_results    jsonb;
begin
  select * into n from public.movie_nights where id = p_night;
  v_ended := n.status <> 'open';

  v_night := jsonb_build_object(
    'id', n.id,
    'group_id', n.group_id,
    'group_name', (select name from public.groups where id = n.group_id),
    'status', n.status,
    'source', n.source,
    'started_by', n.started_by,
    'started_by_name', (select display_name from public.profiles where id = n.started_by),
    'genres', to_jsonb(n.genres),
    'options', n.options,
    'created_at', n.created_at,
    'last_activity_at', n.last_activity_at,
    'ended_at', n.ended_at,
    'ended_by', n.ended_by,
    'ended_by_name', (select display_name from public.profiles where id = n.ended_by),
    'picked_media_id', n.picked_media_id,
    'picked_title', (select title from public.media where id = n.picked_media_id),
    'picked_list_item_id', n.picked_list_item_id,
    'happened_on', n.happened_on
  );

  with av as materialized (select * from public.movie_night_all_votes(p_night)),
       af as materialized (select * from public.movie_night_all_finishes(p_night))
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'position', s.position,
      'created_by', s.created_by,
      'created_by_name', (select display_name from public.profiles where id = s.created_by),
      'created_at', s.created_at,
      'revealed', s.revealed_at is not null,
      'total', (select count(*) from public.movie_night_candidates c where c.stack_id = s.id),
      'my_voted', (select count(*) from av
                   join public.movie_night_candidates c on c.id = av.candidate_id
                   where c.stack_id = s.id and av.voter = v_me),
      'my_loves', (select count(*) from av
                   join public.movie_night_candidates c on c.id = av.candidate_id
                   where c.stack_id = s.id and av.voter = v_me and av.vote = 'love'),
      'my_finished', exists (select 1 from af where af.stack_id = s.id and af.voter = v_me),
      'can_see_results', v_ended or s.revealed_at is not null
                         or exists (select 1 from af where af.stack_id = s.id and af.voter = v_me)
    ) order by s.position), '[]'::jsonb)
  into v_stacks
  from public.movie_night_stacks s
  where s.night_id = p_night;

  -- The whole family, plus anyone who took part and has left since, plus the guests.
  with av as materialized (select * from public.movie_night_all_votes(p_night)),
       af as materialized (select * from public.movie_night_all_finishes(p_night))
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', u.voter,
      'name', u.name,
      'avatar_url', u.avatar_url,
      'guest', u.guest,
      'joined', u.guest or mm.user_id is not null,
      'watched', coalesce(mm.watched, false),
      'stacks', (select coalesce(jsonb_agg(jsonb_build_object(
                   'stack_id', s.id,
                   'voted', (select count(*) from av
                             join public.movie_night_candidates c on c.id = av.candidate_id
                             where c.stack_id = s.id and av.voter = u.voter),
                   'finished', exists (select 1 from af where af.stack_id = s.id and af.voter = u.voter)
                 ) order by s.position), '[]'::jsonb)
                 from public.movie_night_stacks s where s.night_id = p_night)
    ) order by u.name, u.voter), '[]'::jsonb)
  into v_members
  from (
    select p.id as voter, p.display_name as name, p.avatar_url, false as guest
    from public.profiles p
    where p.id in (select gm.user_id from public.group_members gm where gm.group_id = n.group_id
                   union
                   select mm2.user_id from public.movie_night_members mm2 where mm2.night_id = p_night)
    union all
    select g.id, g.name, null::text, true
    from public.movie_night_guests g
    where g.night_id = p_night
  ) u
  left join public.movie_night_members mm on mm.night_id = p_night and mm.user_id = u.voter and not u.guest;

  if p_full then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'stack_id', c.stack_id,
        'position', c.position,
        'origin', c.origin,
        'list_item_id', case when p_guest then null else c.list_item_id end,
        'media_id', m.id,
        'tmdb_id', m.tmdb_id,
        'media_type', m.media_type,
        'title', m.title,
        'year', m.release_year,
        'poster_path', m.poster_path,
        'backdrop_path', m.backdrop_path,
        'overview', m.overview,
        'rating', m.tmdb_rating,
        'runtime', m.runtime,
        'genres', m.genres,
        'trailer_key', m.trailer_key
      ) order by s.position, c.position), '[]'::jsonb)
    into v_candidates
    from public.movie_night_candidates c
    join public.movie_night_stacks s on s.id = c.stack_id
    join public.media m on m.id = c.media_id
    where c.night_id = p_night;
  end if;

  select coalesce(jsonb_object_agg(av.candidate_id, av.vote), '{}'::jsonb)
  into v_votes
  from public.movie_night_all_votes(p_night) av
  where av.voter = v_me;

  -- Ranked: points, then fewer nopes, more loves, the better TMDB score, and the order of the cards.
  with av as materialized (select * from public.movie_night_all_votes(p_night)),
  af as materialized (select * from public.movie_night_all_finishes(p_night)),
  visible as (
    select s.id
    from public.movie_night_stacks s
    where s.night_id = p_night
      and (v_ended or s.revealed_at is not null
           or exists (select 1 from af where af.stack_id = s.id and af.voter = v_me))
  ), tally as (
    select c.id as candidate_id, c.media_id, c.position, m.tmdb_rating,
           sum(case av.vote when 'love' then 2 when 'yes' then 1 when 'seen' then 0 else -1 end)::integer as points,
           count(*) filter (where av.vote = 'love')::integer as loves,
           count(*) filter (where av.vote = 'yes')::integer as yes,
           count(*) filter (where av.vote = 'seen')::integer as seen,
           count(*) filter (where av.vote = 'nope')::integer as nopes
    from public.movie_night_candidates c
    join visible on visible.id = c.stack_id
    join av on av.candidate_id = c.id
    join public.media m on m.id = c.media_id
    group by c.id, c.media_id, c.position, m.tmdb_rating
  ), ranked as (
    select t.*,
           row_number() over (order by t.points desc, t.nopes asc, t.loves desc,
                                       t.tmdb_rating desc nulls last, t.position asc, t.candidate_id) as rank
    from tally t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'candidate_id', r.candidate_id,
      'rank', r.rank,
      'points', r.points,
      'loves', r.loves,
      'yes', r.yes,
      'seen', r.seen,
      'nopes', r.nopes,
      'votes', (select jsonb_agg(jsonb_build_object('user_id', av.voter, 'name', coalesce(p.display_name, g.name),
                                                    'guest', av.guest, 'vote', av.vote)
                                 order by coalesce(p.display_name, g.name), av.voter)
                from av
                left join public.profiles p on p.id = av.voter and not av.guest
                left join public.movie_night_guests g on g.id = av.voter and av.guest
                where av.candidate_id = r.candidate_id),
      'on_family_list', exists (select 1 from public.list_items li
                                where li.group_id = n.group_id and li.media_id = r.media_id and li.deleted_at is null),
      'family_item_id', case when p_guest then null else
                          (select li.id from public.list_items li
                           where li.group_id = n.group_id and li.media_id = r.media_id and li.deleted_at is null) end,
      'on_my_list', not p_guest and exists (select 1 from public.list_items li
                                            where li.group_id is null and li.added_by = v_me and li.media_id = r.media_id
                                              and li.deleted_at is null)
    ) order by r.rank), '[]'::jsonb)
  into v_results
  from ranked r;

  return jsonb_build_object(
    'me', v_me,
    'viewer', case when p_guest then 'guest' else 'member' end,
    'night', v_night,
    'stacks', v_stacks,
    'members', v_members,
    'candidates', v_candidates,
    'my_votes', v_votes,
    'results', v_results
  );
end;
$$;

-- One night as the signed-in member may see it (see movie_night_state_for).
create function public.movie_night_state(p_night uuid, p_full boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  n := public.movie_night_for_member(p_night);
  return public.movie_night_state_for(n.id, p_full, auth.uid(), false);
end;
$$;

-- The caller's open movie nights, for the invite popup, the dot on the menu and the banners.
create function public.active_movie_nights()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return '[]'::jsonb;
  end if;
  update public.movie_nights mn
  set status = 'expired', ended_at = now()
  where mn.status = 'open' and mn.last_activity_at < now() - interval '12 hours'
    and public.is_group_member(mn.group_id, v_me);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'night_id', n.id,
      'group_id', n.group_id,
      'group_name', g.name,
      'started_by', n.started_by,
      'started_by_name', p.display_name,
      'created_at', n.created_at,
      'genres', to_jsonb(n.genres),
      'joined', exists (select 1 from public.movie_night_members mm where mm.night_id = n.id and mm.user_id = v_me),
      'stacks', (select count(*) from public.movie_night_stacks s where s.night_id = n.id),
      -- Stacks still open for voting that the caller hasn't finished.
      'waiting_stacks', (select count(*) from public.movie_night_stacks s
                         where s.night_id = n.id and s.revealed_at is null
                           and not exists (select 1 from public.movie_night_finishes f
                                           where f.stack_id = s.id and f.user_id = v_me)),
      'members', (select count(*) from public.group_members gm where gm.group_id = n.group_id),
      'done_members', (select count(*) from public.group_members gm
                       where gm.group_id = n.group_id
                         and not exists (select 1 from public.movie_night_stacks s
                                         where s.night_id = n.id and s.revealed_at is null
                                           and not exists (select 1 from public.movie_night_finishes f
                                                           where f.stack_id = s.id and f.user_id = gm.user_id)))
    ) order by n.created_at desc)
    from public.movie_nights n
    join public.groups g on g.id = n.group_id
    left join public.profiles p on p.id = n.started_by
    where n.status = 'open' and public.is_group_member(n.group_id, v_me)
  ), '[]'::jsonb);
end;
$$;

-- Someone who leaves a family drops out of its movie night that is still going; nights that are over keep their votes.
create function public.movie_night_member_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.movie_night_votes v
  using public.movie_night_candidates c, public.movie_nights n
  where v.candidate_id = c.id and c.night_id = n.id
    and n.group_id = old.group_id and n.status = 'open' and v.user_id = old.user_id;
  delete from public.movie_night_finishes f
  using public.movie_night_stacks s, public.movie_nights n
  where f.stack_id = s.id and s.night_id = n.id
    and n.group_id = old.group_id and n.status = 'open' and f.user_id = old.user_id;
  delete from public.movie_night_members m
  using public.movie_nights n
  where m.night_id = n.id
    and n.group_id = old.group_id and n.status = 'open' and m.user_id = old.user_id;
  return null;
end;
$$;

create trigger group_members_movie_night
  after delete on public.group_members
  for each row execute function public.movie_night_member_left();

-- Puts a night's best titles on the family list: the first 7 by rank (as in movie_night_state) among those with more than
-- 0 points, skipping what is already on the list and bringing back what was removed. Writes one "added N titles"
-- event in the caller's name. Returns how many went on the list.
create function public.movie_night_add_top_titles(p_night uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   uuid;
  r         record;
  v_item    uuid;
  v_deleted timestamptz;
  v_added   integer := 0;
begin
  select group_id into v_group from public.movie_nights where id = p_night;
  perform set_config('famflix.adding_from_night', 'on', true);
  for r in
    select c.media_id
    from public.movie_night_candidates c
    join public.movie_night_all_votes(p_night) v on v.candidate_id = c.id
    join public.media m on m.id = c.media_id
    where c.night_id = p_night
    group by c.id, c.media_id, c.position, m.tmdb_rating
    having sum(case v.vote when 'love' then 2 when 'yes' then 1 when 'seen' then 0 else -1 end) > 0
    order by sum(case v.vote when 'love' then 2 when 'yes' then 1 when 'seen' then 0 else -1 end) desc,
             count(*) filter (where v.vote = 'nope') asc,
             count(*) filter (where v.vote = 'love') desc,
             m.tmdb_rating desc nulls last, c.position asc, c.id
    limit 7
  loop
    select id, deleted_at into v_item, v_deleted
    from public.list_items where group_id = v_group and media_id = r.media_id;
    if not found then
      insert into public.list_items (group_id, added_by, media_id) values (v_group, auth.uid(), r.media_id);
      v_added := v_added + 1;
    elsif v_deleted is not null then
      update public.list_items set deleted_at = null where id = v_item;
      v_added := v_added + 1;
    end if;
  end loop;
  perform set_config('famflix.adding_from_night', 'off', true);
  if v_added > 0 then
    perform public.add_activity(v_group, 'movie_night_added', null, null, null, v_added::text);
  end if;
  return v_added;
end;
$$;

-- For a night that ended with nobody picking (cancelled or expired): adds its best titles to the family list.
create function public.add_movie_night_top_titles(p_night uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  n := public.movie_night_for_member(p_night);
  if n.source <> 'swipe' or n.status not in ('cancelled', 'expired') then
    raise exception 'The best titles are added when someone picks one';
  end if;
  return public.movie_night_add_top_titles(p_night);
end;
$$;

-- Called by log_watch once a watch is saved. If the family has a movie night going with this title as one of its cards,
-- the night ends with it (a pick), and its best titles join the family list. Otherwise the watch becomes a "logged" night
-- in the history, merging with one for the same title and day. The people who watched are marked on it. A series watched
-- together is only on the family's Watched together list: movie nights (and their history) are for movies.
create function public.record_movie_night_watch(p_item uuid, p_date date, p_viewers uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_media uuid;
  v_type  text;
  v_night uuid;
begin
  select li.group_id, li.media_id, m.media_type into v_group, v_media, v_type
  from public.list_items li join public.media m on m.id = li.media_id
  where li.id = p_item;
  if v_group is null then
    return;
  end if;
  update public.movie_nights
  set status = 'expired', ended_at = now()
  where group_id = v_group and status = 'open' and last_activity_at < now() - interval '12 hours';

  select n.id into v_night
  from public.movie_nights n
  join public.movie_night_candidates c on c.night_id = n.id
  where n.group_id = v_group and n.status = 'open' and c.media_id = v_media
  limit 1;

  if v_night is not null then
    update public.movie_nights
    set status = 'closed', ended_at = now(), ended_by = auth.uid(), picked_media_id = v_media,
        picked_list_item_id = p_item, happened_on = p_date, last_activity_at = now()
    where id = v_night;
    perform public.movie_night_add_top_titles(v_night);
  else
    if v_type <> 'movie' then
      return;
    end if;
    -- Someone else saving the same pick a moment later joins that night instead of making another.
    select id into v_night
    from public.movie_nights
    where group_id = v_group and status = 'closed' and picked_media_id = v_media and happened_on = p_date
    order by created_at
    limit 1;
    if v_night is null then
      insert into public.movie_nights
        (group_id, source, status, started_by, ended_at, ended_by, picked_media_id, picked_list_item_id, happened_on)
      values (v_group, 'logged', 'closed', auth.uid(), now(), auth.uid(), v_media, p_item, p_date)
      returning id into v_night;
    end if;
  end if;

  insert into public.movie_night_members (night_id, user_id, watched)
  select v_night, u, true from unnest(p_viewers) as u
  on conflict (night_id, user_id) do update set watched = true;
end;
$$;

-- Picks one of a night's cards to watch together: the title goes on the family list if it isn't there (or comes back
-- if it was removed), and the watch is logged like Watched together does, which ends the night and adds its best titles.
-- All in one go, so if the watch is refused nothing is added. Returns the list item, for the picker's note.
create function public.pick_movie_night_card(
  p_night      uuid,
  p_candidate  uuid,
  p_watched_on date,
  p_viewers    jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  n         public.movie_nights;
  v_media   uuid;
  v_item    uuid;
  v_deleted timestamptz;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  select media_id into v_media from public.movie_night_candidates where id = p_candidate and night_id = p_night;
  if v_media is null then
    raise exception 'That title is not in this movie night';
  end if;

  -- (set_config comes first: PERFORM would reset FOUND between the lookup and the check below.)
  perform set_config('famflix.adding_from_night', 'on', true);
  select id, deleted_at into v_item, v_deleted
  from public.list_items where group_id = n.group_id and media_id = v_media;
  if not found then
    insert into public.list_items (group_id, added_by, media_id)
    values (n.group_id, auth.uid(), v_media)
    returning id into v_item;
  elsif v_deleted is not null then
    update public.list_items set deleted_at = null where id = v_item;
  end if;
  perform set_config('famflix.adding_from_night', 'off', true);

  perform public.log_watch(v_item, p_watched_on, p_viewers);
  return v_item;
end;
$$;

-- Picks a title that isn't one of a night's cards: after the swiping the family decided on something else. The night
-- ends with it just as it would with a card: the title goes on the family list if it isn't there (or comes back if it
-- was removed), the watch is logged like Watched together does, the night is closed with it as its pick and its best
-- titles join the list. All in one go, so if the watch is refused nothing changes. Returns the list item, for the
-- picker's note.
create function public.pick_movie_night_title(
  p_night      uuid,
  p_media      uuid,
  p_watched_on date,
  p_viewers    jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  n         public.movie_nights;
  v_item    uuid;
  v_deleted timestamptz;
  v_type    text;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  select media_type into v_type from public.media where id = p_media;
  if not found then
    raise exception 'That title was not found';
  end if;
  if v_type <> 'movie' then
    raise exception 'Movie nights are for movies. Series are tracked on My list';
  end if;

  -- (set_config comes first: PERFORM would reset FOUND between the lookup and the check below.)
  perform set_config('famflix.adding_from_night', 'on', true);
  select id, deleted_at into v_item, v_deleted
  from public.list_items where group_id = n.group_id and media_id = p_media;
  if not found then
    insert into public.list_items (group_id, added_by, media_id)
    values (n.group_id, auth.uid(), p_media)
    returning id into v_item;
  elsif v_deleted is not null then
    update public.list_items set deleted_at = null where id = v_item;
  end if;
  perform set_config('famflix.adding_from_night', 'off', true);

  -- The night ends with this pick first, so that logging the watch finds a night that ended with this title that day
  -- and joins it, instead of making a "logged" one beside it.
  update public.movie_nights
  set status = 'closed', ended_at = now(), ended_by = auth.uid(), picked_media_id = p_media,
      picked_list_item_id = v_item, happened_on = p_watched_on, last_activity_at = now()
  where id = p_night and status = 'open';
  if not found then
    -- Someone else ended it in the meantime: say how, as for any other night that is over.
    perform public.movie_night_require_open(public.movie_night_for_member(p_night));
    raise exception 'This movie night has already ended';
  end if;

  perform public.log_watch(v_item, p_watched_on, p_viewers);
  perform public.movie_night_add_top_titles(p_night);

  -- The people who watched are marked on this night, whatever else was logged for the title that day.
  insert into public.movie_night_members (night_id, user_id, watched)
  select p_night, v.u, true
  from (select distinct (x ->> 'user_id')::uuid as u from jsonb_array_elements(p_viewers) as x) v
  on conflict (night_id, user_id) do update set watched = true;
  return v_item;
end;
$$;

-- ---------------------------------------------------------------------------
--  Movie night guests: people without an account, voting through a link
-- ---------------------------------------------------------------------------

-- Members: the link of an open night, made if it has none. Anyone in the family can share it.
create function public.get_movie_night_guest_link(p_night uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n       public.movie_nights;
  v_token text;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  perform public.hit_rate_limit(auth.uid(), 'night_link', 30, 3600);
  insert into public.movie_night_links (night_id, token, created_by)
  values (p_night, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), auth.uid())
  on conflict (night_id) do nothing;
  select token into v_token from public.movie_night_links where night_id = p_night;
  return v_token;
end;
$$;

-- Members: a new link; the old one stops working (guests who are in already stay in).
create function public.replace_movie_night_guest_link(p_night uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n       public.movie_nights;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  perform public.hit_rate_limit(auth.uid(), 'night_link', 30, 3600);
  insert into public.movie_night_links (night_id, token, created_by)
  values (p_night, v_token, auth.uid())
  on conflict (night_id) do update set token = excluded.token, created_by = excluded.created_by, created_at = now();
  return v_token;
end;
$$;

-- Members: no more guests can join (those who are in stay in).
create function public.turn_off_movie_night_guest_link(p_night uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  delete from public.movie_night_links where night_id = p_night;
end;
$$;

-- Members: takes a guest out of an open night, with their votes.
create function public.remove_movie_night_guest(p_night uuid, p_guest uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.movie_nights;
begin
  n := public.movie_night_for_member(p_night);
  perform public.movie_night_require_open(n);
  delete from public.movie_night_guests where id = p_guest and night_id = p_night;
  if not found then
    raise exception 'That guest is not in this movie night';
  end if;
end;
$$;

-- Members: who the guests of some of their family's nights were, for the history (a guest has no account, so there is
-- only a name). A night of another family, or one that doesn't exist, just has no guests here: nothing says which.
create function public.movie_night_guest_names(p_nights uuid[])
returns table (night_id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if coalesce(array_length(p_nights, 1), 0) > 50 then
    raise exception 'That is too many movie nights at once';
  end if;
  return query
    select g.night_id, g.name
    from public.movie_night_guests g
    join public.movie_nights n on n.id = g.night_id
    where g.night_id = any (p_nights)
      and public.is_group_member(n.group_id, auth.uid())
    order by g.night_id, lower(g.name), g.name;
end;
$$;

-- The night a link is for while that night is open; null for a link that is wrong, replaced or turned off, or whose
-- night is over. (A helper for the guest functions: it is not for the API.)
create function public.guest_link_night(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night uuid;
  v_open  boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select l.night_id into v_night from public.movie_night_links l where l.token = p_token;
  if v_night is null then
    return null;
  end if;
  perform public.settle_movie_night(v_night);
  select n.status = 'open' into v_open from public.movie_nights n where n.id = v_night;
  return case when v_open then v_night end;
end;
$$;

-- The guest a secret belongs to, and their night, as long as that night is open. A secret nobody has (never given,
-- or its guest was taken out) and a night that is over are told apart so the page can say which; neither says anything
-- more. (A helper for the guest functions: it is not for the API.)
create function public.guest_session(p_secret text, out guest_id uuid, out night_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'This movie night is not available';
  end if;
  select g.id, g.night_id into guest_id, night_id
  from public.movie_night_guests g
  where g.secret_hash = sha256(convert_to(p_secret, 'UTF8'));
  if not found then
    raise exception 'This movie night is not available';
  end if;
  perform public.settle_movie_night(night_id);
  select n.status into v_status from public.movie_nights n where n.id = night_id;
  if v_status <> 'open' then
    raise exception 'This movie night is over';
  end if;
end;
$$;

-- Server: what a link's page may say before anyone has joined: whether the night is open, whose it is (the page tells
-- the night's id only to a signed-in member of that family, who can open the night in the app), and whether it has all
-- the guests it takes.
create function public.guest_link_info(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night uuid := public.guest_link_night(p_token);
begin
  if v_night is null then
    return jsonb_build_object('open', false);
  end if;
  return jsonb_build_object(
    'open', true,
    'night_id', v_night,
    'family_name', (select g.name from public.movie_nights n join public.groups g on g.id = n.group_id where n.id = v_night),
    'full', (select count(*) from public.movie_night_guests where night_id = v_night) >= 10
  );
end;
$$;

-- Server: someone opens the link and gives a name (1 to 30 characters, different from the other guests'). Returns the
-- secret for their browser, which is the only time it exists in the clear, with their id and the night's.
create function public.guest_join(p_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night  uuid := public.guest_link_night(p_token);
  v_name   text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_secret text;
  v_guest  uuid;
begin
  if v_night is null then
    raise exception 'This movie night is over';
  end if;
  if v_name = '' or char_length(v_name) > 30 then
    raise exception 'Please enter a name of 1 to 30 characters';
  end if;
  if v_name ~ '[[:cntrl:]]' then
    raise exception 'Please enter a plain name';
  end if;

  -- One at a time per night, so the limit and the names are checked against who is really there.
  perform 1 from public.movie_nights where id = v_night for update;
  if (select count(*) from public.movie_night_guests where night_id = v_night) >= 10 then
    raise exception 'This movie night has all the guests it can take';
  end if;
  if exists (select 1 from public.movie_night_guests where night_id = v_night and lower(name) = lower(v_name)) then
    raise exception 'That name is taken in this movie night. Add an initial';
  end if;

  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.movie_night_guests (night_id, name, secret_hash)
  values (v_night, v_name, sha256(convert_to(v_secret, 'UTF8')))
  returning id into v_guest;
  update public.movie_nights set last_activity_at = now() where id = v_night;
  return jsonb_build_object('secret', v_secret, 'guest_id', v_guest, 'night_id', v_night);
end;
$$;

-- Server: the night for a guest (see movie_night_state_for).
create function public.guest_movie_night_state(p_secret text, p_full boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public.guest_session(p_secret);
  return public.movie_night_state_for(s.night_id, p_full, s.guest_id, true);
end;
$$;

-- Server: saves a guest's batch of votes on one stack, like cast_movie_night_votes does for a member. Returns the loves
-- used.
create function public.guest_cast_votes(p_secret text, p_stack uuid, p_votes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s       record;
  v_stack public.movie_night_stacks;
  v_loves integer;
  r       record;
begin
  select * into s from public.guest_session(p_secret);
  select * into v_stack from public.movie_night_stacks where id = p_stack and night_id = s.night_id;
  if not found then
    raise exception 'This movie night is not available';
  end if;
  if v_stack.revealed_at is not null then
    raise exception 'The results for this stack are already out';
  end if;
  if exists (select 1 from public.movie_night_guest_finishes where stack_id = p_stack and guest_id = s.guest_id) then
    raise exception 'You have already finished this stack';
  end if;
  if jsonb_typeof(p_votes) is distinct from 'array' or jsonb_array_length(p_votes) > 60 then
    raise exception 'Too many votes at once';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_votes) as e(elem)
    where jsonb_typeof(e.elem) is distinct from 'object'
       or not exists (
            select 1 from public.movie_night_candidates c
            where c.id = (e.elem ->> 'candidate_id')::uuid and c.stack_id = p_stack)
       or (e.elem ->> 'vote' is not null and e.elem ->> 'vote' not in ('nope', 'yes', 'love', 'seen'))
  ) then
    raise exception 'Those votes are not for this stack';
  end if;

  for r in
    select (e.elem ->> 'candidate_id')::uuid as candidate_id, e.elem ->> 'vote' as vote
    from jsonb_array_elements(p_votes) with ordinality as e(elem, pos)
    order by e.pos
  loop
    if r.vote is null then
      delete from public.movie_night_guest_votes where candidate_id = r.candidate_id and guest_id = s.guest_id;
    else
      insert into public.movie_night_guest_votes (candidate_id, guest_id, vote)
      values (r.candidate_id, s.guest_id, r.vote)
      on conflict (candidate_id, guest_id) do update set vote = excluded.vote, voted_at = now();
    end if;
  end loop;

  select count(*) into v_loves
  from public.movie_night_guest_votes v
  join public.movie_night_candidates c on c.id = v.candidate_id
  where c.stack_id = p_stack and v.guest_id = s.guest_id and v.vote = 'love';
  if v_loves > 3 then
    raise exception 'You can love at most 3 titles in a stack';
  end if;

  update public.movie_nights set last_activity_at = now() where id = s.night_id;
  return v_loves;
end;
$$;

-- Server: marks a guest's swiping of a stack as done.
create function public.guest_finish_stack(p_secret text, p_stack uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select * into s from public.guest_session(p_secret);
  if not exists (select 1 from public.movie_night_stacks where id = p_stack and night_id = s.night_id) then
    raise exception 'This movie night is not available';
  end if;
  insert into public.movie_night_guest_finishes (stack_id, guest_id) values (p_stack, s.guest_id) on conflict do nothing;
  update public.movie_nights set last_activity_at = now() where id = s.night_id;
end;
$$;

-- Server: a guest leaves (their votes go). Quietly does nothing for a secret nobody has.
create function public.guest_leave(p_secret text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.movie_night_guests
  where p_secret ~ '^[0-9a-f]{64}$' and secret_hash = sha256(convert_to(p_secret, 'UTF8'));
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

  -- A family's feed keeps its latest 500 events, so it can't grow without end.
  delete from public.activity
  where id in (
    select id from public.activity
    where group_id = p_group
    order by created_at desc
    offset 500
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
  -- A movie night putting titles on the list writes one "added N titles" event for all of them instead.
  if current_setting('famflix.adding_from_night', true) = 'on' then
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
    if old.user_id = auth.uid()
       or current_setting('famflix.deleting_account', true) = 'on' then
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
  -- Only scores you gave yourself (not ones filled in for you), and only when the score changes or you take over a
  -- score someone filled in for you, so editing just the note keeps a reaction you picked by hand.
  if new.score is null or new.rated_by is distinct from new.user_id then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.score is not distinct from old.score
     and new.rated_by is not distinct from old.rated_by then
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
--  Grants: what each Supabase role may do, stated outright
-- ---------------------------------------------------------------------------

-- A grant decides whether a role can reach a table or function through the API at all; the row-level security rules
-- above then decide which rows. Supabase used to hand every new table and function to anon, authenticated and
-- service_role by itself. New projects no longer do (since 30 May 2026) and neither will any project from
-- 30 October 2026, so nothing here counts on it: everything is taken back first, then each role gets exactly what it
-- needs, and the result is the same on a project with either default. Whatever is added to this schema later needs
-- its own grants too.
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

-- Visitors who aren't signed in (anon) get nothing: no table and no function.

-- Signed-in people read what the security rules let them see.
grant select on
  public.profiles, public.groups, public.group_members, public.media, public.list_items, public.ratings,
  public.reactions, public.watches, public.episode_logs, public.activity, public.movie_nights,
  public.movie_night_stacks, public.movie_night_candidates, public.movie_night_votes, public.movie_night_finishes,
  public.movie_night_members
  to authenticated;
-- They write straight to a table only where the security rules allow it (their own rows); everything else goes
-- through the functions below, so the feed, the movie nights and the rate limits can't be faked.
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.ratings, public.reactions to authenticated;
-- A list item's list, movie and author are fixed once it's added; afterwards people only mark it watched or
-- remove/restore it (the database fills in who removed it and when).
grant insert (group_id, added_by, media_id, status) on public.list_items to authenticated;
grant update (status, watched_at, deleted_at) on public.list_items to authenticated;
-- People may only skip their own request or take themselves off a watch; all other writes go through log_watch().
grant update (skipped_at) on public.watches to authenticated;
grant delete on public.watches to authenticated;
-- Everyone shares the movie info, so nobody can rewrite titles and posters for the rest; only the server saves it.

-- The server, with the service-role key, saves the movie info and counts the rate limits.
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on function public.hit_rate_limit(uuid, text, integer, integer) to service_role;
-- And speaks for the guests of a movie night, who have no account: these check the guest's secret themselves.
grant execute on function
  public.guest_link_info(text),
  public.guest_join(text, text),
  public.guest_movie_night_state(text, boolean),
  public.guest_cast_votes(text, uuid, jsonb),
  public.guest_finish_stack(text, uuid),
  public.guest_leave(text)
  to service_role;

-- Signed-in people call these. The first four are also the ones the security rules call. Every other function is for
-- the database itself (helpers, and what triggers run, which doesn't need EXECUTE).
grant execute on function
  public.is_group_member(uuid, uuid),
  public.shares_group(uuid, uuid),
  public.can_see_item(uuid),
  public.can_see_night(uuid),
  public.create_group(text),
  public.join_group(text),
  public.refresh_invite_codes(),
  public.rename_group(uuid, text),
  public.regenerate_invite_code(uuid),
  public.remove_member(uuid, uuid),
  public.leave_group(uuid),
  public.log_watch(uuid, date, jsonb),
  public.pending_rating_requests(),
  public.start_movie_night(uuid, text[], jsonb, jsonb),
  public.join_movie_night(uuid),
  public.cast_movie_night_votes(uuid, jsonb),
  public.finish_movie_night_stack(uuid),
  public.add_movie_night_stack(uuid, integer, jsonb),
  public.reveal_movie_night(uuid),
  public.cancel_movie_night(uuid),
  public.movie_night_state(uuid, boolean),
  public.active_movie_nights(),
  public.add_movie_night_top_titles(uuid),
  public.pick_movie_night_card(uuid, uuid, date, jsonb),
  public.pick_movie_night_title(uuid, uuid, date, jsonb),
  public.mark_episodes(uuid, boolean, integer, integer, integer, integer, date),
  public.mark_next_episode(uuid, date),
  public.rate_episode(uuid, integer, integer, numeric, text),
  public.my_series_progress(),
  public.get_movie_night_guest_link(uuid),
  public.replace_movie_night_guest_link(uuid),
  public.turn_off_movie_night_guest_link(uuid),
  public.remove_movie_night_guest(uuid, uuid),
  public.movie_night_guest_names(uuid[])
  to authenticated;

-- Let the Supabase API pick up the new tables and functions right away.
notify pgrst, 'reload schema';

commit;
