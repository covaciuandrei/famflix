\set ON_ERROR_STOP 1
-- Editing and deleting a movie night: who watched and the day (update_movie_night), deleting a night that is over, with or
-- without taking the title off Watched together (delete_movie_night), who may do what, the nights that can't be edited,
-- and that nothing of anyone else's private state is destroyed. Titles are called E<tmdb id>.
\set as_ana  'reset role; select set_config(''request.jwt.claim.sub'', ''b5b5b5b5-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_ben  'reset role; select set_config(''request.jwt.claim.sub'', ''b6b6b6b6-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cara 'reset role; select set_config(''request.jwt.claim.sub'', ''b7b7b7b7-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_dan  'reset role; select set_config(''request.jwt.claim.sub'', ''b8b8b8b8-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_eve  'reset role; select set_config(''request.jwt.claim.sub'', ''b9b9b9b9-0000-0000-0000-000000000005'', false); set role authenticated;'
\set as_fay  'reset role; select set_config(''request.jwt.claim.sub'', ''babababa-0000-0000-0000-000000000006'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

insert into auth.users (id, email, raw_user_meta_data) values
  ('b5b5b5b5-0000-0000-0000-000000000001', 'ana-ed@x.test', '{"full_name":"Ana"}'),
  ('b6b6b6b6-0000-0000-0000-000000000002', 'ben-ed@x.test', '{"full_name":"Ben"}'),
  ('b7b7b7b7-0000-0000-0000-000000000003', 'cara-ed@x.test', '{"full_name":"Cara"}'),
  ('b8b8b8b8-0000-0000-0000-000000000004', 'dan-ed@x.test', '{"full_name":"Dan"}'),
  ('b9b9b9b9-0000-0000-0000-000000000005', 'eve-ed@x.test', '{"full_name":"Eve"}'),
  ('babababa-0000-0000-0000-000000000006', 'fay-ed@x.test', '{"full_name":"Fay"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

create or replace function test.v(p_key text) returns uuid language sql stable security definer as $$
  select v::uuid from test.vals where k = p_key $$;
create function test.u(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'ana' then 'b5b5b5b5-0000-0000-0000-000000000001' when 'ben' then 'b6b6b6b6-0000-0000-0000-000000000002'
    when 'cara' then 'b7b7b7b7-0000-0000-0000-000000000003' when 'dan' then 'b8b8b8b8-0000-0000-0000-000000000004'
    when 'eve' then 'b9b9b9b9-0000-0000-0000-000000000005' when 'fay' then 'babababa-0000-0000-0000-000000000006' end::uuid $$;
-- Viewers as update_movie_night() takes them, by first name; one of them can have a score filled in.
create function test.vw(p_names text[], p_score_for text default null, p_score numeric default null) returns jsonb
language sql stable as $$
  select jsonb_agg(jsonb_build_object('user_id', test.u(n), 'score', case when n = p_score_for then p_score end) order by n)
  from unnest(p_names) n $$;
create function test.ua(p_names text[]) returns uuid[] language sql immutable as $$
  select array_agg(test.u(n)) from unnest(p_names) n $$;
-- The family's list entry for a title, a person's My list entry for it, and the newest night that picked it.
create function test.eitem(p_tmdb integer) returns uuid language sql stable security definer as $$
  select li.id from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id = test.v('ed_fam') and m.tmdb_id = p_tmdb $$;
create function test.emine(p_name text, p_tmdb integer) returns uuid language sql stable security definer as $$
  select li.id from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id is null and li.added_by = test.u(p_name) and m.tmdb_id = p_tmdb $$;
create function test.enight(p_tmdb integer) returns uuid language sql stable security definer as $$
  select id from public.movie_nights where picked_list_item_id = test.eitem(p_tmdb) order by created_at desc, id desc limit 1 $$;
-- Who is on a title's watch record, and who a night says watched it (first names, in order).
create function test.watchers(p_tmdb integer) returns text[] language sql stable security definer as $$
  select coalesce(array_agg(p.display_name order by p.display_name), '{}')
  from public.watches w join public.profiles p on p.id = w.user_id where w.list_item_id = test.eitem(p_tmdb) $$;
create function test.nightwatchers(p_night uuid) returns text[] language sql stable security definer as $$
  select coalesce(array_agg(p.display_name order by p.display_name), '{}')
  from public.movie_night_members m join public.profiles p on p.id = m.user_id where m.night_id = p_night and m.watched $$;
create or replace function test.cands(p_from integer, p_to integer) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id)
  from public.media where tmdb_id between p_from and p_to $$;
create function test.flag(p_night uuid, p_who text, p_flag text) returns boolean language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', test.u(p_who)::text, true);
  return (public.movie_night_state(p_night) -> 'night' ->> p_flag)::boolean;
end $$;
create function test.ed_events(p_kind text) returns bigint language sql stable security definer as $$
  select count(*) from public.activity where group_id = test.v('ed_fam') and kind = p_kind $$;
grant execute on all functions in schema test to anon, authenticated;

insert into public.media (tmdb_id, media_type, title) select g, 'movie', 'E' || g from generate_series(7701, 7740) g;

-- Ana is the owner of a family with Ben, Cara and Dan; Eve has a family of her own.
:as_ana
select public.create_group('Edit Fam');
reset role;
insert into test.vals select 'ed_fam', id::text from public.groups where name = 'Edit Fam';
insert into test.vals select 'ed_code', invite_code from public.groups where name = 'Edit Fam';
:as_ben
select public.join_group((select v from test.vals where k = 'ed_code'));
:as_cara
select public.join_group((select v from test.vals where k = 'ed_code'));
:as_dan
select public.join_group((select v from test.vals where k = 'ed_code'));
:as_eve
select public.create_group('Eve Fam');

-- ---- Editing: someone was left out, the day was wrong ----------------------------------------------------------------------------
-- Ben logs E7701 as watched by Ana and Ben three days ago: a "logged" night.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7701;
select public.log_watch(test.eitem(7701), current_date - 3, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n1', test.enight(7701)::text);
select test.expect_eq(test.nightwatchers(test.v('ed_n1')), array['Ana', 'Ben'], 'the night starts with the two who were logged');

-- What each person may do with it, as the night's state tells the app.
select test.expect_eq(test.flag(test.v('ed_n1'), 'ana', 'can_edit'), true, 'the owner can edit it');
select test.expect_eq(test.flag(test.v('ed_n1'), 'ana', 'can_delete'), true, 'and delete it');
select test.expect_eq(test.flag(test.v('ed_n1'), 'cara', 'can_edit'), true, 'any member can edit it');
select test.expect_eq(test.flag(test.v('ed_n1'), 'cara', 'can_delete'), false, 'but not delete one they had nothing to do with');
select test.expect_eq(test.flag(test.v('ed_n1'), 'ben', 'can_delete'), true, 'whoever logged it can delete it');
select test.expect_eq((select (public.movie_night_state(test.v('ed_n1')) -> 'night' ->> 'picked_tmdb_id')::integer), 7701, 'the state names the title to open');
:as_eve
select test.expect_error($$select public.movie_night_state(test.v('ed_n1'))$$, 'not available');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 3, test.vw(array['ana']))$$, 'not available');
select test.expect_error($$select public.delete_movie_night(test.v('ed_n1'))$$, 'not available');

-- Cara adds herself and Dan (with a score filled in for Dan).
:as_cara
select public.update_movie_night(test.v('ed_n1'), current_date - 3, test.vw(array['ana', 'ben', 'cara', 'dan'], 'dan', 8),
  current_date - 3, test.ua(array['ana', 'ben']));
reset role;
select test.expect_eq(test.watchers(7701), array['Ana', 'Ben', 'Cara', 'Dan'], 'everyone is on the title''s watch record');
select test.expect_eq(test.nightwatchers(test.v('ed_n1')), array['Ana', 'Ben', 'Cara', 'Dan'], 'and on the night');
select test.expect_eq((select count(*) from public.watches where list_item_id = test.eitem(7701) and watched_on = current_date - 3), 4::bigint, 'all on the night''s day');
select test.expect_eq((select logged_by from public.watches where list_item_id = test.eitem(7701) and user_id = test.u('dan')), test.u('cara'), 'with the editor as who logged the new ones');
select test.expect_eq((select watch_origin || status from public.list_items where id = test.emine('cara', 7701)), 'createdwatched'::text, 'it is on Cara''s My list as watched');
select test.expect_eq((select source_item_id from public.list_items where id = test.emine('dan', 7701)), test.eitem(7701), 'and on Dan''s, linked to the family title');
select test.expect_eq((select score from public.ratings where list_item_id = test.eitem(7701) and user_id = test.u('dan')), 8::numeric, 'Dan has the score filled in for him');
select test.expect_eq((select rated_by from public.ratings where list_item_id = test.eitem(7701) and user_id = test.u('dan')), test.u('cara'), 'by Cara');
select test.expect_eq((select count(*) from public.ratings where list_item_id = test.emine('dan', 7701) and score = 8), 1::bigint, 'and it follows him to My list');
select test.expect_eq(test.ed_events('movie_night_edited'), 1::bigint, 'the feed has one line for the edit');
select test.expect_eq((select detail from public.activity where group_id = test.v('ed_fam') and kind = 'movie_night_edited'), 'Ana, Ben, Cara, Dan'::text, 'naming everyone who watched');
:as_dan
select test.expect_eq((select count(*) from public.pending_rating_requests() where list_item_id = test.eitem(7701)), 1::bigint, 'Dan is asked to confirm his score');
:as_cara
select test.expect_eq((select count(*) from public.pending_rating_requests() where list_item_id = test.eitem(7701)), 1::bigint, 'and Cara to rate it');

-- Saving what is already there changes nothing, not even the feed.
select public.update_movie_night(test.v('ed_n1'), current_date - 3, test.vw(array['ana', 'ben', 'cara', 'dan']), current_date - 3, test.ua(array['ana', 'ben', 'cara', 'dan']));
reset role;
select test.expect_eq(test.ed_events('movie_night_edited'), 1::bigint, 'saving nothing new writes nothing');

-- The day was wrong. Ben had taken it off his My list; it stays off.
:as_ben
update public.list_items set deleted_at = now() where id = test.emine('ben', 7701);
:as_cara
select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ana', 'ben', 'cara', 'dan']), current_date - 3, test.ua(array['ana', 'ben', 'cara', 'dan']));
reset role;
select test.expect_eq((select count(*) from public.watches where list_item_id = test.eitem(7701) and watched_on = current_date - 4), 4::bigint, 'the day moved for everyone on the record');
select test.expect_eq((select happened_on from public.movie_nights where id = test.v('ed_n1')), current_date - 4, 'and for the night');
select test.expect_eq((select watched_at::date from public.list_items where id = test.emine('cara', 7701)), current_date - 4, 'and on the My list entries it put there');
select test.expect_eq((select deleted_at is not null from public.list_items where id = test.emine('ben', 7701)), true, 'but not for the one Ben removed: it stays removed');
select test.expect_eq((select watched_at::date from public.list_items where id = test.emine('ben', 7701)), current_date - 3, 'and untouched');

-- Someone changed it while Cara had it open: nothing is saved.
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ana', 'ben', 'cara']), current_date - 3, test.ua(array['ana', 'ben', 'cara', 'dan']))$$, 'changed this movie night');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ana', 'ben', 'cara']), null, test.ua(array['ana', 'ben']))$$, 'changed this movie night');
reset role;
select test.expect_eq(test.watchers(7701), array['Ana', 'Ben', 'Cara', 'Dan'], 'and the record is as it was');

-- Taking someone off: Dan only has the score Cara filled in for him, so Ana can.
:as_ana
select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ana', 'ben', 'cara']), current_date - 4, test.ua(array['ana', 'ben', 'cara', 'dan']));
reset role;
select test.expect_eq(test.watchers(7701), array['Ana', 'Ben', 'Cara'], 'Dan is off the record');
select test.expect_eq(test.nightwatchers(test.v('ed_n1')), array['Ana', 'Ben', 'Cara'], 'and off the night');
select test.expect_eq(test.emine('dan', 7701) is null, true, 'the title is off his My list again');
select test.expect_eq((select count(*) from public.ratings where list_item_id = test.eitem(7701) and user_id = test.u('dan')), 0::bigint, 'with the score that was filled in for him');
select test.expect_eq((select status from public.list_items where id = test.eitem(7701)), 'watched'::text, 'and the title stays watched together');
:as_dan
select test.expect_eq((select count(*) from public.pending_rating_requests() where list_item_id = test.eitem(7701)), 0::bigint, 'he is no longer asked about it');

-- Someone who rated it themselves can only take themselves off.
:as_cara
insert into public.ratings (list_item_id, user_id, score, comment) values (test.eitem(7701), test.u('cara'), 7, 'Fun');
:as_ana
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ana', 'ben']))$$, 'Cara can only take themselves off');
-- ...and the same for someone who reacted on their own My list entry, even the person editing.
insert into public.reactions (list_item_id, user_id, value) values (test.emine('ana', 7701), test.u('ana'), 'like');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ben', 'cara']))$$, 'You can only take yourself off');
reset role;
select test.expect_eq(test.watchers(7701), array['Ana', 'Ben', 'Cara'], 'a refused edit changes nothing');
select test.expect_eq(test.nightwatchers(test.v('ed_n1')), array['Ana', 'Ben', 'Cara'], 'on the night either');

-- What is asked for has to make sense.
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, '[]'::jsonb)$$, 'at least one person');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, '{}'::jsonb)$$, 'at least one person');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ana', 'eve']))$$, 'Only members of this family');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date + 5, test.vw(array['ana', 'ben', 'cara']))$$, 'not in the future');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), null, test.vw(array['ana', 'ben', 'cara']))$$, 'not in the future');
select test.expect_error($$select public.update_movie_night(test.v('ed_n1'), current_date - 4, test.vw(array['ana', 'ben', 'cara'], 'ben', 11))$$, 'between 1 and 10');

-- Replacing everyone keeps the night: the new people are added before the others are taken off.
:as_ana
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ana'), id from public.media where tmdb_id = 7702;
select public.log_watch(test.eitem(7702), current_date - 2, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n2', test.enight(7702)::text);
:as_cara
select public.update_movie_night(test.v('ed_n2'), current_date - 2, test.vw(array['cara', 'dan']));
reset role;
select test.expect_eq(test.watchers(7702), array['Cara', 'Dan'], 'replacing everyone: only the new people are on the record');
select test.expect_eq(test.enight(7702), test.v('ed_n2'), 'and it is still the same night');
select test.expect_eq(test.nightwatchers(test.v('ed_n2')), array['Cara', 'Dan'], 'with them on it');
select test.expect_eq(test.emine('ben', 7702) is null, true, 'Ben''s My list entry from the log is gone');

-- ---- Nights that can't be edited --------------------------------------------------------------------------------------------------
-- One that is going, and one that was cancelled.
:as_ana
select public.start_movie_night(test.v('ed_fam'), '{}', '{}', test.cands(7711, 7722)) as night_o \gset
reset role;
insert into test.vals values ('ed_open', :'night_o');
select test.expect_eq(test.flag(test.v('ed_open'), 'ana', 'can_edit'), false, 'a night that is going can''t be edited');
select test.expect_eq(test.flag(test.v('ed_open'), 'ana', 'can_delete'), false, 'or deleted');
:as_ana
select test.expect_error($$select public.update_movie_night(test.v('ed_open'), current_date, test.vw(array['ana']))$$, 'picked a title');
select test.expect_error($$select public.delete_movie_night(test.v('ed_open'))$$, 'Cancel this movie night first');
select public.cast_movie_night_votes((select id from public.movie_night_stacks where night_id = test.v('ed_open')),
  jsonb_build_array(jsonb_build_object('candidate_id', (select id from public.movie_night_candidates where night_id = test.v('ed_open') order by position limit 1), 'vote', 'yes')));
select public.cancel_movie_night(test.v('ed_open'));
select test.expect_error($$select public.update_movie_night(test.v('ed_open'), current_date, test.vw(array['ana']))$$, 'picked a title');
reset role;
select test.expect_eq(test.flag(test.v('ed_open'), 'ana', 'can_delete'), true, 'a cancelled one can be deleted by the person who started it');
select test.expect_eq(test.flag(test.v('ed_open'), 'ben', 'can_delete'), false, 'not by another member');
:as_ben
select test.expect_error($$select public.delete_movie_night(test.v('ed_open'))$$, 'owner, or whoever started or ended');
reset role;
select test.expect_eq((select count(*) from public.movie_night_candidates where night_id = test.v('ed_open')), 12::bigint, 'it had its cards');
select test.expect_eq((select count(*) from public.movie_night_votes where candidate_id in (select id from public.movie_night_candidates where night_id = test.v('ed_open'))), 1::bigint, 'and a vote');
:as_ana
select public.delete_movie_night(test.v('ed_open'));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_open')), 0::bigint, 'the night is gone');
select test.expect_eq((select count(*) from public.movie_night_candidates where night_id = test.v('ed_open')), 0::bigint, 'with its cards');
select test.expect_eq((select count(*) from public.movie_night_stacks where night_id = test.v('ed_open')), 0::bigint, 'and its stack');
select test.expect_eq((select count(*) from public.movie_night_votes where candidate_id in (select id from public.movie_night_candidates where night_id = test.v('ed_open'))), 0::bigint, 'and its votes');
select test.expect_eq((select count(*) from public.movie_night_members where night_id = test.v('ed_open')), 0::bigint, 'and who took part');
select test.expect_eq(test.ed_events('movie_night_deleted'), 1::bigint, 'the feed says it was deleted');
select test.expect_eq((select detail from public.activity where group_id = test.v('ed_fam') and kind = 'movie_night_deleted'), current_date::text, 'on which day it was');
select test.expect_eq((select media_title from public.activity where group_id = test.v('ed_fam') and kind = 'movie_night_deleted'), null::text, 'with no title, as nobody picked one');

-- A night started from a plan: deleting it leaves the plan started, and its guest and link go with it.
:as_ana
select public.plan_movie_night(test.v('ed_fam'), now() + interval '2 days', null, '{}', '{}') as plan_id \gset
:as_cara
select public.start_movie_night(test.v('ed_fam'), '{}', '{}', test.cands(7711, 7722), :'plan_id'::uuid) as night_p \gset
select public.cancel_movie_night(:'night_p'::uuid);
reset role;
insert into test.vals values ('ed_np', :'night_p');
insert into public.movie_night_links (night_id, token, created_by) values (test.v('ed_np'), repeat('ab', 32), test.u('cara'));
insert into public.movie_night_guests (night_id, name, secret_hash) values (test.v('ed_np'), 'Zoe', sha256('guest-secret'::bytea));
:as_ana
select public.delete_movie_night(test.v('ed_np'));
reset role;
select test.expect_eq((select status || coalesce(night_id::text, '-') from public.movie_night_plans where id = :'plan_id'::uuid), 'started-'::text, 'the plan stays started, with no night');
select test.expect_eq((select count(*) from public.movie_night_links where night_id = test.v('ed_np')) + (select count(*) from public.movie_night_guests where night_id = test.v('ed_np')), 0::bigint, 'the guest link and its guests are gone');

-- Two nights for one title and day: nobody can tell whose record it is.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7703;
select public.log_watch(test.eitem(7703), current_date - 2, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n3', test.enight(7703)::text);
insert into public.movie_nights (group_id, source, status, started_by, ended_by, picked_media_id, picked_list_item_id, happened_on)
  select group_id, 'logged', 'closed', started_by, ended_by, picked_media_id, picked_list_item_id, happened_on from public.movie_nights where id = test.v('ed_n3');
insert into test.vals select 'ed_n3b', id::text from public.movie_nights where picked_list_item_id = test.eitem(7703) and id <> test.v('ed_n3');
select test.expect_eq(test.flag(test.v('ed_n3'), 'ben', 'can_edit'), false, 'two nights of one title and day: neither can be edited');
:as_ben
select test.expect_error($$select public.update_movie_night(test.v('ed_n3'), current_date - 2, test.vw(array['ben', 'cara']))$$, 'same day');
select public.delete_movie_night(test.v('ed_n3b'));
reset role;
select test.expect_eq(test.flag(test.v('ed_n3'), 'ben', 'can_edit'), true, 'with one of them deleted, the other can');

-- The same title logged on two days: its people were logged on different days.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7704;
select public.log_watch(test.eitem(7704), current_date - 5, test.vw(array['ben']));
:as_cara
select public.log_watch(test.eitem(7704), current_date - 4, test.vw(array['cara']));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where picked_list_item_id = test.eitem(7704)), 2::bigint, 'a second day made a second night');
select test.expect_eq(test.flag((select id from public.movie_nights where picked_list_item_id = test.eitem(7704) order by happened_on limit 1), 'ben', 'can_edit'), false, 'neither can be edited while the days differ');
:as_ben
select test.expect_error($$select public.update_movie_night((select id from public.movie_nights where picked_list_item_id = test.eitem(7704) order by happened_on limit 1), current_date - 5, test.vw(array['ben', 'ana']))$$, 'different days');
:as_cara
delete from public.watches where list_item_id = test.eitem(7704) and user_id = test.u('cara');
reset role;
select test.expect_eq(test.flag(test.enight(7704), 'ben', 'can_edit'), true, 'once Cara took herself off, the remaining night can be edited');

-- A title put back on the list to watch again: its earlier night is a record of the past.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7705;
select public.log_watch(test.eitem(7705), current_date - 9, test.vw(array['ben', 'ana']));
reset role;
insert into test.vals values ('ed_old', test.enight(7705)::text);
:as_ben
select public.watch_again(test.eitem(7705));
reset role;
select test.expect_eq(test.flag(test.v('ed_old'), 'ben', 'can_edit'), false, 'a night whose viewing went to the history can''t be edited');
:as_ben
select test.expect_error($$select public.update_movie_night(test.v('ed_old'), current_date - 9, test.vw(array['ben', 'ana', 'cara']))$$, 'earlier viewing');
select test.expect_error($$select public.delete_movie_night(test.v('ed_old'), true)$$, 'earlier viewing');
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_old')), 1::bigint, 'and it is still there');
-- Watched again: the new night can be edited, but not back onto the earlier viewing's day.
:as_ben
select public.watched_again(test.eitem(7705), current_date - 1, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_new', test.enight(7705)::text);
select test.expect_eq(test.flag(test.v('ed_new'), 'ben', 'can_edit'), true, 'the new viewing''s night can be edited');
:as_ben
select test.expect_error($$select public.update_movie_night(test.v('ed_new'), current_date - 9, test.vw(array['ben']))$$, 'after the earlier viewing');
select test.expect_error($$select public.update_movie_night(test.v('ed_new'), current_date - 10, test.vw(array['ben']))$$, 'after the earlier viewing');
select public.update_movie_night(test.v('ed_new'), current_date - 8, test.vw(array['ben', 'cara']));
reset role;
select test.expect_eq((select happened_on from public.movie_nights where id = test.v('ed_new')), current_date - 8, 'any later day is fine');
select test.expect_eq((select happened_on from public.movie_nights where id = test.v('ed_old')), current_date - 9, 'and the earlier night is as it was');
select test.expect_eq((select count(*) from public.watch_history where media_id = (select media_id from public.list_items where id = test.eitem(7705)) and group_id = test.v('ed_fam')), 2::bigint, 'and the earlier viewing is still in the history');

-- A title taken off the family list: bring it back first.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7706;
select public.log_watch(test.eitem(7706), current_date - 2, test.vw(array['ben']));
:as_ana
update public.list_items set deleted_at = now() where id = test.eitem(7706);
reset role;
select test.expect_eq(test.flag(test.enight(7706), 'ana', 'can_edit'), false, 'a title that was removed can''t be edited');
:as_ana
select test.expect_error($$select public.update_movie_night(test.enight(7706), current_date - 2, test.vw(array['ben', 'cara']))$$, 'removed from the family list');
select test.expect_error($$select public.delete_movie_night(test.enight(7706), true)$$, 'removed from the family list');
select public.delete_movie_night(test.enight(7706));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where picked_list_item_id = test.eitem(7706)), 0::bigint, 'but the night can still be deleted');

-- Someone who left the family stays on the record; their day moves with it.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7707;
select public.log_watch(test.eitem(7707), current_date - 6, test.vw(array['ana', 'ben', 'dan']));
:as_dan
select public.leave_group(test.v('ed_fam'));
:as_ana
select public.update_movie_night(test.enight(7707), current_date - 7, test.vw(array['ana', 'ben']), current_date - 6, test.ua(array['ana', 'ben']));
select test.expect_error($$select public.update_movie_night(test.enight(7707), current_date - 7, test.vw(array['ana', 'ben', 'dan']))$$, 'Only members of this family');
reset role;
select test.expect_eq(test.watchers(7707), array['Ana', 'Ben', 'Dan'], 'the one who left is still on the record');
select test.expect_eq((select count(*) from public.watches where list_item_id = test.eitem(7707) and watched_on = current_date - 7), 3::bigint, 'on the same day as the others');
select test.expect_eq((select watched_at::date from public.list_items where id = test.emine('dan', 7707)), current_date - 7, 'and so is the entry on his My list');
select test.expect_eq((select detail from public.activity where kind = 'movie_night_edited' and group_id = test.v('ed_fam') order by created_at desc limit 1), 'Ana, Ben'::text, 'the feed names the family''s members');
-- He rejoins for what follows.
:as_dan
select public.join_group((select v from test.vals where k = 'ed_code'));

-- ---- Deleting a night that was logged ---------------------------------------------------------------------------------------------
-- The title stays watched together, with everyone on it and on their My list.
:as_ben
select public.delete_movie_night(test.v('ed_n1'));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_n1')), 0::bigint, 'the logged night is gone');
select test.expect_eq(test.watchers(7701), array['Ana', 'Ben', 'Cara'], 'but the title is still watched together by the same people');
select test.expect_eq((select status from public.list_items where id = test.eitem(7701)), 'watched'::text, 'and watched');
select test.expect_eq(test.emine('cara', 7701) is not null, true, 'on their My list too');
select test.expect_eq((select detail from public.activity where kind = 'movie_night_deleted' and media_title = 'E7701'), (current_date - 4)::text, 'the feed has its day');
-- Logging it again on that day makes a new night.
:as_ana
select public.log_watch(test.eitem(7701), current_date - 4, test.vw(array['ana']));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where picked_list_item_id = test.eitem(7701)), 1::bigint, 'logging it again makes a new night');

-- With the title taken off Watched together too: everyone on it is taken off, with what came with it.
:as_ana
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ana'), id from public.media where tmdb_id = 7708;
select public.log_watch(test.eitem(7708), current_date - 2, test.vw(array['ana', 'ben', 'cara'], 'cara', 6));
reset role;
insert into test.vals values ('ed_n8', test.enight(7708)::text);
:as_ben
select test.expect_error($$select public.delete_movie_night(test.v('ed_n8'), true)$$, 'owner, or whoever started or ended');
:as_ana
select public.delete_movie_night(test.v('ed_n8'), true);
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_n8')), 0::bigint, 'undoing: the night is gone');
select test.expect_eq((select status || coalesce(watched_at::text, '-') from public.list_items where id = test.eitem(7708)), 'want-'::text, 'the title is back on To watch');
select test.expect_eq(test.watchers(7708), '{}'::text[], 'with nobody on its record');
select test.expect_eq((select count(*) from public.list_items where source_item_id = test.eitem(7708)), 0::bigint, 'the entries it put on My lists are gone');
select test.expect_eq((select count(*) from public.ratings where list_item_id = test.eitem(7708)), 0::bigint, 'with the score filled in for Cara');
select test.expect_eq((select detail from public.activity where kind = 'movie_night_deleted' and media_title = 'E7708'), (current_date - 2)::text || ' undone', 'the feed says so');

-- ...unless one of them rated it or reacted themselves: they take themselves off first.
:as_ana
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ana'), id from public.media where tmdb_id = 7709;
select public.log_watch(test.eitem(7709), current_date - 2, test.vw(array['ana', 'ben']));
:as_ben
insert into public.ratings (list_item_id, user_id, score) values (test.eitem(7709), test.u('ben'), 9);
:as_ana
select test.expect_error($$select public.delete_movie_night(test.enight(7709), true)$$, 'Ben can only take themselves off');
insert into public.reactions (list_item_id, user_id, value) values (test.emine('ana', 7709), test.u('ana'), 'dislike');
:as_ben
delete from public.watches where list_item_id = test.eitem(7709) and user_id = test.u('ben');
:as_ana
select test.expect_error($$select public.delete_movie_night(test.enight(7709), true)$$, 'You can only take yourself off');
reset role;
select test.expect_eq((select count(*) from public.movie_nights where picked_list_item_id = test.eitem(7709)), 1::bigint, 'a refused deletion leaves the night');
select test.expect_eq(test.watchers(7709), array['Ana'], 'and the record');

-- The history of a night follows a person leaving the record, except while one night is being edited or deleted: then
-- no other night of the title is touched.
:as_ana
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ana'), id from public.media where tmdb_id = 7710;
select public.log_watch(test.eitem(7710), current_date - 2, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n10', test.enight(7710)::text);
select set_config('famflix.editing_night', 'on', false);
delete from public.watches where list_item_id = test.eitem(7710) and user_id = test.u('ben');
select test.expect_eq(test.nightwatchers(test.v('ed_n10')), array['Ana', 'Ben'], 'while one night is handled on its own, the trigger leaves the nights alone');
delete from public.watches where list_item_id = test.eitem(7710) and user_id = test.u('ana');
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_n10')), 1::bigint, 'it does not delete a night nobody is left on');
select set_config('famflix.editing_night', 'off', false);
select test.expect_eq(test.emine('ana', 7710) is null and test.emine('ben', 7710) is null, true, 'though it still cleans up My list');
select test.expect_eq((select status from public.list_items where id = test.eitem(7710)), 'want'::text, 'and puts the title back on To watch');

-- ---- Whose private state a removal may not touch -----------------------------------------------------------------------------
-- A rating with no author at all (from before the database recorded who wrote one) counts as the person's own.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7713;
select public.log_watch(test.eitem(7713), current_date - 2, test.vw(array['ben', 'dan']));
reset role;
insert into test.vals values ('ed_n13', test.enight(7713)::text);
select set_config('request.jwt.claim.sub', '', false);
insert into public.ratings (list_item_id, user_id, score) values (test.eitem(7713), test.u('dan'), 5);
select test.expect_eq((select rated_by is null from public.ratings where list_item_id = test.eitem(7713) and user_id = test.u('dan')), true, 'a rating with no author');
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n13'), current_date - 2, test.vw(array['ben']))$$, 'Dan can only take themselves off');
reset role;
delete from public.ratings where list_item_id = test.eitem(7713) and user_id = test.u('dan');
-- A rating the person gave on their own My list entry only (6.5 puts no thumb on it).
:as_dan
insert into public.ratings (list_item_id, user_id, score) values (test.emine('dan', 7713), test.u('dan'), 6.5);
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n13'), current_date - 2, test.vw(array['ben']))$$, 'Dan can only take themselves off');
:as_dan
delete from public.ratings where list_item_id = test.emine('dan', 7713) and user_id = test.u('dan');
:as_cara
select public.update_movie_night(test.v('ed_n13'), current_date - 2, test.vw(array['ben']));
reset role;
select test.expect_eq(test.watchers(7713), array['Ben'], 'with nothing of their own left, Dan can be taken off');

-- A rating on the family title only (the copy on their My list entry is gone).
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7717;
select public.log_watch(test.eitem(7717), current_date - 2, test.vw(array['ben', 'dan']));
reset role;
insert into test.vals values ('ed_n17', test.enight(7717)::text);
:as_dan
insert into public.ratings (list_item_id, user_id, score) values (test.eitem(7717), test.u('dan'), 6.5);
delete from public.ratings where list_item_id = test.emine('dan', 7717) and user_id = test.u('dan');
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n17'), current_date - 2, test.vw(array['ben']))$$, 'Dan can only take themselves off');
reset role;
select test.expect_eq(test.watchers(7717), array['Ben', 'Dan'], 'a refused edit leaves him on it');

-- A score someone already has is never overwritten by the one filled in for them.
:as_dan
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('dan'), id from public.media where tmdb_id = 7714;
insert into public.ratings (list_item_id, user_id, score) values (test.eitem(7714), test.u('dan'), 5);
:as_ben
select public.log_watch(test.eitem(7714), current_date - 2, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n14', test.enight(7714)::text);
:as_cara
select public.update_movie_night(test.v('ed_n14'), current_date - 2, test.vw(array['ben', 'dan'], 'dan', 9));
reset role;
select test.expect_eq((select score from public.ratings where list_item_id = test.eitem(7714) and user_id = test.u('dan')), 5::numeric, 'adding someone who has a score keeps it');

-- A night everyone was taken off, but that is still in the history, can be edited: someone was there after all.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7715;
select public.log_watch(test.eitem(7715), current_date - 2, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n15', test.enight(7715)::text);
update public.movie_nights set source = 'swipe' where id = test.v('ed_n15');
:as_ben
delete from public.watches where list_item_id = test.eitem(7715) and user_id = test.u('ben');
reset role;
select test.expect_eq((select status from public.list_items where id = test.eitem(7715)), 'want'::text, 'everyone left: the title is To watch');
select test.expect_eq(test.flag(test.v('ed_n15'), 'cara', 'can_edit'), true, 'the night can still be edited');
:as_cara
select public.update_movie_night(test.v('ed_n15'), current_date - 2, test.vw(array['cara']));
reset role;
select test.expect_eq((select status from public.list_items where id = test.eitem(7715)), 'watched'::text, 'adding someone makes it watched together again');
select test.expect_eq(test.watchers(7715), array['Cara'], 'with them on its record');
select test.expect_eq(test.nightwatchers(test.v('ed_n15')), array['Cara'], 'and on the night');

-- The same person logged a title on two days: only the later night is theirs to edit, and changing it leaves the older one alone.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7712;
select public.log_watch(test.eitem(7712), current_date - 5, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n12a', test.enight(7712)::text);
:as_ben
select public.log_watch(test.eitem(7712), current_date - 4, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n12b', test.enight(7712)::text);
select test.expect_eq(test.v('ed_n12a') <> test.v('ed_n12b'), true, 'two days made two nights');
select test.expect_eq(test.flag(test.v('ed_n12b'), 'cara', 'can_edit'), true, 'the later one can be edited');
select test.expect_eq(test.flag(test.v('ed_n12a'), 'cara', 'can_edit'), false, 'the earlier one can''t');
:as_cara
select public.update_movie_night(test.v('ed_n12b'), current_date - 4, test.vw(array['cara']));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_n12a')), 1::bigint, 'replacing the people of the later night leaves the earlier one');
select test.expect_eq(test.nightwatchers(test.v('ed_n12a')), array['Ben'], 'with Ben still on it');
select test.expect_eq(test.nightwatchers(test.v('ed_n12b')), array['Cara'], 'and the later one has Cara');
-- Taking the title off Watched together for the later night leaves the earlier one alone too.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7716;
select public.log_watch(test.eitem(7716), current_date - 5, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n16a', test.enight(7716)::text);
:as_ben
select public.log_watch(test.eitem(7716), current_date - 4, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n16b', test.enight(7716)::text);
:as_ana
select public.delete_movie_night(test.v('ed_n16b'), true);
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_n16a')), 1::bigint, 'undoing the later night leaves the earlier one');
select test.expect_eq(test.nightwatchers(test.v('ed_n16a')), array['Ben'], 'with Ben still on it');
select test.expect_eq((select status from public.list_items where id = test.eitem(7716)), 'want'::text, 'while the title is To watch');

-- A night one member started and another cancelled: both can delete it, the owner too, and nobody else.
:as_ben
select public.start_movie_night(test.v('ed_fam'), '{}', '{}', test.cands(7731, 7740)) as night_s \gset
:as_cara
select public.cancel_movie_night(:'night_s'::uuid);
reset role;
insert into test.vals values ('ed_ns', :'night_s');
select test.expect_eq(test.flag(test.v('ed_ns'), 'ben', 'can_delete'), true, 'whoever started it can delete it');
select test.expect_eq(test.flag(test.v('ed_ns'), 'cara', 'can_delete'), true, 'and whoever cancelled it');
select test.expect_eq(test.flag(test.v('ed_ns'), 'ana', 'can_delete'), true, 'and the owner');
select test.expect_eq(test.flag(test.v('ed_ns'), 'dan', 'can_delete'), false, 'but not another member');
:as_dan
select test.expect_error($$select public.delete_movie_night(test.v('ed_ns'))$$, 'owner, or whoever started or ended');

-- ---- The day of people who weren't there, notes nobody else may wipe, and accounts that are gone -----------------------------------
-- Changing a night's day moves the My list date of the people on its record only. Cara was at an earlier viewing of the title
-- (it is in the history now), not at this one, so her entry keeps the day she watched it.
:as_ana
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ana'), id from public.media where tmdb_id = 7718;
select public.log_watch(test.eitem(7718), current_date - 10, test.vw(array['ana', 'cara']));
select public.watch_again(test.eitem(7718));
:as_ben
select public.log_watch(test.eitem(7718), current_date - 5, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n18', test.enight(7718)::text);
select test.expect_eq((select watched_at::date from public.list_items where id = test.emine('cara', 7718)), current_date - 10, 'Cara''s entry has the day of the viewing she was at');
:as_ben
select public.update_movie_night(test.v('ed_n18'), current_date - 4, test.vw(array['ana', 'ben']), current_date - 5, test.ua(array['ana', 'ben']));
reset role;
select test.expect_eq((select watched_at::date from public.list_items where id = test.emine('ana', 7718)), current_date - 4, 'the new day follows for Ana, who was there');
select test.expect_eq((select watched_at::date from public.list_items where id = test.emine('ben', 7718)), current_date - 4, 'and for Ben');
select test.expect_eq((select watched_at::date from public.list_items where id = test.emine('cara', 7718)), current_date - 10, 'but not for Cara, who was at the earlier viewing only');

-- A note is the person's own, even when someone filled a score in beside it afterwards (which makes that someone the author of the
-- score): nobody else can take them off the night and wipe it, by editing or by deleting the night with its watch.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7719;
:as_cara
insert into public.ratings (list_item_id, user_id, comment) values (test.eitem(7719), test.u('cara'), 'MY OWN PRIVATE NOTE');
:as_ana
select public.log_watch(test.eitem(7719), current_date - 2, test.vw(array['ana', 'ben', 'cara'], 'cara', 8));
reset role;
insert into test.vals values ('ed_n19', test.enight(7719)::text);
select test.expect_eq((select rated_by from public.ratings where list_item_id = test.eitem(7719) and user_id = test.u('cara')), test.u('ana'), 'Ana filled a score in beside Cara''s note');
select test.expect_eq((select comment from public.ratings where list_item_id = test.eitem(7719) and user_id = test.u('cara')), 'MY OWN PRIVATE NOTE'::text, 'and the note is still there');
:as_ben
select test.expect_error($$select public.update_movie_night(test.v('ed_n19'), current_date - 2, test.vw(array['ana', 'ben']))$$, 'Cara can only take themselves off');
:as_ana
select test.expect_error($$select public.delete_movie_night(test.v('ed_n19'), true)$$, 'Cara can only take themselves off');
reset role;
select test.expect_eq(test.watchers(7719), array['Ana', 'Ben', 'Cara'], 'a refused edit, or a refused delete, leaves her on the record');
select test.expect_eq((select comment from public.ratings where list_item_id = test.eitem(7719) and user_id = test.u('cara')), 'MY OWN PRIVATE NOTE'::text, 'with her note');
select test.expect_eq((select count(*) from public.ratings where list_item_id = test.emine('cara', 7719) and comment = 'MY OWN PRIVATE NOTE'), 1::bigint, 'and the copy on her My list');
-- A comment of only blanks is no note.
:as_dan
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('dan'), id from public.media where tmdb_id = 7720;
:as_cara
insert into public.ratings (list_item_id, user_id, comment) values (test.eitem(7720), test.u('cara'), '   ');
:as_ana
select public.log_watch(test.eitem(7720), current_date - 2, test.vw(array['ana', 'dan', 'cara'], 'cara', 6));
reset role;
insert into test.vals values ('ed_n20', test.enight(7720)::text);
:as_ben
select public.update_movie_night(test.v('ed_n20'), current_date - 2, test.vw(array['ana', 'dan']));
reset role;
select test.expect_eq(test.watchers(7720), array['Ana', 'Dan'], 'with only blanks for a note, someone can be taken off');

-- A night whose starter has deleted their account has nobody recorded as starting or ending it: the family's owner can still delete
-- it, and no other member can. The name of the deleted account leaves the feed's line about the edit, like the others'.
:as_fay
select public.join_group((select v from test.vals where k = 'ed_code'));
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('fay'), id from public.media where tmdb_id = 7721;
select public.log_watch(test.eitem(7721), current_date - 2, test.vw(array['fay', 'ben']));
reset role;
insert into test.vals values ('ed_n21', test.enight(7721)::text);
:as_ben
select public.update_movie_night(test.v('ed_n21'), current_date - 2, test.vw(array['ana', 'ben', 'fay']), current_date - 2, test.ua(array['ben', 'fay']));
reset role;
select test.expect_eq((select detail from public.activity where group_id = test.v('ed_fam') and kind = 'movie_night_edited' order by created_at desc limit 1), 'Ana, Ben, Fay'::text, 'the feed names everyone who watched');
delete from auth.users where id = test.u('fay');
select test.expect_eq((select detail from public.activity where group_id = test.v('ed_fam') and kind = 'movie_night_edited' order by created_at desc limit 1), 'Ana, Ben, someone'::text, 'but not an account that was deleted');
select test.expect_eq((select started_by is null and ended_by is null from public.movie_nights where id = test.v('ed_n21')), true, 'nobody is recorded as having started or ended the night');
select test.expect_eq(test.flag(test.v('ed_n21'), 'cara', 'can_delete'), false, 'another member is not told they can delete it');
select test.expect_eq(test.flag(test.v('ed_n21'), 'ana', 'can_delete'), true, 'the owner is');
:as_cara
select test.expect_error($$select public.delete_movie_night(test.v('ed_n21'))$$, 'owner, or whoever started or ended');
:as_ana
select public.delete_movie_night(test.v('ed_n21'));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_n21')), 0::bigint, 'the owner deleted it');

-- A night that is older than a viewing in the title's history is not the title's current viewing, whatever its own day is: the same
-- people logged the title again on a later day (which left this night behind, still saying they watched it) and the family put it
-- back on the list to watch again. It can't be edited, and deleting it can't take the title off Watched together.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7722;
select public.log_watch(test.eitem(7722), current_date - 6, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n22a', test.enight(7722)::text);
:as_ben
select public.log_watch(test.eitem(7722), current_date - 4, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n22b', test.enight(7722)::text);
select test.expect_eq(test.v('ed_n22a') <> test.v('ed_n22b'), true, 'logging it again on a later day made a second night');
select test.expect_eq(test.nightwatchers(test.v('ed_n22a')), array['Ana', 'Ben'], 'the older one still says they watched it');
:as_ana
select public.watch_again(test.eitem(7722));
reset role;
select test.expect_eq(test.watchers(7722), '{}'::text[], 'the title is back on To watch, with nobody on its record');
select test.expect_eq(test.flag(test.v('ed_n22a'), 'cara', 'can_edit'), false, 'the older night can''t be edited');
select test.expect_eq(test.flag(test.v('ed_n22b'), 'cara', 'can_edit'), false, 'nor the later one');
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n22a'), current_date - 1, test.vw(array['cara']))$$, 'earlier viewing');
:as_ana
select test.expect_error($$select public.delete_movie_night(test.v('ed_n22a'), true)$$, 'earlier viewing');
select public.delete_movie_night(test.v('ed_n22a'));
reset role;
select test.expect_eq((select count(*) from public.movie_nights where id = test.v('ed_n22a')), 0::bigint, 'it can still be deleted, without the undo');
select test.expect_eq((select status from public.list_items where id = test.eitem(7722)), 'want'::text, 'and the title is still To watch');

-- A night made after the earlier one was deleted lists everyone on the record for its day, not only the people of that log.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7723;
select public.log_watch(test.eitem(7723), current_date - 3, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n23a', test.enight(7723)::text);
:as_ana
select public.delete_movie_night(test.v('ed_n23a'));
:as_ben
select public.log_watch(test.eitem(7723), current_date - 3, test.vw(array['ben', 'cara']));
reset role;
insert into test.vals values ('ed_n23b', test.enight(7723)::text);
select test.expect_eq(test.v('ed_n23a') <> test.v('ed_n23b'), true, 'a new night was made for it');
select test.expect_eq(test.watchers(7723), array['Ana', 'Ben', 'Cara'], 'the record has all three');
select test.expect_eq(test.nightwatchers(test.v('ed_n23b')), array['Ana', 'Ben', 'Cara'], 'and so does the new night');

-- A night left behind can look newer than the history: the family moved the real viewing back to an earlier day, so the older
-- night's day is later than anything in the title's history. It still says people watched it while the title's record is empty
-- (or someone else's), which gives it away: a night is only edited while it says exactly who is on the record.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7724;
select public.log_watch(test.eitem(7724), current_date - 10, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n24a', test.enight(7724)::text);
:as_ben
select public.log_watch(test.eitem(7724), current_date - 6, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n24b', test.enight(7724)::text);
:as_cara
select public.update_movie_night(test.v('ed_n24b'), current_date - 12, test.vw(array['ana', 'ben']), current_date - 6, test.ua(array['ana', 'ben']));
:as_ana
select public.watch_again(test.eitem(7724));
reset role;
select test.expect_eq((select max(watched_on) from public.watch_history h join public.media m on m.id = h.media_id where m.tmdb_id = 7724 and h.group_id = test.v('ed_fam')), current_date - 12, 'the history only goes as far as the day the real viewing was moved to');
select test.expect_eq(test.nightwatchers(test.v('ed_n24a')), array['Ana', 'Ben'], 'the older night is on a later day than that, and still says they watched it');
select test.expect_eq(test.flag(test.v('ed_n24a'), 'cara', 'can_edit'), false, 'so it can''t be edited');
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n24a'), current_date - 1, test.vw(array['cara']))$$, 'can''t be edited here');
:as_ana
select test.expect_error($$select public.delete_movie_night(test.v('ed_n24a'), true)$$, 'can''t be edited here');
reset role;
select test.expect_eq(test.watchers(7724), '{}'::text[], 'and a refused try changed nothing');

-- The family logged a rewatch with a day that was too early (a slipped month or year): it is the title's current viewing, so it
-- can be put right, even though the title's history has a viewing dated later. The first viewing's night stays an earlier one.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7725;
select public.log_watch(test.eitem(7725), current_date - 10, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n25a', test.enight(7725)::text);
:as_ana
select public.watch_again(test.eitem(7725));
:as_ben
select public.log_watch(test.eitem(7725), current_date - 12, test.vw(array['ana', 'ben']));
reset role;
insert into test.vals values ('ed_n25b', test.enight(7725)::text);
select test.expect_eq(test.v('ed_n25a') <> test.v('ed_n25b'), true, 'the rewatch is a night of its own');
select test.expect_eq(test.flag(test.v('ed_n25b'), 'cara', 'can_edit'), true, 'the rewatch is the current viewing, although the history has a later day');
select test.expect_eq(test.flag(test.v('ed_n25a'), 'cara', 'can_edit'), false, 'and the first viewing is still an earlier one');
:as_cara
select test.expect_error($$select public.update_movie_night(test.v('ed_n25b'), current_date - 11, test.vw(array['ana', 'ben']))$$, 'after the earlier viewing');
select public.update_movie_night(test.v('ed_n25b'), current_date - 3, test.vw(array['ana', 'ben']), current_date - 12, test.ua(array['ana', 'ben']));
reset role;
select test.expect_eq((select count(*) from public.watches where list_item_id = test.eitem(7725) and watched_on = current_date - 3), 2::bigint, 'moving it after the first viewing works for everyone on the record');
select test.expect_eq((select happened_on from public.movie_nights where id = test.v('ed_n25b')), current_date - 3, 'and for the night');

-- A pick from a night's cards lists everyone on the title's record for that day, like logging it does (the viewing stays when
-- a night is deleted, so Ben is still on it): the night is the title's current one and can be edited.
:as_ben
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('ben'), id from public.media where tmdb_id = 7726;
select public.log_watch(test.eitem(7726), current_date - 2, test.vw(array['ben']));
reset role;
insert into test.vals values ('ed_n26a', test.enight(7726)::text);
:as_ana
select public.delete_movie_night(test.v('ed_n26a'));
:as_dan
select public.start_movie_night(test.v('ed_fam'), '{}', '{}', test.cands(7726, 7735)) as night_c \gset
reset role;
select id as cand_c from public.movie_night_candidates c where c.night_id = :'night_c'::uuid and c.media_id = (select id from public.media where tmdb_id = 7726) \gset
:as_ana
select public.pick_movie_night_card(:'night_c'::uuid, :'cand_c'::uuid, current_date - 2, test.vw(array['ana']));
reset role;
select test.expect_eq(test.watchers(7726), array['Ana', 'Ben'], 'the record has both');
select test.expect_eq(test.nightwatchers(:'night_c'::uuid), array['Ana', 'Ben'], 'and so has the night the card was picked in');
select test.expect_eq(test.flag(:'night_c'::uuid, 'cara', 'can_edit'), true, 'which can be edited');

-- ---- Limits and access ------------------------------------------------------------------------------------------------------------
-- 60 edits an hour: the 61st is refused. (Dan hasn't edited anything yet.)
:as_dan
insert into public.list_items (group_id, added_by, media_id) select test.v('ed_fam'), test.u('dan'), id from public.media where tmdb_id = 7711;
select public.log_watch(test.eitem(7711), current_date - 2, test.vw(array['dan']));
reset role;
insert into test.vals values ('ed_n11', test.enight(7711)::text);
:as_dan
do $$ begin
  for i in 1..60 loop
    perform public.update_movie_night(test.v('ed_n11'), current_date - 2, test.vw(array['dan']), current_date - 2, test.ua(array['dan']));
  end loop;
end $$;
select test.expect_error($$select public.update_movie_night(test.v('ed_n11'), current_date - 2, test.vw(array['dan']))$$, 'too often');
-- 30 deletions an hour: the 31st is refused.
reset role;
insert into public.movie_nights (group_id, source, status, started_by, ended_by, picked_media_id, happened_on)
  select test.v('ed_fam'), 'swipe', 'cancelled', test.u('cara'), test.u('cara'), null, current_date from generate_series(1, 31);
:as_cara
do $$ declare r record; begin
  for r in select id from public.movie_nights where group_id = test.v('ed_fam') and status = 'cancelled' and started_by = test.u('cara') order by id limit 30 loop
    perform public.delete_movie_night(r.id);
  end loop;
end $$;
select test.expect_error($$select public.delete_movie_night((select id from public.movie_nights where group_id = test.v('ed_fam') and status = 'cancelled' and started_by = test.u('cara') limit 1))$$, 'too often');

-- Visitors, and the helpers behind these, are not for the API; a guest never sees the buttons.
:as_anon
select test.expect_error($$select public.update_movie_night(test.v('ed_n11'), current_date, test.vw(array['ben']))$$, 'permission denied');
select test.expect_error($$select public.delete_movie_night(test.v('ed_n11'))$$, 'permission denied');
:as_ben
select test.expect_error($$select public.movie_night_edit_problem((select m from public.movie_nights m where m.id = test.v('ed_n11')))$$, 'permission denied');
select test.expect_error($$select public.movie_night_can_delete((select m from public.movie_nights m where m.id = test.v('ed_n11')), test.u('ben'))$$, 'permission denied');
select test.expect_error($$select public.watcher_has_own_state(test.eitem(7711), test.u('ben'))$$, 'permission denied');
reset role;
select test.expect_eq((public.movie_night_state_for(test.v('ed_n11'), false, test.u('ben'), true) -> 'night' ->> 'can_edit')::boolean, false, 'a guest''s view of the night has no edit button');
select test.expect_eq((public.movie_night_state_for(test.v('ed_n11'), false, test.u('ben'), true) -> 'night' ->> 'can_delete')::boolean, false, 'and no delete button');

do $$ begin raise notice 'ALL SECURITY (EDIT/DELETE NIGHT) TESTS PASSED'; end $$;
