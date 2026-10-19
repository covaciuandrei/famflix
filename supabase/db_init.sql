-- ============================================================================
--  FamFlix — the whole database in one script: tables, row-level security,
--  functions and triggers (families and lists, who in a family may see your list, ratings, watched together and
--  watching a title again, series episodes, the activity feed, rate limits, movie
--  nights and their guests) and, at the end, exactly what each Supabase role may
--  do with them.
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
  created_at   timestamptz not null default now(),
  -- Whether the people in their families can see what is on their My list (member_list()). Theirs to switch.
  share_my_list boolean not null default true
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
  -- When it was watched. A Watched title with no time is one nobody remembers the day of: it is watched, and is not
  -- counted for any year.
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

-- Earlier viewings of a title, kept when it is watched again: one row per person, title and day. What a list shows now (the
-- current viewing) stays in watches and list_items; watch_again() and the functions next to it move it here. group_id is
-- the family it was watched with, empty for a viewing on one's own, and once that family is gone. Nobody writes to it
-- directly: only those functions do. watched_on is empty for a viewing nobody remembers the day of: any number of
-- those can be kept (a null is never the same day as another), and they are not counted for any year.
create table public.watch_history (
  -- Own id key (like ratings) so PostgREST doesn't treat this as a profiles <-> media join table.
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  media_id   uuid not null references public.media (id) on delete cascade,
  watched_on date,
  group_id   uuid references public.groups (id) on delete set null,
  logged_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, media_id, watched_on)
);
create index watch_history_media_idx on public.watch_history (media_id);
create index watch_history_group_idx on public.watch_history (group_id);
create index watch_history_logged_by_idx on public.watch_history (logged_by);

-- The episodes someone has ticked on a series on their My list, with their own score and note for each. One row per
-- ticked episode, so Not started is no rows. Only mark_episodes(), mark_next_episode(), redate_episodes(),
-- rate_episode(), watch_series_again() and watch_episode_again() write it. watched_on is empty for an episode nobody
-- remembers the day of: it is watched, and is not counted for any year.
create table public.episode_logs (
  list_item_id   uuid not null references public.list_items (id) on delete cascade,
  season_number  smallint not null check (season_number between 1 and 200),
  episode_number smallint not null check (episode_number between 1 and 20000),
  watched_on     date default current_date,
  score          numeric(3,1) check (score between 1 and 10),
  comment        text check (char_length(comment) <= 250),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (list_item_id, season_number, episode_number)
);

-- The earlier viewings of the episodes of a series on someone's My list, kept when an episode is watched again or the
-- series is started again; episode_logs keeps the current one. A viewing is the episode on one day, with the score and
-- note it had then. `pass` is the time through the series it belonged to (1 for the first time, 2 for the second...), or
-- null for a viewing of a single episode that was watched again. Only watch_series_again() and watch_episode_again()
-- write it. watched_on is empty for a viewing nobody remembers the day of.
create table public.episode_history (
  list_item_id   uuid not null references public.list_items (id) on delete cascade,
  season_number  smallint not null check (season_number between 1 and 200),
  episode_number smallint not null check (episode_number between 1 and 20000),
  watched_on     date,
  score          numeric(3,1) check (score between 1 and 10),
  comment        text check (char_length(comment) <= 250),
  pass           smallint check (pass >= 1),
  created_at     timestamptz not null default now(),
  id             uuid primary key default gen_random_uuid()
);
-- One viewing of an episode per day, and any number of them with no day (a null is never the same day as another).
create unique index episode_history_viewing_uniq
  on public.episode_history (list_item_id, season_number, episode_number, watched_on);

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

-- A movie night planned ahead: a family picks a day and a time (and perhaps a mood, as when a night starts), and its
-- members answer Going, Maybe or Can't. Starting a night from a plan links the two (night_id). A plan nobody starts is
-- over 24 hours after its time. There is no calendar file, no e-mail: the reminders are in the app. Only the planning
-- functions write these two tables.
create table public.movie_night_plans (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  starts_at  timestamptz not null,
  note       text check (char_length(note) <= 100),
  -- The mood the night starts with: browse category slugs (at most 5) and options, as on movie_nights.
  genres     text[] not null default '{}' check (cardinality(genres) <= 5),
  options    jsonb not null default '{}'::jsonb,
  status     text not null default 'planned' check (status in ('planned', 'started', 'cancelled', 'expired')),
  -- The night that was started from it.
  night_id   uuid references public.movie_nights (id) on delete set null,
  created_at timestamptz not null default now(),
  -- When it stopped being planned (started, cancelled or expired), and who started or cancelled it.
  ended_at   timestamptz,
  ended_by   uuid references public.profiles (id) on delete set null
);
create index movie_night_plans_group_idx on public.movie_night_plans (group_id, starts_at);
create index movie_night_plans_created_by_idx on public.movie_night_plans (created_by);
create index movie_night_plans_ended_by_idx on public.movie_night_plans (ended_by);
create index movie_night_plans_night_idx on public.movie_night_plans (night_id);

-- Who answered what: Going, Maybe or Can't (no). One answer each; taking it back deletes the row.
create table public.movie_night_plan_rsvps (
  plan_id    uuid not null references public.movie_night_plans (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  answer     text not null check (answer in ('going', 'maybe', 'no')),
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index movie_night_plan_rsvps_user_idx on public.movie_night_plan_rsvps (user_id);

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
alter table public.watch_history enable row level security;
alter table public.episode_logs  enable row level security;
alter table public.episode_history enable row level security;
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
alter table public.movie_night_plans          enable row level security;
alter table public.movie_night_plan_rsvps     enable row level security;

-- profiles ------------------------------------------------------------------
-- No insert policy: a profile is made by handle_new_user() when someone first signs in. They may update their own row,
-- but the only column granted to them is the display name (see the grants at the end of this file).
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()) or public.shares_group((select auth.uid()), id));
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
-- episode_history: the same, for the viewings before the current one.
create policy episode_history_select on public.episode_history for select using (
  exists (
    select 1 from public.list_items li
    where li.id = list_item_id and li.group_id is null and li.added_by = (select auth.uid())
  )
);
create policy watches_update_own on public.watches for update
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy watches_delete_own on public.watches for delete
  using (user_id = (select auth.uid()));
-- watch_history: your own viewings, and those of the families you are in; no write policies, the functions write them.
create policy watch_history_select on public.watch_history for select using (
  user_id = (select auth.uid())
  or (group_id is not null and public.is_group_member(group_id, (select auth.uid())))
);

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
-- planned movie nights: the family reads its plans and everybody's answers; all changes go through the planning functions.
create policy movie_night_plans_select on public.movie_night_plans for select
  using (public.is_group_member(group_id, (select auth.uid())));
create policy movie_night_plan_rsvps_select on public.movie_night_plan_rsvps for select
  using (exists (
    select 1 from public.movie_night_plans p
    where p.id = plan_id and public.is_group_member(p.group_id, (select auth.uid()))
  ));

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
    -- The lines that list everyone who watched: a title logged as watched together, and a movie night edited since.
    update public.activity
    set detail = array_to_string(array(
          select case when n = old.display_name then 'someone' else n end
          from unnest(string_to_array(detail, ', ')) as n
        ), ', ')
    where kind in ('watched_together', 'movie_night_edited')
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

create function public.remove_member(p_group uuid, p_user uuid)
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

  -- The title first, then the people on its record: the order update_movie_night(), delete_movie_night() and
  -- watch_again() lock them in too, so none of them can end up waiting on another. (Someone taking themselves off a watch
  -- locks their own row and then needs the title, the other way round: if that happens for the same title at the same
  -- moment as one of these, the database stops one of them with a deadlock error, and doing it again works.)
  perform 1 from public.list_items where id = p_item and deleted_at is null for update;
  if not found then
    raise exception 'This title is not on one of your family lists';
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
-- on the record it stays watched together. (Moving the record into the history is not leaving it: see
-- archive_family_viewing(), which says so with a setting.)
create function public.after_watch_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('famflix.archiving_watch', true) = 'on' then
    return null;
  end if;

  -- What the watch put on their My list goes off it again.
  perform public.remove_from_my_list_watched(old.list_item_id, old.user_id);

  if not exists (select 1 from public.watches where list_item_id = old.list_item_id) then
    update public.list_items
    set status = 'want', watched_at = null
    where id = old.list_item_id and status = 'watched';
  end if;

  -- The movie night history follows: that person didn't watch it after all, and a "logged" night nobody is left
  -- on never happened. Not the nights of a viewing they have in their history (the title was watched again since):
  -- they were there, and those stay as they are. Not while editing or deleting one night either (update_movie_night(),
  -- delete_movie_night()): they handle that night themselves, and no other night of the title may change with it.
  if current_setting('famflix.editing_night', true) is distinct from 'on' then
    update public.movie_night_members m
    set watched = false
    from public.movie_nights n
    where n.id = m.night_id and n.picked_list_item_id = old.list_item_id and m.user_id = old.user_id
      and not exists (select 1 from public.watch_history h
                      where h.user_id = old.user_id and h.media_id = n.picked_media_id and h.watched_on = n.happened_on);
    delete from public.movie_nights n
    where n.source = 'logged' and n.picked_list_item_id = old.list_item_id
      and not exists (select 1 from public.movie_night_members m where m.night_id = n.id and m.watched);
  end if;
  return null;
end;
$$;

create trigger watches_after_delete
  after delete on public.watches
  for each row execute function public.after_watch_delete();

-- ---------------------------------------------------------------------------
--  Watching a title again: the viewing it had goes to the history
-- ---------------------------------------------------------------------------

-- Moves a family title's current viewing into the history and puts the title back on To watch: every row of its
-- watch record becomes a viewing of that person on that day, the record is emptied and the title is To watch again.
-- Its scores, notes, reactions and everyone's My list entry stay as they are. Returns how many viewings were kept.
-- (A helper for watch_again(), watched_again() and the movie night picks: it is not for the API.)
create function public.archive_family_viewing(p_item uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_media uuid;
  v_kept  integer;
begin
  select group_id, media_id into v_group, v_media from public.list_items where id = p_item for update;
  if v_group is null then
    return 0;
  end if;

  insert into public.watch_history (user_id, media_id, watched_on, group_id, logged_by)
  select w.user_id, v_media, w.watched_on, v_group, w.logged_by
  from public.watches w
  where w.list_item_id = p_item
  on conflict (user_id, media_id, watched_on) do update
    set group_id = coalesce(public.watch_history.group_id, excluded.group_id);
  get diagnostics v_kept = row_count;

  -- Leaving the record would take the title off people's My list and out of the movie night history: this isn't that.
  perform set_config('famflix.archiving_watch', 'on', true);
  delete from public.watches where list_item_id = p_item;
  perform set_config('famflix.archiving_watch', 'off', true);

  update public.list_items set status = 'want', watched_at = null where id = p_item and status = 'watched';
  return v_kept;
end;
$$;

-- Moves the caller's current viewing of a title on their My list into the history (a viewing a family put there is
-- remembered as that family's; one with no day is kept with no day), and makes the entry their own again, on To watch or
-- Watched on the given day. Returns nothing; the callers check who may do it.
create function public.archive_my_viewing(p_item uuid, p_status text, p_on date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  li      public.list_items;
  v_group uuid;
begin
  select * into li from public.list_items where id = p_item;
  if li.status = 'watched' then
    select group_id into v_group from public.list_items where id = li.source_item_id;
    insert into public.watch_history (user_id, media_id, watched_on, group_id)
    values (li.added_by, li.media_id, (li.watched_at at time zone 'UTC')::date, v_group)
    on conflict (user_id, media_id, watched_on) do update
      set group_id = coalesce(public.watch_history.group_id, excluded.group_id);
  end if;
  update public.list_items
  set status = p_status,
      watched_at = case when p_status = 'watched' then least(now(), p_on::timestamptz + interval '12 hours') end,
      source_item_id = null,
      watch_origin = null
  where id = p_item;
end;
$$;

-- Puts a watched title back on To watch, for a movie night or for next time, and keeps the viewing it had in the history.
-- A family title: any member. A title on My list: its owner (a series with episodes is started again from its page).
create function public.watch_again(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  li public.list_items;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  select * into li from public.list_items where id = p_item and deleted_at is null for update;
  if not found
     or (li.group_id is null and li.added_by is distinct from auth.uid())
     or (li.group_id is not null and not public.is_group_member(li.group_id, auth.uid())) then
    raise exception 'This title is not on one of your lists';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'watch_again', 60, 3600);

  if li.status <> 'watched' then
    raise exception 'This title is not marked as watched';
  end if;

  if li.group_id is not null then
    if not exists (select 1 from public.watches where list_item_id = p_item) then
      raise exception 'This title is not marked as watched';
    end if;
    perform public.archive_family_viewing(p_item);
    perform public.add_activity(li.group_id, 'watch_again', p_item);
    return;
  end if;

  if exists (select 1 from public.media m where m.id = li.media_id and m.series is not null) then
    raise exception 'Start a series again from its page';
  end if;
  perform public.archive_my_viewing(p_item, 'want');
end;
$$;

-- Logs a new viewing of a title that was watched before: the viewing it had goes to the history and this one takes its
-- place. A family title: the same window as Watched together (the day, who watched, their scores). A title on My list:
-- the day. For a title that isn't watched at the moment (it was put back on To watch) it is simply logged.
create function public.watched_again(p_item uuid, p_watched_on date, p_viewers jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  li public.list_items;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  select * into li from public.list_items where id = p_item and deleted_at is null for update;
  if not found
     or (li.group_id is null and li.added_by is distinct from auth.uid())
     or (li.group_id is not null and not public.is_group_member(li.group_id, auth.uid())) then
    raise exception 'This title is not on one of your lists';
  end if;
  perform public.hit_rate_limit(auth.uid(), 'watch_again', 60, 3600);

  if li.group_id is not null then
    -- (The day and the people are checked by log_watch, before anything changes.)
    if exists (select 1 from public.watches where list_item_id = p_item) then
      perform public.archive_family_viewing(p_item);
    end if;
    perform public.log_watch(p_item, p_watched_on, p_viewers);
    return;
  end if;

  if exists (select 1 from public.media m where m.id = li.media_id and m.series is not null) then
    raise exception 'Start a series again from its page';
  end if;
  -- One day of slack: the browser's "today" can be ahead of the server's (UTC).
  if p_watched_on is null or p_watched_on > current_date + 1 then
    raise exception 'Pick a date that is not in the future';
  end if;
  perform public.archive_my_viewing(p_item, 'watched', p_watched_on);
end;
$$;

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
  v_prev date;
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

  -- They watched it another time too (it is in their history): the entry stays, as of that time (with no day, if that is
  -- all they know), with its score and note.
  if v_mine.status = 'watched' and v_mine.watch_origin is not null
     and exists (select 1 from public.watch_history h where h.user_id = p_user and h.media_id = v_mine.media_id) then
    select max(h.watched_on) into v_prev from public.watch_history h
    where h.user_id = p_user and h.media_id = v_mine.media_id;
    update public.list_items
    set watched_at = case when v_prev is null then null else least(now(), v_prev::timestamptz + interval '12 hours') end
    where id = v_mine.id;
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

-- A series that has ended and has every aired episode ticked is Watched, as of the day given: today when none is (the
-- time it is now), and no day at all when it is null (the episodes were ticked with no day). Returns whether it just
-- became so.
create function public.episodes_complete_if_done(p_item uuid, p_series jsonb, p_on date default current_date)
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
  update public.list_items
  set status = 'watched',
      watched_at = case when p_on is null then null
                        when p_on >= current_date then now()
                        else p_on::timestamptz + interval '12 hours' end
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
-- everything up to an episode (from 1, 1). They are ticked as watched on p_on: today when it is left out, and no day at
-- all when it is null (someone catching up on a series, who doesn't remember when: those episodes are watched but are
-- not counted for any year). Only aired episodes can be ticked. Ticking the last aired episode of a series that has
-- ended makes it Watched. Unticking on a series that is Watched first ticks every aired episode for real (a Watched
-- series shows all of them as watched), then takes these off and puts the series back to To watch. Unticking also takes
-- off the episodes' scores and notes. Returns {"changed": episodes ticked or unticked, "completed": it became Watched,
-- "reopened": it stopped being Watched}.
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
  -- One day of slack: the browser's "today" can be ahead of the server's (UTC).
  if p_on > current_date + 1 then
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
    v_completed := public.episodes_complete_if_done(p_item, v_series, p_on);
  else
    if v_status = 'watched' and v_aired > 0 then
      insert into public.episode_logs (list_item_id, season_number, episode_number, watched_on)
      select p_item, x.n, g.e, v_watched::date
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

-- Ticks the first aired episode that isn't ticked yet, as watched on p_on (today when it is left out, no day when it is
-- null). Returns {"season", "episode", "completed"}.
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
  if p_on > current_date + 1 then
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
  v_completed := public.episodes_complete_if_done(p_item, v_series, p_on);
  return jsonb_build_object('season', v_season, 'episode', v_episode, 'completed', v_completed);
end;
$$;

-- Gives the episodes that are ticked from (p_from_season, p_from_episode) to (p_to_season, p_to_episode), both included,
-- on a series on the caller's My list, another day: the one they were really watched on, or no day (null) when it
-- isn't known, which keeps them out of Your year. It only changes ticks that are there (it never ticks or unticks an
-- episode), keeps their scores and notes, and leaves the viewings in the history as they are. Returns how many ticks
-- were in the range.
create function public.redate_episodes(
  p_item         uuid,
  p_from_season  integer,
  p_from_episode integer,
  p_to_season    integer,
  p_to_episode   integer,
  p_on           date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series  jsonb;
  v_changed integer;
begin
  select m.series into v_series from public.episodes_my_item(p_item) as m;

  if p_from_season is null or p_from_episode is null or p_to_season is null or p_to_episode is null then
    raise exception 'Pick the episodes';
  end if;
  -- One day of slack: the browser's "today" can be ahead of the server's (UTC).
  if p_on > current_date + 1 then
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

  update public.episode_logs l
  set watched_on = p_on, updated_at = now()
  where l.list_item_id = p_item
    and (l.season_number, l.episode_number) >= (p_from_season, p_from_episode)
    and (l.season_number, l.episode_number) <= (p_to_season, p_to_episode);
  get diagnostics v_changed = row_count;
  return v_changed;
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
--  Series: watching it, or one episode, again
-- ---------------------------------------------------------------------------

-- Starts a series on the caller's My list again, as a new pass: every episode they have watched of it (every aired
-- episode if it is marked Watched, dated by when it was marked, or with no day if that isn't known) goes into
-- episode_history as the next pass, with its day, score and note, the ticks are cleared and the series is back on To
-- watch. The series' own score and note stay, and an entry that a family's watch put on My list becomes theirs again.
-- Returns {"pass": the number of the pass that was kept, "episodes": how many episodes it had}.
create function public.watch_series_again(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_watched timestamptz;
  v_series  jsonb;
  v_pass    integer;
  v_kept    integer;
begin
  select m.status, m.watched_at, m.series into v_status, v_watched, v_series from public.episodes_my_item(p_item) as m;
  perform public.hit_rate_limit(auth.uid(), 'watch_again', 60, 3600);

  if v_status <> 'watched' and not exists (select 1 from public.episode_logs where list_item_id = p_item) then
    raise exception 'There is nothing to start again: no episode is watched';
  end if;

  select coalesce(max(h.pass), 0) + 1 into v_pass from public.episode_history h where h.list_item_id = p_item;

  insert into public.episode_history as h (list_item_id, season_number, episode_number, watched_on, score, comment, pass)
  select p_item, w.season_number, w.episode_number, w.watched_on, w.score, w.comment, v_pass
  from (
    select l.season_number::integer as season_number, l.episode_number::integer as episode_number, l.watched_on,
           l.score, l.comment
    from public.episode_logs l
    where l.list_item_id = p_item
    union all
    select x.n, g.e, v_watched::date, null::numeric, null::text
    from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
    cross join lateral generate_series(1, public.series_aired(v_series, x.n)) as g(e)
    where v_status = 'watched'
      and not exists (select 1 from public.episode_logs l
                      where l.list_item_id = p_item and l.season_number = x.n and l.episode_number = g.e)
  ) w
  on conflict (list_item_id, season_number, episode_number, watched_on) do update
    set pass    = coalesce(excluded.pass, h.pass),
        score   = coalesce(excluded.score, h.score),
        comment = coalesce(excluded.comment, h.comment);
  get diagnostics v_kept = row_count;

  delete from public.episode_logs where list_item_id = p_item;
  update public.list_items
  set status = 'want', watched_at = null, source_item_id = null, watch_origin = null
  where id = p_item;
  return jsonb_build_object('pass', v_pass, 'episodes', v_kept);
end;
$$;

-- Logs another viewing of one episode that the caller has watched, of a series on their My list: the day it has now
-- (with its score and note) goes into episode_history, and the episode gets the new day, keeping its score and note.
-- A series marked Watched counts every aired episode as watched, dated by when it was marked. An episode with no day
-- keeps that viewing with no day. The day it already has is refused.
create function public.watch_episode_again(p_item uuid, p_season integer, p_episode integer, p_on date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_watched timestamptz;
  v_series  jsonb;
  v_log     public.episode_logs;
  v_was     date;
begin
  select m.status, m.watched_at, m.series into v_status, v_watched, v_series from public.episodes_my_item(p_item) as m;
  perform public.hit_rate_limit(auth.uid(), 'watch_again', 60, 3600);

  if p_season is null or p_episode is null or p_season < 1 or p_episode < 1 or not exists (
       select 1 from jsonb_to_recordset(v_series -> 'seasons') as x(n integer, episodes integer)
       where x.n = p_season and p_episode <= x.episodes) then
    raise exception 'That episode is not listed for this series';
  end if;
  if p_episode > public.series_aired(v_series, p_season) then
    raise exception 'That episode has not aired yet';
  end if;
  -- One day of slack: the browser's "today" can be ahead of the server's (UTC).
  if p_on is null or p_on > current_date + 1 then
    raise exception 'Pick a date that is not in the future';
  end if;

  select * into v_log from public.episode_logs l
  where l.list_item_id = p_item and l.season_number = p_season and l.episode_number = p_episode;
  if found then
    v_was := v_log.watched_on;
  elsif v_status = 'watched' then
    v_was := v_watched::date;
  else
    raise exception 'You have not watched this episode yet';
  end if;
  if p_on = v_was then
    raise exception 'The episode already has that day';
  end if;

  insert into public.episode_history as h (list_item_id, season_number, episode_number, watched_on, score, comment)
  values (p_item, p_season, p_episode, v_was, v_log.score, v_log.comment)
  on conflict (list_item_id, season_number, episode_number, watched_on) do update
    set score   = coalesce(excluded.score, h.score),
        comment = coalesce(excluded.comment, h.comment);

  insert into public.episode_logs as e (list_item_id, season_number, episode_number, watched_on)
  values (p_item, p_season, p_episode, p_on)
  on conflict (list_item_id, season_number, episode_number) do update
    set watched_on = excluded.watched_on, updated_at = now();
end;
$$;

-- How many times through each series on the caller's My list has been kept in the history (a series started again), for
-- its card. The current pass is the next one.
create function public.my_series_passes()
returns table (list_item_id uuid, passes integer)
language sql
stable
security definer
set search_path = public
as $$
  select h.list_item_id, max(h.pass)::integer
  from public.episode_history h
  join public.list_items li on li.id = h.list_item_id
  where li.group_id is null and li.added_by = auth.uid() and li.deleted_at is null and h.pass is not null
  group by h.list_item_id;
$$;

-- How many episodes the caller watched on their My list, for Your year: per series and per month. A viewing is an
-- episode on one day: the same episode on another day counts again, twice on one day counts once. It is an episode
-- ticked now (episode_logs), one kept when the series was started again or the episode watched again (episode_history),
-- or one that a series marked Watched counts as watched without a tick, dated by when it was marked. A viewing with no
-- day (nobody remembers when) is not counted, not even for all time. A title taken off My list still counts, it was
-- watched. p_year keeps the viewings of one year, null is all time. Returns
-- {"by_series": {"<My list entry>": episodes}, "by_month": {"YYYY-MM": episodes}}. One value, so the API's cap on rows
-- doesn't cut it short.
create function public.my_episode_counts(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;

  return (
    with viewed as (
      select e.list_item_id as item, e.season_number::integer as season, e.episode_number::integer as episode,
             e.watched_on as day
      from public.episode_logs e
      join public.list_items li on li.id = e.list_item_id
      where li.group_id is null and li.added_by = v_me
      union
      select h.list_item_id, h.season_number::integer, h.episode_number::integer, h.watched_on
      from public.episode_history h
      join public.list_items li on li.id = h.list_item_id
      where li.group_id is null and li.added_by = v_me
      union
      select li.id, x.n, g.e, li.watched_at::date
      from public.list_items li
      join public.media m on m.id = li.media_id and m.series is not null
      cross join lateral jsonb_to_recordset(m.series -> 'seasons') as x(n integer, episodes integer)
      cross join lateral generate_series(1, public.series_aired(m.series, x.n)) as g(e)
      where li.group_id is null and li.added_by = v_me and li.status = 'watched' and li.watched_at is not null
        and not exists (select 1 from public.episode_logs l
                        where l.list_item_id = li.id and l.season_number = x.n and l.episode_number = g.e)
    ),
    counted as (
      select v.item, v.day from viewed v
      where isfinite(v.day) and (p_year is null or extract(year from v.day) = p_year)
    )
    select jsonb_build_object(
      'by_series', coalesce((select jsonb_object_agg(s.item, s.n)
                             from (select c.item, count(*) as n from counted c group by c.item) s), '{}'::jsonb),
      'by_month', coalesce((select jsonb_object_agg(s.month, s.n)
                            from (select to_char(c.day, 'YYYY-MM') as month, count(*) as n
                                  from counted c group by 1) s), '{}'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
--  The lists of the people in your families
-- ---------------------------------------------------------------------------

-- What is on another person's My list, for someone who is in a family with them, unless they switched that off
-- (profiles.share_my_list). Only what a list shows of a title and where it stands: the title, whether it is watched
-- and when, and the owner's score; never their notes or reactions, and never a title they removed. Nothing for your own
-- list (it is yours to read as it is), for someone you share no family with, or for a list that is not shared. The
-- titles of the family lists are not here: every member reads those anyway. A function rather than a rule on
-- list_items, so that what other people can read stays exactly this.
create function public.member_list(p_user uuid)
returns table (
  tmdb_id      integer,
  media_type   text,
  title        text,
  release_year integer,
  poster_path  text,
  tmdb_rating  numeric,
  status       text,
  watched_at   timestamptz,
  added_at     timestamptz,
  score        numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select m.tmdb_id, m.media_type, m.title, m.release_year, m.poster_path, m.tmdb_rating,
         li.status, li.watched_at, li.created_at, r.score
  from public.list_items li
  join public.media m on m.id = li.media_id
  left join public.ratings r on r.list_item_id = li.id and r.user_id = li.added_by
  where li.group_id is null
    and li.added_by = p_user
    and li.deleted_at is null
    and p_user is distinct from auth.uid()
    and public.shares_group(auth.uid(), p_user)
    and coalesce((select p.share_my_list from public.profiles p where p.id = p_user), false)
  order by li.created_at desc, li.id;
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

-- Checks the mood of a night (or of a plan): up to 5 browse category slugs and {"count": 8-40, "max": minutes or null}
-- (movie nights are for movies, so "series" is false or left out; it is kept in the saved options for the nights made
-- before that). Returns {"genres": [...], "options": {...}} as it is saved, or says what is wrong.
create function public.movie_night_mood(p_genres text[], p_options jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_genres  text[] := coalesce(p_genres, '{}');
  v_options jsonb;
begin
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
  return jsonb_build_object('genres', to_jsonb(v_genres), 'options', v_options);
end;
$$;

-- Starts a movie night for a family with its first stack. Any member can; one night at a time per family.
-- p_genres and p_options: the mood (see movie_night_mood). p_plan: a plan of the family's that this night comes from; the
-- night then has the plan's mood (what is passed for it is ignored), and the plan is marked started and linked to it in
-- the same go, so a night that can't start leaves the plan as it was.
create function public.start_movie_night(
  p_group      uuid,
  p_genres     text[],
  p_options    jsonb,
  p_candidates jsonb,
  p_plan       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_genres  text[];
  v_options jsonb;
  v_mood    jsonb;
  v_plan    public.movie_night_plans;
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

  if p_plan is null then
    v_mood := public.movie_night_mood(p_genres, p_options);
    v_genres := array(select jsonb_array_elements_text(v_mood -> 'genres'));
    v_options := v_mood -> 'options';
  else
    perform public.settle_movie_night_plans(p_group);
    select * into v_plan from public.movie_night_plans where id = p_plan and group_id = p_group for update;
    if not found then
      raise exception 'This movie night plan is not available';
    end if;
    perform public.movie_night_plan_require_planned(v_plan);
    v_genres := v_plan.genres;
    v_options := v_plan.options;
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

  if p_plan is not null then
    update public.movie_night_plans
    set status = 'started', night_id = v_night, ended_at = now(), ended_by = auth.uid()
    where id = p_plan;
  end if;

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
-- sends the cards, each with the number of days its family has watched the title before (a guest isn't told). The
-- voter is a member or, with p_guest, a guest, who is told nothing about the family's lists. The
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
    'picked_tmdb_id', (select tmdb_id from public.media where id = n.picked_media_id),
    'picked_media_type', (select media_type from public.media where id = n.picked_media_id),
    'picked_list_item_id', n.picked_list_item_id,
    'happened_on', n.happened_on,
    -- What the viewer may do with a night that is over (never a guest): see update_movie_night(), delete_movie_night().
    'can_edit', (not p_guest) and (public.movie_night_edit_problem(n) is null),
    'can_delete', (not p_guest) and public.movie_night_can_delete(n, v_me)
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
        'trailer_key', m.trailer_key,
        'watched_before', case when p_guest then null else
                            (select count(distinct wh.watched_on)::integer from public.watch_history wh
                             where wh.group_id = n.group_id and wh.media_id = m.id) end
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

-- ---------------------------------------------------------------------------
--  Planning a movie night: a day and a time, and who is coming
-- ---------------------------------------------------------------------------

-- A plan nobody started is over 24 hours after its time. Everything that reads or changes a family's plans calls this
-- first.
create function public.settle_movie_night_plans(p_group uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.movie_night_plans
  set status = 'expired', ended_at = now()
  where group_id = p_group and status = 'planned' and starts_at < now() - interval '24 hours';
$$;

-- Stops with a plain message unless the plan is still planned.
create function public.movie_night_plan_require_planned(p public.movie_night_plans)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p.status = 'planned' then
    return;
  elsif p.status = 'started' then
    raise exception 'This movie night has already started';
  elsif p.status = 'cancelled' then
    raise exception 'This movie night plan was cancelled';
  end if;
  raise exception 'This movie night plan has passed';
end;
$$;

-- Plans a movie night for a family: any member can. It must be in the future and within a year, a family has at most 5
-- planned, and the note (optional) is at most 100 characters. The mood (p_genres, p_options) is the one a night starts
-- with. The person who plans it is Going. Writes a line in the family's feed. Returns the plan's id.
create function public.plan_movie_night(
  p_group     uuid,
  p_starts_at timestamptz,
  p_note      text default null,
  p_genres    text[] default null,
  p_options   jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), '');
  v_mood jsonb;
  v_plan uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;
  if not public.is_group_member(p_group, v_me) then
    raise exception 'You are not in this family';
  end if;
  perform public.hit_rate_limit(v_me, 'plan_night', 10, 3600);

  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'Pick a time in the future';
  end if;
  if p_starts_at > now() + interval '1 year' then
    raise exception 'Plan a movie night within the next year';
  end if;
  if char_length(v_note) > 100 then
    raise exception 'A note can be 100 characters at most';
  end if;
  v_mood := public.movie_night_mood(p_genres, p_options);

  -- One at a time for a family, so two members can't both take the last of the 5.
  perform pg_advisory_xact_lock(hashtextextended('movie_night_plans:' || p_group::text, 0));
  perform public.settle_movie_night_plans(p_group);
  if (select count(*) from public.movie_night_plans where group_id = p_group and status = 'planned') >= 5 then
    raise exception 'This family already has 5 movie nights planned';
  end if;

  insert into public.movie_night_plans (group_id, created_by, starts_at, note, genres, options)
  values (p_group, v_me, p_starts_at, v_note, array(select jsonb_array_elements_text(v_mood -> 'genres')), v_mood -> 'options')
  returning id into v_plan;
  insert into public.movie_night_plan_rsvps (plan_id, user_id, answer) values (v_plan, v_me, 'going');

  perform public.add_activity(
    p_group, 'movie_night_planned', null, null, null,
    to_char(p_starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
  return v_plan;
end;
$$;

-- Answers a plan of the caller's family: 'going', 'maybe' or 'no', or null to take the answer back. Only while the plan
-- is still planned.
create function public.rsvp_movie_night_plan(p_plan uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_plan public.movie_night_plans;
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;
  select * into v_plan from public.movie_night_plans where id = p_plan;
  if not found or not public.is_group_member(v_plan.group_id, v_me) then
    raise exception 'This movie night plan is not available';
  end if;
  perform public.hit_rate_limit(v_me, 'plan_rsvp', 60, 3600);
  perform public.settle_movie_night_plans(v_plan.group_id);
  select * into v_plan from public.movie_night_plans where id = p_plan;
  perform public.movie_night_plan_require_planned(v_plan);

  if p_answer is null then
    delete from public.movie_night_plan_rsvps where plan_id = p_plan and user_id = v_me;
    return;
  end if;
  if p_answer not in ('going', 'maybe', 'no') then
    raise exception 'Answer Going, Maybe or Can''t';
  end if;
  insert into public.movie_night_plan_rsvps (plan_id, user_id, answer)
  values (p_plan, v_me, p_answer)
  on conflict (plan_id, user_id) do update set answer = excluded.answer, updated_at = now();
end;
$$;

-- Cancels a plan of the caller's family: any member can, while it is still planned. Writes a line in the family's feed.
create function public.cancel_movie_night_plan(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_plan public.movie_night_plans;
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;
  select * into v_plan from public.movie_night_plans where id = p_plan for update;
  if not found or not public.is_group_member(v_plan.group_id, v_me) then
    raise exception 'This movie night plan is not available';
  end if;
  perform public.settle_movie_night_plans(v_plan.group_id);
  select * into v_plan from public.movie_night_plans where id = p_plan;
  perform public.movie_night_plan_require_planned(v_plan);

  update public.movie_night_plans set status = 'cancelled', ended_at = now(), ended_by = v_me where id = p_plan;
  perform public.add_activity(
    v_plan.group_id, 'movie_night_plan_cancelled', null, null, null,
    to_char(v_plan.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end;
$$;

-- A family's plans for the Movie night page, as one value: the ones still planned, soonest first, then the ones that were
-- cancelled or passed in the last day. Each has its note, mood, who planned it, everybody's answers and the caller's.
create function public.planned_movie_nights(p_group uuid)
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
  if not public.is_group_member(p_group, v_me) then
    raise exception 'You are not in this family';
  end if;
  perform public.settle_movie_night_plans(p_group);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'starts_at', p.starts_at,
        'note', p.note,
        'genres', to_jsonb(p.genres),
        'options', p.options,
        'status', p.status,
        'created_by', p.created_by,
        'created_by_name', (select pr.display_name from public.profiles pr where pr.id = p.created_by),
        'ended_at', p.ended_at,
        'my_answer', (select r.answer from public.movie_night_plan_rsvps r where r.plan_id = p.id and r.user_id = v_me),
        'answers', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', pr.display_name, 'answer', r.answer)
                           order by r.updated_at, r.user_id)
          from public.movie_night_plan_rsvps r
          join public.profiles pr on pr.id = r.user_id
          where r.plan_id = p.id
        ), '[]'::jsonb)
      ) order by (p.status = 'planned') desc, case when p.status = 'planned' then p.starts_at end, p.ended_at desc, p.id)
    from public.movie_night_plans p
    where p.group_id = p_group
      and (p.status = 'planned' or (p.status in ('cancelled', 'expired') and p.ended_at > now() - interval '1 day'))
  ), '[]'::jsonb);
end;
$$;

-- The plans to remind the caller of, across their families: still planned, from 60 minutes before their time to 3 hours
-- after, and not ones the caller answered Can't. As one value; each has the family, the time, the note, the caller's
-- answer and how many are going.
create function public.due_movie_night_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'group_id', p.group_id,
        'group_name', g.name,
        'starts_at', p.starts_at,
        'note', p.note,
        'my_answer', r.answer,
        'going', (select count(*) from public.movie_night_plan_rsvps x where x.plan_id = p.id and x.answer = 'going')
      ) order by p.starts_at, p.id)
    from public.movie_night_plans p
    join public.groups g on g.id = p.group_id
    left join public.movie_night_plan_rsvps r on r.plan_id = p.id and r.user_id = v_me
    where p.status = 'planned'
      and public.is_group_member(p.group_id, v_me)
      and p.starts_at between now() - interval '3 hours' and now() + interval '60 minutes'
      and r.answer is distinct from 'no'
  ), '[]'::jsonb);
end;
$$;

-- Someone who leaves a family takes their answers off its plans (the plans stay).
create function public.movie_night_plan_member_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.movie_night_plan_rsvps r
  using public.movie_night_plans p
  where r.plan_id = p.id and p.group_id = old.group_id and r.user_id = old.user_id;
  return null;
end;
$$;

create trigger group_members_movie_night_plan
  after delete on public.group_members
  for each row execute function public.movie_night_plan_member_left();

-- Whoever plans a movie night can delete their account without taking the plan from the family, but the note they wrote
-- goes with them (the plan, with its answers, stays without their name).
create function public.movie_night_plan_creator_gone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.movie_night_plans set note = null where created_by = old.id and note is not null;
  return old;
end;
$$;

create trigger profiles_before_delete_plans
  before delete on public.profiles
  for each row execute function public.movie_night_plan_creator_gone();

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

  -- Everyone on the title's record for that day was there, including those an earlier log put on it: a night made after
  -- the earlier one was deleted (the viewing stays when a night is) knows them all, not only the people of this log.
  insert into public.movie_night_members (night_id, user_id, watched)
  select v_night, w.user_id, true
  from public.watches w
  where w.list_item_id = p_item and w.watched_on = p_date
  on conflict (night_id, user_id) do update set watched = true;

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

  -- A pick on a later day than the title's current viewing is a new viewing: the earlier one goes to the history.
  if (select max(w.watched_on) from public.watches w where w.list_item_id = v_item) < p_watched_on then
    perform public.archive_family_viewing(v_item);
  end if;

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

  -- A pick on a later day than the title's current viewing is a new viewing: the earlier one goes to the history.
  if (select max(w.watched_on) from public.watches w where w.list_item_id = v_item) < p_watched_on then
    perform public.archive_family_viewing(v_item);
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
--  Editing and deleting a movie night
-- ---------------------------------------------------------------------------

-- A night that picked a title records who watched it as the title's current viewing on the family list (its watches),
-- which belongs to the title, not to the night. So a night can only be edited while that record is unmistakably its own:
-- this says why it isn't, or is null when it is. The night picked a title that is still on the list; its viewing hasn't
-- gone to the history (the title has none on the night's day, and, while nobody is on the record, none later either: a
-- night the same people were logged for again on a later day is left behind, still saying they watched it, and the
-- record is empty once the title is put back on the list to watch again); no other night of the same title and day
-- claims the same people; everyone on the record was logged on the night's day; and the night says exactly who is on
-- the record. (A helper for update_movie_night(), delete_movie_night() and the night's state: it is not for the API.)
create function public.movie_night_edit_problem(n public.movie_nights)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_deleted timestamptz;
begin
  if n.status <> 'closed' or n.picked_list_item_id is null then
    return 'Only a movie night that picked a title can be edited';
  end if;
  select li.deleted_at into v_deleted from public.list_items li where li.id = n.picked_list_item_id;
  if not found then
    return 'Only a movie night that picked a title can be edited';
  end if;
  if v_deleted is not null then
    return 'This title was removed from the family list: restore it first to edit this movie night';
  end if;
  if exists (select 1 from public.watch_history h
             where h.media_id = n.picked_media_id and h.group_id = n.group_id
               and (h.watched_on = n.happened_on
                    or (h.watched_on > n.happened_on
                        and not exists (select 1 from public.watches w where w.list_item_id = n.picked_list_item_id)))) then
    return 'This is an earlier viewing: the title was put back on the list to watch again since';
  end if;
  if exists (select 1 from public.movie_nights o
             where o.picked_list_item_id = n.picked_list_item_id and o.id <> n.id and o.status = 'closed'
               and o.happened_on = n.happened_on) then
    return 'Another movie night picked this title on the same day, so who watched it can''t be told apart here';
  end if;
  if exists (select 1 from public.watches w where w.list_item_id = n.picked_list_item_id and w.watched_on <> n.happened_on) then
    return 'People were logged on different days for this title, so it can''t be edited here';
  end if;
  -- A night left behind (the same people were logged again on another day, or the viewing was moved) still says people
  -- watched it when the record says someone else, or nobody: it describes nothing that can be changed here.
  if (select coalesce(array_agg(m.user_id order by m.user_id), '{}') from public.movie_night_members m
      where m.night_id = n.id and m.watched)
     is distinct from
     (select coalesce(array_agg(w.user_id order by w.user_id), '{}') from public.watches w
      where w.list_item_id = n.picked_list_item_id) then
    return 'Who this movie night says watched it is not who the title says watched it, so it can''t be edited here';
  end if;
  return null;
end;
$$;

-- Whether a person may delete a night that is over: the family's owner, whoever started it, or whoever picked, logged or
-- cancelled it. Never null: the starter and the person who ended it are null once they have deleted their account, and
-- "not null" would then let the caller through, so a night like that can be deleted by the owner only. (A helper, like the
-- one above.)
create function public.movie_night_can_delete(n public.movie_nights, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select n.status <> 'open'
     and public.is_group_member(n.group_id, p_user)
     and (public.is_group_owner(n.group_id, p_user)
          or coalesce(n.started_by = p_user, false)
          or coalesce(n.ended_by = p_user, false));
$$;

-- Whether someone has rated, noted or reacted to a family title themselves, or has a reaction on their own My list entry
-- for it. Taking them off the title's viewing would take that entry off their My list, so only they may do it (with "I
-- wasn't there"). A score is theirs when they gave it, or when nobody is recorded as having given it (from before the
-- database recorded who); one somebody else filled in for them isn't. A note always is: only the person can write one, so
-- it stays theirs even when someone filled a score in beside it afterwards (which makes that someone the score's author).
-- The family-wide thumb doesn't count, it stays. (A helper, like the ones above.)
create function public.watcher_has_own_state(p_item uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.list_items li
    join public.ratings r on r.list_item_id = li.id and r.user_id = p_user
    where (li.id = p_item or (li.group_id is null and li.added_by = p_user and li.source_item_id = p_item))
      and (r.rated_by is null or r.rated_by = p_user or nullif(btrim(r.comment), '') is not null)
  ) or exists (
    select 1
    from public.list_items li
    join public.reactions x on x.list_item_id = li.id and x.user_id = p_user
    where li.group_id is null and li.added_by = p_user and li.source_item_id = p_item
  );
$$;

-- Changes who watched the title a night picked, and on which day, for any member of the family. p_viewers is
-- [{"user_id": "<uuid>", "score": 1-10 or null}, ...] as for log_watch: everyone who watched, so people who were left out
-- are added (to their My list too, and they are asked to rate it) and people who are left out are taken off, unless
-- they rated, noted or reacted to it themselves (see watcher_has_own_state). People who left the family stay as they were.
-- p_expected_on and p_expected_viewers are what the editor saw when they opened it: if someone changed the night
-- since, nothing is saved. Everything is saved or nothing is.
create function public.update_movie_night(
  p_night            uuid,
  p_watched_on       date,
  p_viewers          jsonb,
  p_expected_on      date default null,
  p_expected_viewers uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  n         public.movie_nights;
  v_item    uuid;
  v_problem text;
  v         record;
  v_user    uuid;
  v_score   numeric;
  v_ids     uuid[] := '{}';
  v_old     uuid[];
  v_added   uuid[];
  v_removed uuid[];
  v_prev    date;
  v_names   text;
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;
  perform public.hit_rate_limit(v_me, 'edit_night', 60, 3600);

  n := public.movie_night_for_member(p_night);
  v_item := n.picked_list_item_id;
  -- The title, then the people on its record, then the night: the same order wherever more than one is locked.
  if v_item is not null then
    perform 1 from public.list_items where id = v_item for update;
    perform 1 from public.watches where list_item_id = v_item order by user_id for update;
  end if;
  select * into n from public.movie_nights where id = p_night for update;
  if not found or not public.is_group_member(n.group_id, v_me) then
    raise exception 'This movie night is not available';
  end if;
  if n.picked_list_item_id is distinct from v_item then
    raise exception 'This movie night changed. Please try again';
  end if;
  v_problem := public.movie_night_edit_problem(n);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  -- The people on the record now (members of the family: people who left are not ours to change).
  select coalesce(array_agg(w.user_id order by w.user_id), '{}') into v_old
  from public.watches w
  where w.list_item_id = v_item and public.is_group_member(n.group_id, w.user_id);
  if (p_expected_on is not null and p_expected_on <> n.happened_on)
     or (p_expected_viewers is not null and not (v_old @> p_expected_viewers and v_old <@ p_expected_viewers)) then
    raise exception 'Someone changed this movie night while you were editing it. Close this window and open it again';
  end if;

  -- One day of slack: the browser's "today" can be ahead of the server's (UTC).
  if p_watched_on is null or p_watched_on > current_date + 1 then
    raise exception 'Pick a date that is not in the future';
  end if;
  -- After the title's earlier viewings (on one of their days it would count as one of them).
  select max(h.watched_on) into v_prev
  from public.watch_history h where h.media_id = n.picked_media_id and h.group_id = n.group_id;
  if v_prev is not null and p_watched_on <= v_prev then
    raise exception 'The day has to be after the earlier viewing, on %', to_char(v_prev, 'FMDD Mon YYYY');
  end if;

  if jsonb_typeof(p_viewers) is distinct from 'array' or jsonb_array_length(p_viewers) = 0 then
    raise exception 'Pick at least one person who watched it';
  end if;
  for v in
    select x.user_id, round(x.score, 1) as score
    from jsonb_to_recordset(p_viewers) as x(user_id uuid, score numeric)
  loop
    if v.user_id is null or not public.is_group_member(n.group_id, v.user_id) then
      raise exception 'Only members of this family can be added';
    end if;
    if v.score is not null and (v.score < 1 or v.score > 10) then
      raise exception 'Scores must be between 1 and 10';
    end if;
    v_ids := v_ids || v.user_id;
  end loop;
  v_ids := array(select distinct u from unnest(v_ids) u);
  v_added := array(select u from unnest(v_ids) u except select w from unnest(v_old) w);
  v_removed := array(select w from unnest(v_old) w except select u from unnest(v_ids) u);

  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 and p_watched_on = n.happened_on then
    return;
  end if;

  foreach v_user in array v_removed loop
    if public.watcher_has_own_state(v_item, v_user) then
      raise exception '%', case when v_user = v_me
        then 'You can only take yourself off this movie night ("I wasn''t there" on the family list)'
        else coalesce((select display_name from public.profiles where id = v_user), 'Someone')
             || ' can only take themselves off this movie night ("I wasn''t there" on the family list)' end;
    end if;
  end loop;

  perform set_config('famflix.editing_night', 'on', true);

  if p_watched_on <> n.happened_on then
    update public.watches set watched_on = p_watched_on where list_item_id = v_item;
    update public.movie_nights set happened_on = p_watched_on where id = n.id;
    -- The My list entries this watch put there follow the day, for the people on the record only: one that was removed,
    -- or that the person has made their own, isn't touched, and neither is that of someone who was at an earlier viewing
    -- of the title (their entry still links to it) but not at this one.
    update public.list_items li
    set watched_at = least(now(), p_watched_on::timestamptz + interval '12 hours')
    where li.group_id is null and li.source_item_id = v_item and li.watch_origin is not null
      and li.status = 'watched' and li.deleted_at is null
      and exists (select 1 from public.watches w where w.list_item_id = v_item and w.user_id = li.added_by);
  end if;

  -- First the people who are added, so the night is never left with nobody on it.
  foreach v_user in array v_added loop
    insert into public.watches (list_item_id, user_id, watched_on, logged_by)
    values (v_item, v_user, p_watched_on, v_me)
    on conflict (list_item_id, user_id) do nothing;
    -- It goes on their My list as Watched too, with the others who were there. (Before the score below, which then
    -- follows it there.)
    perform public.add_to_my_list_watched(v_item, v_user, p_watched_on);
    select round(x.score, 1) into v_score
    from jsonb_to_recordset(p_viewers) as x(user_id uuid, score numeric)
    where x.user_id = v_user
    limit 1;
    -- Only fills in a missing score; never overwrites one that already exists.
    if v_score is not null then
      insert into public.ratings as r (list_item_id, user_id, score)
      values (v_item, v_user, v_score)
      on conflict (list_item_id, user_id) do update
        set score = excluded.score, updated_at = now()
        where r.score is null;
    end if;
  end loop;
  if cardinality(v_added) > 0 then
    -- A night everyone had been taken off is watched again.
    perform set_config('famflix.logging_watch', 'on', true);
    update public.list_items set status = 'watched', watched_at = now() where id = v_item and status <> 'watched';
  end if;
  insert into public.movie_night_members (night_id, user_id, watched)
  select n.id, u, true from unnest(v_ids) u
  on conflict (night_id, user_id) do update set watched = true;

  if cardinality(v_removed) > 0 then
    -- Leaving the record takes the title off their My list again (after_watch_delete); the scores filled in for them go.
    delete from public.watches where list_item_id = v_item and user_id = any (v_removed);
    delete from public.ratings where list_item_id = v_item and user_id = any (v_removed);
    update public.movie_night_members set watched = false where night_id = n.id and user_id = any (v_removed);
  end if;
  perform set_config('famflix.editing_night', 'off', true);

  select string_agg(coalesce(p.display_name, 'someone'), ', ' order by p.display_name) into v_names
  from unnest(v_ids) u left join public.profiles p on p.id = u;
  perform public.add_activity(n.group_id, 'movie_night_edited', v_item, null, null, v_names);
end;
$$;

-- Deletes a night that is over, from the family's history for everyone, with its votes, guests and link. Allowed for the
-- family's owner and whoever started or ended it (movie_night_can_delete). The title, its viewing and everyone's My list stay
-- as they are, and so do the titles a pick added to the family list, unless p_undo_watch takes the title off Watched
-- together as well: everyone on its record is taken off (the title is To watch again), which only works while the night is
-- the title's latest viewing and nobody on it has rated, noted or reacted to it themselves. A plan that started the night
-- stays started.
create function public.delete_movie_night(p_night uuid, p_undo_watch boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  n         public.movie_nights;
  v_item    uuid;
  v_problem text;
  v_users   uuid[];
  v_user    uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in';
  end if;
  perform public.hit_rate_limit(v_me, 'delete_night', 30, 3600);

  n := public.movie_night_for_member(p_night);
  v_item := n.picked_list_item_id;
  if v_item is not null then
    perform 1 from public.list_items where id = v_item for update;
    perform 1 from public.watches where list_item_id = v_item order by user_id for update;
  end if;
  select * into n from public.movie_nights where id = p_night for update;
  if not found or not public.is_group_member(n.group_id, v_me) then
    raise exception 'This movie night is not available';
  end if;
  if n.picked_list_item_id is distinct from v_item then
    raise exception 'This movie night changed. Please try again';
  end if;
  if n.status = 'open' then
    raise exception 'Cancel this movie night first';
  end if;
  if not public.movie_night_can_delete(n, v_me) then
    raise exception 'Only the family''s owner, or whoever started or ended this movie night, can delete it';
  end if;

  if coalesce(p_undo_watch, false) then
    v_problem := public.movie_night_edit_problem(n);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
    select coalesce(array_agg(w.user_id), '{}') into v_users from public.watches w where w.list_item_id = v_item;
    foreach v_user in array v_users loop
      if public.watcher_has_own_state(v_item, v_user) then
        raise exception '%', case when v_user = v_me
          then 'You can only take yourself off it ("I wasn''t there" on the family list)'
          else coalesce((select display_name from public.profiles where id = v_user), 'Someone')
               || ' can only take themselves off it ("I wasn''t there" on the family list)' end;
      end if;
    end loop;
    perform set_config('famflix.editing_night', 'on', true);
    delete from public.watches where list_item_id = v_item;
    delete from public.ratings where list_item_id = v_item and user_id = any (v_users);
    perform set_config('famflix.editing_night', 'off', true);
  end if;

  -- The detail is the night's day, and "undone" when the title went back to To watch.
  perform public.add_activity(n.group_id, 'movie_night_deleted', v_item, null, null,
                              n.happened_on::text || case when coalesce(p_undo_watch, false) then ' undone' else '' end);
  delete from public.movie_nights where id = n.id;
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
--  Your data: everything FamFlix keeps about the caller, in one go
-- ---------------------------------------------------------------------------

-- Everything the caller has put into FamFlix, or that was recorded about them, as one JSON document: the account, the
-- families, My list (with ticked episodes and earlier viewings), their watch history, their part of each family list
-- (the titles they added, and their scores, notes, reactions and watches), the movie nights they took part in, the movie
-- nights they planned or answered (their own answer, and the note only where it is theirs) and the family feed events
-- they caused. The app turns it into a download and adds the e-mail address, which comes from the
-- sign-in and is in none of these tables. Only what is theirs: the other people on a family list appear by display name,
-- where they watched something with the caller and only for a family the caller is still in; their scores, notes,
-- reactions and e-mail addresses never do, nor do guests, invite codes or the temporary rate-limit counters (the
-- document lists what it leaves out). A family the caller has left shows what they did there, with no other names.
-- Its current name, list status/removals, night outcomes and plan status are withheld: they can change after departure.
-- One value, so the API's cap on rows doesn't cut it short.
create function public.export_my_data()
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
  public.reactions, public.watches, public.watch_history, public.episode_logs, public.episode_history, public.activity,
  public.movie_nights,
  public.movie_night_stacks, public.movie_night_candidates, public.movie_night_votes, public.movie_night_finishes,
  public.movie_night_members, public.movie_night_plans, public.movie_night_plan_rsvps
  to authenticated;
-- They write straight to a table only where the security rules allow it (their own rows); everything else goes
-- through the functions below, so the feed, the movie nights and the rate limits can't be faked.
-- A profile is made at sign-up and its photo is Google's, which other people's browsers load: the only columns people
-- may change on it are their own display name and whether their families can see their My list.
grant update (display_name, share_my_list) on public.profiles to authenticated;
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
  public.watch_again(uuid),
  public.watched_again(uuid, date, jsonb),
  public.pending_rating_requests(),
  public.start_movie_night(uuid, text[], jsonb, jsonb, uuid),
  public.plan_movie_night(uuid, timestamptz, text, text[], jsonb),
  public.rsvp_movie_night_plan(uuid, text),
  public.cancel_movie_night_plan(uuid),
  public.planned_movie_nights(uuid),
  public.due_movie_night_plans(),
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
  public.update_movie_night(uuid, date, jsonb, date, uuid[]),
  public.delete_movie_night(uuid, boolean),
  public.mark_episodes(uuid, boolean, integer, integer, integer, integer, date),
  public.mark_next_episode(uuid, date),
  public.redate_episodes(uuid, integer, integer, integer, integer, date),
  public.rate_episode(uuid, integer, integer, numeric, text),
  public.watch_series_again(uuid),
  public.watch_episode_again(uuid, integer, integer, date),
  public.my_series_progress(),
  public.my_series_passes(),
  public.my_episode_counts(integer),
  public.member_list(uuid),
  public.export_my_data(),
  public.get_movie_night_guest_link(uuid),
  public.replace_movie_night_guest_link(uuid),
  public.turn_off_movie_night_guest_link(uuid),
  public.remove_movie_night_guest(uuid, uuid),
  public.movie_night_guest_names(uuid[])
  to authenticated;

-- Let the Supabase API pick up the new tables and functions right away.
notify pgrst, 'reload schema';


-- BEGIN:movie-night-attendance
-- Kept identical to upgrade_movie_night_attendance.sql (without its transaction wrapper).
-- Existing installations: back up first, then run once before deploying the matching app.
-- This same upgrade is included at the end of db_init.sql for fresh installations.

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
-- END:movie-night-attendance

commit;
