\set ON_ERROR_STOP 1
\set as_service 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role service_role;'

-- The end of db_init.sql says outright what each Supabase role may do (it can't count on Supabase's defaults, which
-- differ between projects). This pins that down, so a new table or function can't be left open to visitors, or closed
-- to the app, by accident: adding one means adding it here too.
reset role;

-- Only tables (and their indexes) in public: a view or a sequence would need grants of its own.
select test.expect_eq((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind not in ('r', 'i')),
  0::bigint, 'public holds only tables and indexes');
select test.expect_eq((select array_agg(relname::text order by relname::text collate "C") from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'),
  (select array_agg(x order by x collate "C") from unnest(array['activity', 'episode_history', 'episode_logs', 'group_members', 'groups', 'list_items', 'media',
    'movie_night_candidates', 'movie_night_finishes', 'movie_night_guest_finishes', 'movie_night_guest_votes',
    'movie_night_guests', 'movie_night_links', 'movie_night_members', 'movie_night_plan_rsvps', 'movie_night_plans',
    'movie_night_stacks', 'movie_night_votes',
    'movie_nights', 'profiles', 'rate_limits', 'ratings', 'reactions', 'watch_history', 'watches']) x),
  'the tables are the ones whose grants are pinned here');

-- Visitors who aren't signed in: nothing at all, and nothing that everyone gets by default either.
select test.expect_eq((select count(*) from pg_class c, unnest(array['select', 'insert', 'update', 'references']) p
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_any_column_privilege('anon', c.oid, p)),
  0::bigint, 'visitors can read or write no table, not even a column');
select test.expect_eq((select count(*) from pg_class c, unnest(array['delete', 'truncate', 'trigger']) p
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('anon', c.oid, p)),
  0::bigint, 'visitors have no other table privilege either');
select test.expect_eq((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  0::bigint, 'visitors, and everyone by default, can run no function');
select test.expect_eq(has_schema_privilege('anon', 'public', 'usage'), true, 'the API can still reach the schema as a visitor');

-- Signed-in people: read what the security rules show them, write only where those rules allow it.
select test.expect_eq((select array_agg(c.relname || ':' || p order by (c.relname || ':' || p) collate "C")
  from pg_class c, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, p)),
  (select array_agg(x order by x collate "C") from unnest(array[
    'activity:select', 'episode_history:select', 'episode_logs:select', 'group_members:select', 'groups:select', 'list_items:select', 'media:select',
    'movie_night_candidates:select', 'movie_night_finishes:select', 'movie_night_members:select',
    'movie_night_plan_rsvps:select', 'movie_night_plans:select',
    'movie_night_stacks:select', 'movie_night_votes:select', 'movie_nights:select',
    'profiles:select',
    'ratings:select', 'ratings:insert', 'ratings:update', 'ratings:delete',
    'reactions:select', 'reactions:insert', 'reactions:update', 'reactions:delete',
    'watch_history:select', 'watches:select', 'watches:delete']) x),
  'signed-in people have exactly these table privileges');
select test.expect_eq((select array_agg(c.relname || '.' || a.attname || ':' || p order by (c.relname || '.' || a.attname || ':' || p) collate "C")
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped,
  unnest(array['insert', 'update']) p
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and has_column_privilege('authenticated', c.oid, a.attnum, p) and not has_table_privilege('authenticated', c.oid, p)),
  (select array_agg(x order by x collate "C") from unnest(array[
    'list_items.group_id:insert', 'list_items.added_by:insert', 'list_items.media_id:insert', 'list_items.status:insert',
    'list_items.status:update', 'list_items.watched_at:update', 'list_items.deleted_at:update',
    'profiles.display_name:update',
    'watches.skipped_at:update']) x),
  'and only these columns where a table is not open to writes');
select test.expect_eq((select array_agg(p.proname::text order by p.proname::text collate "C") from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')),
  (select array_agg(x order by x collate "C") from unnest(array[
    'is_group_member', 'shares_group', 'can_see_item', 'can_see_night',
    'create_group', 'join_group', 'refresh_invite_codes', 'rename_group', 'regenerate_invite_code', 'remove_member',
    'leave_group', 'log_watch', 'watch_again', 'watched_again', 'pending_rating_requests',
    'start_movie_night', 'join_movie_night', 'cast_movie_night_votes', 'finish_movie_night_stack',
    'add_movie_night_stack', 'reveal_movie_night', 'cancel_movie_night', 'movie_night_state', 'active_movie_nights',
    'add_movie_night_top_titles', 'pick_movie_night_card', 'pick_movie_night_title',
    'mark_episodes', 'mark_next_episode', 'rate_episode', 'watch_series_again', 'watch_episode_again', 'my_series_progress',
    'my_series_passes', 'my_episode_counts', 'export_my_data',
    'plan_movie_night', 'rsvp_movie_night_plan', 'cancel_movie_night_plan', 'planned_movie_nights', 'due_movie_night_plans',
    'get_movie_night_guest_link', 'replace_movie_night_guest_link', 'turn_off_movie_night_guest_link',
    'remove_movie_night_guest', 'movie_night_guest_names']) x),
  'signed-in people can run exactly these functions');

-- The server (service-role key): reads and writes every table, and runs the functions it calls (counting rate limits, and
-- speaking for the guests of a movie night).
select test.expect_eq((select array_agg(c.relname || ':' || p order by (c.relname || ':' || p) collate "C")
  from pg_class c, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('service_role', c.oid, p)),
  (select array_agg(c.relname || ':' || p order by (c.relname || ':' || p) collate "C")
    from pg_class c, unnest(array['select', 'insert', 'update', 'delete']) p
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
  'the server has read and write access to every table, and nothing beyond');
select test.expect_eq((select array_agg(p.proname::text order by p.proname::text collate "C") from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('service_role', p.oid, 'execute')),
  (select array_agg(x order by x collate "C") from unnest(array['hit_rate_limit', 'guest_link_info', 'guest_join',
    'guest_movie_night_state', 'guest_cast_votes', 'guest_finish_stack', 'guest_leave']) x),
  'the server can run hit_rate_limit and the guest functions, and nothing else');

:as_service
insert into public.media (tmdb_id, media_type, title) values (9961, 'movie', 'Saved by the server')
  on conflict (tmdb_id, media_type) do update set title = excluded.title;
insert into public.media (tmdb_id, media_type, title) values (9961, 'movie', 'Saved again')
  on conflict (tmdb_id, media_type) do update set title = excluded.title;
select test.expect_eq((select title from public.media where tmdb_id = 9961 and media_type = 'movie'), 'Saved again'::text,
  'the server saves movie info (and updates it)');
select public.hit_rate_limit(null, 'x', 1, 60);
select test.expect_error($$select public.create_group('x')$$, 'permission denied');

reset role;
do $$ begin raise notice 'ALL SECURITY (GRANTS) TESTS PASSED'; end $$;
