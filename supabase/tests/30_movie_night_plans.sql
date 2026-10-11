\set ON_ERROR_STOP 1
-- Planning a movie night: a family plans one for a day and a time, its members answer Going, Maybe or Can't, any member
-- can cancel it or start the night from it, and a plan nobody starts is over a day after its time. Covered here: who may
-- do what (visitors, the server, someone from another family, direct writes), planning (the time, the note, the mood, the
-- limit of 5, the rate limit, the feed), answering and taking an answer back, cancelling, the list a family sees (order,
-- answers, what leaves it), expiry by the clock, the reminders (their window, who gets them), starting a night from a plan
-- (the plan's mood, all or nothing, the old signature gone), what happens when someone leaves a family or deletes their
-- account, and what the download of a person's data has of it.
-- Families are called Plan Fam (Ana owns it; Ben and Dan are in it) and Other Plan Fam (Cara owns it; Dan is in it too).
-- Titles for the stacks are PL<n> (7501 to 7510).
\set as_ana     'reset role; select set_config(''request.jwt.claim.sub'', ''9a9a9a9a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_ben     'reset role; select set_config(''request.jwt.claim.sub'', ''9b9b9b9b-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cara    'reset role; select set_config(''request.jwt.claim.sub'', ''9c9c9c9c-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_dan     'reset role; select set_config(''request.jwt.claim.sub'', ''9d9d9d9d-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_nobody  'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role authenticated;'
\set as_service 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role service_role;'
\set ana  '''9a9a9a9a-0000-0000-0000-000000000001'''
\set ben  '''9b9b9b9b-0000-0000-0000-000000000002'''
\set cara '''9c9c9c9c-0000-0000-0000-000000000003'''
\set dan  '''9d9d9d9d-0000-0000-0000-000000000004'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:ana,  'ana30@x.test',  '{"full_name":"Ana"}'),
  (:ben,  'ben30@x.test',  '{"full_name":"Ben"}'),
  (:cara, 'cara30@x.test', '{"full_name":"Cara"}'),
  (:dan,  'dan30@x.test',  '{"full_name":"Dan"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
-- Keeps an id under a name, for the next statements (what a plan's id is isn't known until it is made).
create function test.pl_keep(p_key text, p_val uuid) returns void language sql security definer as $$
  insert into test.vals values (p_key, p_val::text) on conflict (k) do update set v = excluded.v $$;
-- A family's plans, oldest first, as "note:status, note:status" (a plan without a note is "-").
create function test.pl_plans(p_group uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(coalesce(note, '-') || ':' || status, ', ' order by created_at, id), '')
  from public.movie_night_plans where group_id = p_group $$;
-- The answers to a plan, by name: "Ana:going, Ben:maybe".
create function test.pl_answers(p_plan uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(pr.display_name || ':' || r.answer, ', ' order by pr.display_name), '')
  from public.movie_night_plan_rsvps r join public.profiles pr on pr.id = r.user_id where r.plan_id = p_plan $$;
-- What the list the page gets says about its plans, in its order: "note:status", "-" for no note.
create function test.pl_listed(p_group uuid) returns text language sql stable security definer as $$
  select coalesce(string_agg(coalesce(e.elem ->> 'note', '-') || ':' || (e.elem ->> 'status'), ', ' order by e.pos), '')
  from jsonb_array_elements(public.planned_movie_nights(p_group)) with ordinality as e(elem, pos) $$;
-- The feed's lines of one kind for a family: how many, and the detail of the newest.
create function test.pl_feed(p_group uuid, p_kind text) returns text language sql stable security definer as $$
  select count(*) || ':' || coalesce((select detail from public.activity where group_id = p_group and kind = p_kind
                                      order by created_at desc, id desc limit 1), '-')
  from public.activity where group_id = p_group and kind = p_kind $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into public.media (tmdb_id, media_type, title)
  select 7500 + n, 'movie', 'PL' || n from generate_series(1, 10) n;

-- Ana owns Plan Fam, Ben and Dan are in it; Cara owns Other Plan Fam and Dan is in it too.
:as_ana
select public.create_group('Plan Fam');
:as_cara
select public.create_group('Other Plan Fam');
reset role;
insert into test.vals select 'fam', id::text from public.groups where name = 'Plan Fam';
insert into test.vals select 'code', invite_code from public.groups where name = 'Plan Fam';
insert into test.vals select 'other', id::text from public.groups where name = 'Other Plan Fam';
insert into test.vals select 'other_code', invite_code from public.groups where name = 'Other Plan Fam';
:as_ben
select public.join_group((select v from test.vals where k = 'code'));
:as_dan
select public.join_group((select v from test.vals where k = 'code'));
select public.join_group((select v from test.vals where k = 'other_code'));

-- ---- Who may: not visitors, not the server, not another family, and nobody writes the tables directly ------------------------
:as_anon
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days')$$, 'permission denied');
select test.expect_error($$select public.rsvp_movie_night_plan(gen_random_uuid(), 'going')$$, 'permission denied');
select test.expect_error($$select public.cancel_movie_night_plan(gen_random_uuid())$$, 'permission denied');
select test.expect_error($$select public.planned_movie_nights(test.v('fam'))$$, 'permission denied');
select test.expect_error($$select public.due_movie_night_plans()$$, 'permission denied');
select test.expect_error($$select * from public.movie_night_plans$$, 'permission denied');
select test.expect_error($$select * from public.movie_night_plan_rsvps$$, 'permission denied');
:as_service
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days')$$, 'permission denied');
select test.expect_error($$select public.due_movie_night_plans()$$, 'permission denied');
:as_nobody
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days')$$, 'must be signed in');
select test.expect_error($$select public.rsvp_movie_night_plan(gen_random_uuid(), 'going')$$, 'must be signed in');
select test.expect_error($$select public.cancel_movie_night_plan(gen_random_uuid())$$, 'must be signed in');
select test.expect_error($$select public.planned_movie_nights(test.v('fam'))$$, 'must be signed in');
select test.expect_error($$select public.due_movie_night_plans()$$, 'must be signed in');
-- The helpers are for the database itself.
:as_ana
select test.expect_error($$select public.settle_movie_night_plans(test.v('fam'))$$, 'permission denied');
select test.expect_error($$select public.movie_night_mood(null, null)$$, 'permission denied');
select test.expect_error($$select public.movie_night_plan_require_planned(null::public.movie_night_plans)$$, 'permission denied');
:as_cara
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days')$$, 'not in this family');
select test.expect_error($$select public.planned_movie_nights(test.v('fam'))$$, 'not in this family');

-- ---- Planning ---------------------------------------------------------------------------------------------------------------------
:as_ana
select test.pl_keep('pizza', public.plan_movie_night(test.v('fam'), now() + interval '2 days', '  ANA-PLAN-NOTE  ', array['comedy', 'family'], '{"count": 12, "max": 120}'));
select test.expect_eq(test.pl_plans(test.v('fam')), 'ANA-PLAN-NOTE:planned', 'a plan is made, with its note trimmed');
select test.expect_eq((select genres from public.movie_night_plans where id = test.v('pizza')), array['comedy', 'family'], 'and its mood');
select test.expect_eq((select options from public.movie_night_plans where id = test.v('pizza')), '{"max": 120, "count": 12, "series": false}'::jsonb, 'with the options as a night keeps them');
select test.expect_eq((select created_by from public.movie_night_plans where id = test.v('pizza')), '9a9a9a9a-0000-0000-0000-000000000001'::uuid, 'it is hers');
select test.expect_eq(test.pl_answers(test.v('pizza')), 'Ana:going', 'and she is Going');
select test.expect_eq((select ended_at is null and night_id is null and ended_by is null from public.movie_night_plans where id = test.v('pizza')), true, 'it is not over');
reset role;
select test.expect_eq(test.pl_feed(test.v('fam'), 'movie_night_planned'),
  '1:' || to_char((select starts_at from public.movie_night_plans where id = test.v('pizza')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'the family''s feed has a line with the time');
select test.expect_eq((select actor_name from public.activity where group_id = test.v('fam') and kind = 'movie_night_planned'), 'Ana'::text, 'in her name');
:as_ana
-- With no note and no mood: the defaults of a night.
select test.pl_keep('plain', public.plan_movie_night(test.v('fam'), now() + interval '3 days'));
select test.expect_eq((select note is null and genres = '{}' and options = '{"max": null, "count": 25, "series": false}'::jsonb
  from public.movie_night_plans where id = test.v('plain')), true, 'a plan can be just a time');
select test.pl_keep('blank', public.plan_movie_night(test.v('fam'), now() + interval '4 days', E'  \n ', '{}', '{}'));
select test.expect_eq((select note is null from public.movie_night_plans where id = test.v('blank')), true, 'a note of spaces is no note');
select test.expect_eq(test.pl_plans(test.v('fam')), 'ANA-PLAN-NOTE:planned, -:planned, -:planned', 'three plans');
-- A hundred characters is fine.
select test.pl_keep('hundred', public.plan_movie_night(test.v('fam'), now() + interval '5 days', repeat('x', 100)));
select test.expect_eq((select char_length(note) from public.movie_night_plans where id = test.v('hundred')), 100, 'a note of 100 characters');
select test.expect_eq((select count(*) from public.movie_night_plans where group_id = test.v('fam')), 4::bigint, 'four plans');

-- The refusals: each says what is wrong and leaves no plan behind, nor a line in the feed.
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() - interval '1 hour')$$, 'time in the future');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now())$$, 'time in the future');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), null)$$, 'time in the future');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '366 days')$$, 'within the next year');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', repeat('x', 101))$$, '100 characters');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', null, array['a', 'b', 'c', 'd', 'e', 'f'])$$, 'up to 5 genres');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', null, array['a', ''])$$, 'up to 5 genres');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', null, array[repeat('g', 41)])$$, 'up to 5 genres');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', null, null, '[1]'::jsonb)$$, 'options are not valid');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', null, null, '{"series": true}'::jsonb)$$, 'for movies');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', null, null, '{"count": 7}'::jsonb)$$, '8 to 40');
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days', null, null, '{"count": 41}'::jsonb)$$, '8 to 40');
select test.expect_eq((select count(*) from public.movie_night_plans where group_id = test.v('fam')), 4::bigint, 'none of them left a plan');
reset role;
select test.expect_eq(test.pl_feed(test.v('fam'), 'movie_night_planned') like '4:%', true, 'or a line in the feed');
:as_ana

-- ---- A family has at most 5 planned ------------------------------------------------------------------------------------------------
select test.pl_keep('fifth', public.plan_movie_night(test.v('fam'), now() + interval '6 days', 'fifth'));
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '7 days', 'sixth')$$, 'already has 5');
-- Another family has its own five.
:as_cara
select test.pl_keep('cara1', public.plan_movie_night(test.v('other'), now() + interval '2 days', 'cara-1'));
:as_ben
-- A plan that is cancelled, or has passed, is not one of the five.
select public.cancel_movie_night_plan(test.v('hundred'));
:as_ana
select test.pl_keep('sixth', public.plan_movie_night(test.v('fam'), now() + interval '7 days', 'sixth'));
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '8 days', 'seventh')$$, 'already has 5');
reset role;
update public.movie_night_plans set starts_at = now() - interval '25 hours' where id = test.v('sixth');
:as_ana
select test.pl_keep('seventh', public.plan_movie_night(test.v('fam'), now() + interval '8 days', 'seventh'));
select test.expect_eq(test.pl_plans(test.v('fam')),
  'ANA-PLAN-NOTE:planned, -:planned, -:planned, ' || repeat('x', 100) || ':cancelled, fifth:planned, sixth:expired, seventh:planned',
  'the one that passed stopped counting');
-- Make room again for what follows.
reset role;
delete from public.movie_night_plans where id in (test.v('fifth'), test.v('sixth'), test.v('seventh'), test.v('hundred'));
select test.expect_eq(test.pl_plans(test.v('fam')), 'ANA-PLAN-NOTE:planned, -:planned, -:planned', 'back to three');
delete from public.activity where kind in ('movie_night_planned', 'movie_night_plan_cancelled') and group_id = test.v('fam');

-- ---- The limit on planning, and on answering -----------------------------------------------------------------------------------------
insert into public.rate_limits (user_id, action, window_start, hits)
  values (:dan, 'plan_night', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 10)
  on conflict (user_id, action, window_start) do update set hits = 10;
:as_dan
select test.expect_error($$select public.plan_movie_night(test.v('fam'), now() + interval '2 days')$$, 'too often');
reset role;
delete from public.rate_limits where user_id = :dan and action = 'plan_night';
insert into public.rate_limits (user_id, action, window_start, hits)
  values (:dan, 'plan_rsvp', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 60)
  on conflict (user_id, action, window_start) do update set hits = 60;
:as_dan
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('pizza'), 'going')$$, 'too often');
reset role;
delete from public.rate_limits where user_id = :dan and action = 'plan_rsvp';

-- ---- Answering -------------------------------------------------------------------------------------------------------------------------
:as_ben
select public.rsvp_movie_night_plan(test.v('pizza'), 'going');
select test.expect_eq(test.pl_answers(test.v('pizza')), 'Ana:going, Ben:going', 'Ben is Going');
select public.rsvp_movie_night_plan(test.v('pizza'), 'maybe');
select test.expect_eq(test.pl_answers(test.v('pizza')), 'Ana:going, Ben:maybe', 'and changes it to Maybe, still one answer');
:as_dan
select public.rsvp_movie_night_plan(test.v('pizza'), 'no');
select test.expect_eq(test.pl_answers(test.v('pizza')), 'Ana:going, Ben:maybe, Dan:no', 'Dan can''t');
select public.rsvp_movie_night_plan(test.v('pizza'), null);
select test.expect_eq(test.pl_answers(test.v('pizza')), 'Ana:going, Ben:maybe', 'taking an answer back leaves none');
select public.rsvp_movie_night_plan(test.v('pizza'), null);
select test.expect_eq(test.pl_answers(test.v('pizza')), 'Ana:going, Ben:maybe', 'taking back what isn''t there is fine');
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('pizza'), 'yes')$$, 'Going, Maybe or');
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('pizza'), '')$$, 'Going, Maybe or');
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('pizza'), 'GOING')$$, 'Going, Maybe or');
select test.expect_error($$select public.rsvp_movie_night_plan(gen_random_uuid(), 'going')$$, 'not available');
-- Somebody from another family can't answer, and can't see the answers.
:as_cara
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('pizza'), 'going')$$, 'not available');
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('pizza'), null)$$, 'not available');
select test.expect_eq((select count(*) from public.movie_night_plans where group_id = test.v('fam')), 0::bigint, 'Cara reads none of Plan Fam''s plans');
select test.expect_eq((select count(*) from public.movie_night_plan_rsvps where plan_id = test.v('pizza')), 0::bigint, 'nor their answers');
select test.expect_eq((select count(*) from public.movie_night_plans), 1::bigint, 'only her own family''s');
:as_ben
select test.expect_eq((select count(*) from public.movie_night_plan_rsvps where plan_id = test.v('pizza')), 2::bigint, 'Ben reads everybody''s answers in his family');
-- Nothing is written through the tables.
select test.expect_error($$insert into public.movie_night_plan_rsvps (plan_id, user_id, answer) values (test.v('pizza'), '9b9b9b9b-0000-0000-0000-000000000002', 'going')$$, 'permission denied');
select test.expect_error($$update public.movie_night_plan_rsvps set answer = 'going'$$, 'permission denied');
select test.expect_error($$delete from public.movie_night_plan_rsvps$$, 'permission denied');
select test.expect_error($$insert into public.movie_night_plans (group_id, starts_at) values (test.v('fam'), now() + interval '1 day')$$, 'permission denied');
select test.expect_error($$update public.movie_night_plans set status = 'started'$$, 'permission denied');
select test.expect_error($$delete from public.movie_night_plans$$, 'permission denied');

-- ---- The list a family gets ---------------------------------------------------------------------------------------------------------------
:as_ana
select test.expect_eq(test.pl_listed(test.v('fam')), 'ANA-PLAN-NOTE:planned, -:planned, -:planned', 'the plans, soonest first');
select test.expect_eq((public.planned_movie_nights(test.v('fam')) -> 0 ->> 'id')::uuid, test.v('pizza'), 'starting with the one in two days');
select test.expect_eq((select array_agg(k order by k collate "C") from jsonb_object_keys(public.planned_movie_nights(test.v('fam')) -> 0) k),
  array['answers', 'created_by', 'created_by_name', 'ended_at', 'genres', 'id', 'my_answer', 'note', 'options', 'starts_at', 'status'],
  'each has what the page shows, and nothing else');
select test.expect_eq(public.planned_movie_nights(test.v('fam')) -> 0 ->> 'created_by_name', 'Ana'::text, 'who planned it');
select test.expect_eq(public.planned_movie_nights(test.v('fam')) -> 0 ->> 'my_answer', 'going'::text, 'and what Ana answered');
select test.expect_eq(public.planned_movie_nights(test.v('fam')) -> 0 -> 'genres', '["comedy", "family"]'::jsonb, 'its mood');
select test.expect_eq((select string_agg(a ->> 'name' || ':' || (a ->> 'answer'), ', ' order by a ->> 'name')
  from jsonb_array_elements(public.planned_movie_nights(test.v('fam')) -> 0 -> 'answers') a), 'Ana:going, Ben:maybe', 'everybody''s answers, with names');
select test.expect_eq(public.planned_movie_nights(test.v('fam')) -> 1 ->> 'my_answer', 'going'::text, 'she is Going on every plan she makes');
:as_ben
select test.expect_eq(public.planned_movie_nights(test.v('fam')) -> 0 ->> 'my_answer', 'maybe'::text, 'Ben is told his own answer');
select test.expect_eq(public.planned_movie_nights(test.v('fam')) -> 1 ->> 'my_answer', null::text, 'and that he has none on the others');
select test.expect_error($$select public.planned_movie_nights(test.v('other'))$$, 'not in this family');

-- ---- Cancelling --------------------------------------------------------------------------------------------------------------------------
:as_cara
select test.expect_error($$select public.cancel_movie_night_plan(test.v('pizza'))$$, 'not available');
select test.expect_error($$select public.cancel_movie_night_plan(gen_random_uuid())$$, 'not available');
:as_ben
-- Any member can cancel, not only the one who planned it.
select public.cancel_movie_night_plan(test.v('plain'));
select test.expect_eq(test.pl_plans(test.v('fam')), 'ANA-PLAN-NOTE:planned, -:cancelled, -:planned', 'Ben cancels a plan of Ana''s');
select test.expect_eq((select ended_by from public.movie_night_plans where id = test.v('plain')), '9b9b9b9b-0000-0000-0000-000000000002'::uuid, 'and it says who');
select test.expect_eq((select ended_at is not null and night_id is null from public.movie_night_plans where id = test.v('plain')), true, 'and when');
select test.expect_error($$select public.cancel_movie_night_plan(test.v('plain'))$$, 'was cancelled');
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('plain'), 'going')$$, 'was cancelled');
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('plain'), null)$$, 'was cancelled');
reset role;
select test.expect_eq(test.pl_feed(test.v('fam'), 'movie_night_plan_cancelled'),
  '1:' || to_char((select starts_at from public.movie_night_plans where id = test.v('plain')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'the feed has a line for it, with the time it was for');
select test.expect_eq((select actor_name from public.activity where group_id = test.v('fam') and kind = 'movie_night_plan_cancelled'), 'Ben'::text, 'in Ben''s name');
:as_ana
-- It stays in the list for a day, after the ones still planned, and then leaves it.
select test.expect_eq(test.pl_listed(test.v('fam')), 'ANA-PLAN-NOTE:planned, -:planned, -:cancelled', 'a cancelled plan is still shown, last');
reset role;
update public.movie_night_plans set ended_at = now() - interval '25 hours' where id = test.v('plain');
:as_ana
select test.expect_eq(test.pl_listed(test.v('fam')), 'ANA-PLAN-NOTE:planned, -:planned', 'and leaves the list a day later');

-- ---- A plan nobody starts is over a day after its time ---------------------------------------------------------------------------------------
reset role;
insert into public.movie_night_plans (group_id, created_by, starts_at, note)
  values (test.v('fam'), :ana, now() - interval '23 hours', 'late-23'), (test.v('fam'), :ana, now() - interval '25 hours', 'late-25');
:as_ana
select test.expect_eq(test.pl_listed(test.v('fam')), 'late-23:planned, ANA-PLAN-NOTE:planned, -:planned, late-25:expired',
  'at 23 hours it is still planned (and first, being the soonest), at 25 it has passed (and is last)');
select test.expect_eq((select status || ':' || (ended_at is not null)::text from public.movie_night_plans where note = 'late-25'), 'expired:true'::text, 'with the time it ended');
select test.expect_eq((select status from public.movie_night_plans where note = 'late-23'), 'planned'::text, 'the other is not touched');
select test.pl_keep('late25', (select id from public.movie_night_plans where note = 'late-25'));
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('late25'), 'going')$$, 'has passed');
select test.expect_error($$select public.cancel_movie_night_plan(test.v('late25'))$$, 'has passed');
reset role;
update public.movie_night_plans set ended_at = now() - interval '25 hours' where note = 'late-25';
:as_ana
select test.expect_eq(test.pl_listed(test.v('fam')), 'late-23:planned, ANA-PLAN-NOTE:planned, -:planned', 'an expired plan leaves the list a day after it ended too');
-- Nothing has looked at these two yet (they are in two families, as looking at one family settles all of its plans), so
-- answering and cancelling have to notice by themselves that they have passed.
reset role;
insert into public.movie_night_plans (group_id, created_by, starts_at, note) values
  (test.v('fam'), :ana, now() - interval '26 hours', 'late-26a'),
  (test.v('other'), :cara, now() - interval '26 hours', 'late-26b');
insert into test.vals select 'p_' || note, id::text from public.movie_night_plans where note in ('late-26a', 'late-26b');
:as_ana
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('p_late-26a'), 'going')$$, 'has passed');
:as_cara
select test.expect_error($$select public.cancel_movie_night_plan(test.v('p_late-26b'))$$, 'has passed');
reset role;
delete from public.movie_night_plans where note in ('late-23', 'late-25', 'late-26a', 'late-26b');
delete from test.vals where k in ('p_late-26a', 'p_late-26b');

-- ---- What the download of a person's data has of it ---------------------------------------------------------------------------------------------
-- Ben has a plan of his own (and answered Ana's); Ana has not answered his.
insert into public.movie_night_plans (group_id, created_by, starts_at, note, genres)
  values (test.v('fam'), :ben, now() + interval '9 days', 'BEN-PLAN-NOTE', array['drama']);
:as_ben
select public.export_my_data()::text as ben_text \gset
:as_ana
select public.export_my_data()::text as ana_text \gset
:as_cara
select public.export_my_data()::text as cara_text \gset
reset role;
insert into test.vals values ('ben_export', :'ben_text'), ('ana_export', :'ana_text'), ('cara_export', :'cara_text');
select test.expect_eq((select jsonb_array_length(v::jsonb -> 'movie_night_plans') from test.vals where k = 'ben_export'), 2, 'Ben has the plan he made and the one he answered');
select test.expect_eq((select count(*) from test.vals, jsonb_array_elements(v::jsonb -> 'movie_night_plans') e
  where k = 'ben_export' and (e ->> 'planned_by_me')::boolean and e ->> 'note' = 'BEN-PLAN-NOTE' and e ->> 'family' = 'Plan Fam'
    and e -> 'mood' = '["drama"]'::jsonb and e ->> 'status' = 'planned' and e ->> 'my_answer' is null), 1::bigint, 'his own, with his note');
select test.expect_eq((select count(*) from test.vals, jsonb_array_elements(v::jsonb -> 'movie_night_plans') e
  where k = 'ben_export' and not (e ->> 'planned_by_me')::boolean and e -> 'note' = 'null'::jsonb and e ->> 'my_answer' = 'maybe'
    and e ->> 'family' = 'Plan Fam' and e -> 'mood' = '["comedy", "family"]'::jsonb and e ->> 'answered_at' is not null), 1::bigint,
  'Ana''s, with his answer and not her note');
select test.expect_eq(position('ANA-PLAN-NOTE' in v) > 0, false, 'her note is nowhere in his download') from test.vals where k = 'ben_export';
select test.expect_eq((select jsonb_array_length(v::jsonb -> 'movie_night_plans') from test.vals where k = 'ana_export'), 3, 'Ana has the three she made: Ben''s plan is none of hers');
select test.expect_eq(position('ANA-PLAN-NOTE' in v) > 0 and position('BEN-PLAN-NOTE' in v) = 0, true, 'with her note and not his') from test.vals where k = 'ana_export';
select test.expect_eq((select jsonb_array_length(v::jsonb -> 'movie_night_plans') from test.vals where k = 'cara_export'), 1, 'Cara has her family''s plan');
select test.expect_eq(position('ANA-PLAN-NOTE' in v) = 0 and position('BEN-PLAN-NOTE' in v) = 0 and position('cara-1' in v) > 0, true, 'and nothing of the other family''s') from test.vals where k = 'cara_export';
delete from public.rate_limits where action = 'export';
delete from public.movie_night_plans where note = 'BEN-PLAN-NOTE';

-- ---- The reminders: from 60 minutes before to 3 hours after, still planned, not for someone who can't come ------------------------------------
delete from public.movie_night_plans where group_id in (test.v('fam'), test.v('other'));
insert into public.movie_night_plans (group_id, created_by, starts_at, note, genres, options, status) values
  (test.v('fam'),   :ana,  now() + interval '59 minutes',  'due-59m',          array['horror'], '{"max": 100, "count": 10, "series": false}', 'planned'),
  (test.v('fam'),   :ana,  now() + interval '61 minutes',  'due-61m',          array['crime'],  '{"max": null, "count": 9, "series": false}', 'planned'),
  (test.v('fam'),   :ana,  now() - interval '179 minutes', 'due-179m-ago',     '{}', '{}', 'planned'),
  (test.v('fam'),   :ana,  now() - interval '181 minutes', 'due-181m-ago',     '{}', '{}', 'planned'),
  (test.v('fam'),   :ana,  now() + interval '30 minutes',  'cancelled-in-window', '{}', '{}', 'cancelled'),
  (test.v('fam'),   :ana,  now() + interval '30 minutes',  'started-in-window',   '{}', '{}', 'started'),
  (test.v('fam'),   :ana,  now() + interval '10 minutes',  'ana-cant',         '{}', '{}', 'planned'),
  (test.v('other'), :cara, now() + interval '20 minutes',  'other-in-window',  '{}', '{}', 'planned');
insert into public.movie_night_plan_rsvps (plan_id, user_id, answer)
  select id, :ana::uuid, 'no' from public.movie_night_plans where note = 'ana-cant'
  union all select id, :ben::uuid, 'going' from public.movie_night_plans where note = 'due-59m'
  union all select id, :dan::uuid, 'maybe' from public.movie_night_plans where note = 'due-59m'
  union all select id, :ana::uuid, 'going' from public.movie_night_plans where note = 'due-179m-ago';
insert into test.vals select 'p_' || note, id::text from public.movie_night_plans;
-- The words of the list: "note(answer, going)".
create function test.pl_due() returns text language sql stable security definer as $$
  select coalesce(string_agg((e ->> 'note') || '(' || coalesce(e ->> 'my_answer', '-') || ',' || (e ->> 'going') || ',' || (e ->> 'group_name') || ')', ', ' order by pos), '')
  from jsonb_array_elements(public.due_movie_night_plans()) with ordinality as x(e, pos) $$;
grant execute on function test.pl_due() to anon, authenticated, service_role;
:as_ana
select test.expect_eq(test.pl_due(), 'due-179m-ago(going,1,Plan Fam), due-59m(-,1,Plan Fam)',
  'Ana is reminded of what is within the window, oldest first, with her answer and how many are going; not of the one she can''t come to');
select test.expect_eq((select array_agg(k order by k collate "C") from jsonb_object_keys(public.due_movie_night_plans() -> 0) k),
  array['going', 'group_id', 'group_name', 'id', 'my_answer', 'note', 'starts_at'], 'each has what the reminder needs');
:as_ben
select test.expect_eq(test.pl_due(), 'due-179m-ago(-,1,Plan Fam), ana-cant(-,0,Plan Fam), due-59m(going,1,Plan Fam)',
  'Ben has the one Ana can''t come to too, and his own answer on the others');
:as_cara
select test.expect_eq(test.pl_due(), 'other-in-window(-,0,Other Plan Fam)', 'Cara is told of her own family''s and no other');
:as_dan
select test.expect_eq(test.pl_due(), 'due-179m-ago(-,1,Plan Fam), ana-cant(-,0,Plan Fam), other-in-window(-,0,Other Plan Fam), due-59m(maybe,1,Plan Fam)',
  'Dan is in both families and is told of both');
select public.rsvp_movie_night_plan(test.v('p_ana-cant'), 'no');
select test.expect_eq(test.pl_due(), 'due-179m-ago(-,1,Plan Fam), other-in-window(-,0,Other Plan Fam), due-59m(maybe,1,Plan Fam)',
  'and once he can''t come to one, he is not reminded of it');
select public.rsvp_movie_night_plan(test.v('p_ana-cant'), null);
select test.expect_eq(test.pl_due() like '%ana-cant%', true, 'until he takes that back');
-- The window is the clock's: a plan moves in and out of it.
reset role;
update public.movie_night_plans set starts_at = now() + interval '61 minutes' where note = 'due-59m';
update public.movie_night_plans set starts_at = now() + interval '59 minutes' where note = 'due-61m';
:as_ana
select test.expect_eq(test.pl_due(), 'due-179m-ago(going,1,Plan Fam), due-61m(-,0,Plan Fam)', 'one leaves it as the other comes in');
reset role;
update public.movie_night_plans set starts_at = now() + interval '59 minutes' where note = 'due-59m';
update public.movie_night_plans set starts_at = now() + interval '61 minutes' where note = 'due-61m';

-- ---- Starting a night from a plan ---------------------------------------------------------------------------------------------------------------
select (select jsonb_agg(jsonb_build_object('media_id', m.id, 'list_item_id', null, 'origin', 'suggested') order by m.tmdb_id)
        from public.media m where m.tmdb_id between 7501 and 7510)::text as cands \gset
insert into test.vals values ('cands', :'cands');
create function test.pl_cands() returns jsonb language sql stable security definer as $$
  select v::jsonb from test.vals where k = 'cands' $$;
grant execute on function test.pl_cands() to anon, authenticated, service_role;
select test.expect_eq(to_regprocedure('public.start_movie_night(uuid, text[], jsonb, jsonb)') is null, true, 'the old signature is gone, so a call can''t be ambiguous');
select test.expect_eq(to_regprocedure('public.start_movie_night(uuid, text[], jsonb, jsonb, uuid)') is not null, true, 'the new one is there');
:as_cara
-- Not another family's plan, and not on another family's page.
select test.expect_error($$select public.start_movie_night(test.v('other'), '{}', '{}', test.pl_cands(), test.v('p_due-59m'))$$, 'not available');
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', test.pl_cands(), test.v('p_due-59m'))$$, 'not in this family');
:as_ana
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', test.pl_cands(), test.v('p_other-in-window'))$$, 'not available');
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', test.pl_cands(), gen_random_uuid())$$, 'not available');
select test.expect_eq(test.pl_plans(test.v('fam')) like '%due-59m:planned%', true, 'none of that touched the plan');
-- The night has the plan's mood, whatever else was asked for, and the plan is started and linked.
select test.pl_keep('night1', public.start_movie_night(test.v('fam'), array['comedy'], '{"count": 20}', test.pl_cands(), test.v('p_due-59m')));
select test.expect_eq((select genres from public.movie_nights where id = test.v('night1')), array['horror'], 'the night has the plan''s genres, not the ones that came with the call');
select test.expect_eq((select options from public.movie_nights where id = test.v('night1')), '{"max": 100, "count": 10, "series": false}'::jsonb, 'and its options');
select test.expect_eq((select status || ':' || (night_id = test.v('night1'))::text || ':' || (ended_at is not null)::text || ':' || (ended_by = '9a9a9a9a-0000-0000-0000-000000000001')::text
  from public.movie_night_plans where note = 'due-59m'), 'started:true:true:true'::text, 'the plan is started, linked to the night, and says who started it');
select test.expect_eq((select count(*) from public.activity where group_id = test.v('fam') and kind = 'movie_night_started' and detail = 'horror'), 1::bigint, 'the feed says the night started, with the mood');
select test.expect_eq((select count(*) from public.movie_night_candidates where night_id = test.v('night1')), 10::bigint, 'with its stack');
select test.expect_eq(test.pl_due() like '%due-59m%', false, 'a started plan is no longer a reminder');
select test.expect_eq(test.pl_listed(test.v('fam')) like '%due-59m%', false, 'nor in the list: the night is');
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('p_due-59m'), 'going')$$, 'already started');
select test.expect_error($$select public.cancel_movie_night_plan(test.v('p_due-59m'))$$, 'already started');
-- All or nothing: with that night still going, another start fails and the plan is as it was.
:as_ben
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', test.pl_cands(), test.v('p_due-61m'))$$, 'already has a movie night open');
select test.expect_eq((select status || ':' || (night_id is null)::text || ':' || (ended_at is null)::text || ':' || (ended_by is null)::text from public.movie_night_plans where note = 'due-61m'),
  'planned:true:true:true'::text, 'the plan is still planned, with no night');
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('fam')), 1::bigint, 'and there is still one night');
select public.cancel_movie_night(test.v('night1'));
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', null, test.v('p_due-61m'))$$, 'Pick the titles');
select test.expect_eq((select status from public.movie_night_plans where note = 'due-61m'), 'planned'::text, 'a stack that is not valid leaves it planned too');
-- Cancelled, passed, started: none can start a night.
reset role;
update public.movie_night_plans set status = 'cancelled', ended_at = now() where note = 'cancelled-in-window';
update public.movie_night_plans set starts_at = now() - interval '30 hours' where note = 'due-181m-ago';
:as_ana
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', test.pl_cands(), test.v('p_cancelled-in-window'))$$, 'was cancelled');
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', test.pl_cands(), test.v('p_due-181m-ago'))$$, 'has passed');
select test.expect_error($$select public.start_movie_night(test.v('fam'), '{}', '{}', test.pl_cands(), test.v('p_due-59m'))$$, 'already started');
select test.expect_eq((select count(*) from public.movie_nights where group_id = test.v('fam')), 1::bigint, 'no night came of any of them');
-- A plan with no mood starts a night with the defaults, and the plan can be started before its time ("Start now").
select test.pl_keep('night2', public.start_movie_night(test.v('fam'), array['comedy'], '{"count": 20}', test.pl_cands(), test.v('p_due-61m')));
select test.expect_eq((select genres from public.movie_nights where id = test.v('night2')), array['crime'], 'before its time, with its mood');
select test.expect_eq((select options ->> 'count' from public.movie_nights where id = test.v('night2')), '9'::text, 'and its options');
select public.cancel_movie_night(test.v('night2'));
-- Without a plan, a night starts as it always did (four arguments, by position and by name).
select test.pl_keep('night3', public.start_movie_night(test.v('fam'), array['comedy'], '{"count": 8}', test.pl_cands()));
select test.expect_eq((select genres::text || ':' || (options ->> 'count') from public.movie_nights where id = test.v('night3')), '{comedy}:8'::text, 'a night with no plan has the mood it was given');
select public.cancel_movie_night(test.v('night3'));
select test.pl_keep('night4', public.start_movie_night(p_group := test.v('fam'), p_genres := '{}', p_options := '{}', p_candidates := test.pl_cands()));
select test.expect_eq((select options ->> 'count' from public.movie_nights where id = test.v('night4')), '25'::text, 'and by name');
select test.expect_eq((select count(*) from public.movie_night_plans where group_id = test.v('fam') and status = 'started'), 3::bigint,
  'the plans that are started are the two that were used and the one that was made so; the nights with no plan started none');
select public.cancel_movie_night(test.v('night4'));

-- ---- Someone leaves a family, someone deletes their account --------------------------------------------------------------------------------------
reset role;
insert into public.movie_night_plan_rsvps (plan_id, user_id, answer)
  select id, :dan::uuid, 'going' from public.movie_night_plans where note in ('ana-cant', 'due-179m-ago')
  union all select id, :dan::uuid, 'maybe' from public.movie_night_plans where note = 'other-in-window';
select test.expect_eq(test.pl_answers(test.v('p_ana-cant')), 'Ana:no, Dan:going', 'Dan has answered a plan of Plan Fam''s');
:as_dan
select public.leave_group(test.v('fam'));
reset role;
select test.expect_eq(test.pl_answers(test.v('p_ana-cant')), 'Ana:no', 'when he leaves, his answers leave the family''s plans');
select test.expect_eq(test.pl_answers(test.v('p_due-179m-ago')), 'Ana:going', 'all of them');
select test.expect_eq(test.pl_answers(test.v('p_other-in-window')), 'Dan:maybe', 'but not his answers in the family he is still in');
select test.expect_eq((select count(*) from public.movie_night_plans where group_id = test.v('fam')), 7::bigint, 'and the plans stay');
select test.expect_eq((select count(*) from public.movie_night_plan_rsvps r join public.movie_night_plans p on p.id = r.plan_id
  where p.group_id = test.v('fam') and r.user_id = :dan), 0::bigint, 'none of his is left');
:as_dan
select test.expect_error($$select public.rsvp_movie_night_plan(test.v('p_ana-cant'), 'going')$$, 'not available');
select test.expect_error($$select public.planned_movie_nights(test.v('fam'))$$, 'not in this family');
select test.expect_eq(test.pl_due(), 'other-in-window(maybe,0,Other Plan Fam)', 'and he is not reminded of that family''s plans any more, only of the other family''s');
-- Ana made seven of the plans (all but Cara's); she goes, and her notes go with her, not the plans.
reset role;
select test.expect_eq((select count(*) from public.movie_night_plans where created_by = :ana), 7::bigint, 'Ana made seven of the plans');
delete from auth.users where id = :ana;
select test.expect_eq((select count(*) from public.movie_night_plans where created_by is null), 7::bigint, 'when she deletes her account the plans are still there, with no creator');
select test.expect_eq((select count(*) from public.movie_night_plans where group_id = test.v('fam') and note is not null), 0::bigint, 'but her notes are gone');
select test.expect_eq(test.pl_answers(test.v('p_due-179m-ago')), ''::text, 'with her answers');
select test.expect_eq((select count(*) from public.movie_night_plans where group_id = test.v('other') and note = 'other-in-window'), 1::bigint, 'and Cara''s plan keeps its note');
select test.expect_eq((select count(*) from public.movie_night_plans where status = 'started' and ended_by is not null), 0::bigint, 'and it is not said that she started a night');
:as_ben
select test.expect_eq(test.pl_listed(test.v('fam')) like '-:planned, -:planned%', true, 'Ben still sees the family''s plans, the ones still planned first');
select test.expect_eq(public.planned_movie_nights(test.v('fam')) -> 0 ->> 'created_by_name', null::text, 'with nobody''s name on them');

do $$ begin raise notice 'ALL MOVIE NIGHT PLAN TESTS PASSED'; end $$;
