\set ON_ERROR_STOP 1
-- Seeing the lists of the people in your families. What is on a person's My list is theirs; the people in a family with
-- them may read it through member_list() unless they switched that off, and only what the list shows of a title: never
-- notes or reactions, never a title they removed, never the titles of a family list. Covered here: who may read whose
-- list (the same family, another family, nobody, yourself, signed out), the switch (the person's own, and nobody
-- else's), joining, leaving and being removed from a family, what the result holds (exactly these columns, in order),
-- that the rules on the tables themselves stay as strict as before, and the setting in the data download. Titles are
-- called ML<name>: Watched (7801), Want (7802), Removed (7803), Family (7804), Bea (7805) and Series (7806).
\set as_ada  'reset role; select set_config(''request.jwt.claim.sub'', ''3c3c3c3c-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_bea  'reset role; select set_config(''request.jwt.claim.sub'', ''3d3d3d3d-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_cal  'reset role; select set_config(''request.jwt.claim.sub'', ''3e3e3e3e-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_dev  'reset role; select set_config(''request.jwt.claim.sub'', ''3f3f3f3f-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set ada '''3c3c3c3c-0000-0000-0000-000000000001'''
\set bea '''3d3d3d3d-0000-0000-0000-000000000002'''
\set cal '''3e3e3e3e-0000-0000-0000-000000000003'''
\set dev '''3f3f3f3f-0000-0000-0000-000000000004'''
\set fam '(select v::uuid from test.vals where k = ''ml33_fam'')'

insert into auth.users (id, email, raw_user_meta_data) values
  (:ada, 'ada33@x.test', '{"full_name":"Ada"}'),
  (:bea, 'bea33@x.test', '{"full_name":"Bea"}'),
  (:cal, 'cal33@x.test', '{"full_name":"Cal"}'),
  (:dev, 'dev33@x.test', '{"full_name":"Dev"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

-- What a person gets from member_list(), one "title:status@day:score" per title in the order the list gives, the day only
-- for a watched one: "MLWant:want:-, MLWatched:watched@2026-03-01:8.5".
create or replace function test.ml_lines(p_user uuid) returns text language sql stable as $$
  select coalesce(string_agg(l.title || ':' || l.status || case when l.status = 'watched' then '@' || (l.watched_at at time zone 'UTC')::date else '' end
                             || ':' || coalesce(l.score::text, '-'), ', ' order by l.rn), '')
  from (select x.*, row_number() over () as rn from public.member_list(p_user) x) l $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into public.media (tmdb_id, media_type, title, release_year, poster_path, tmdb_rating) values
  (7801, 'movie', 'MLWatched', 1999, '/watched.jpg', 7.4),
  (7802, 'movie', 'MLWant', 2001, null, 6.1),
  (7803, 'movie', 'MLRemoved', 2003, null, null),
  (7804, 'movie', 'MLFamily', 2005, null, null),
  (7805, 'movie', 'MLBea', 2007, null, null),
  (7806, 'tv', 'MLSeries', 2009, null, 8.8);

-- Ada and Bea are a family, and so are Cal and Dev.
:as_ada
select public.create_group('Sharing Fam');
:as_cal
select public.create_group('Other Sharing Fam');
reset role;
insert into test.vals select 'ml33_fam', id::text from public.groups where name = 'Sharing Fam';
insert into test.vals select 'ml33_code', invite_code from public.groups where name = 'Sharing Fam';
insert into test.vals select 'ml33_fam2', id::text from public.groups where name = 'Other Sharing Fam';
insert into test.vals select 'ml33_code2', invite_code from public.groups where name = 'Other Sharing Fam';
:as_bea
select public.join_group((select v from test.vals where k = 'ml33_code'));
:as_dev
select public.join_group((select v from test.vals where k = 'ml33_code2'));

-- Ada's My list: a watched title (scored, with a note), one to watch, a series, one she removed; and a title on the family's
-- list, which is not My list. Bea has one title of her own.
:as_ada
insert into public.list_items (group_id, added_by, media_id, status)
  select null, :ada, id, 'want' from public.media where tmdb_id in (7801, 7802, 7803, 7806);
insert into public.list_items (group_id, added_by, media_id, status)
  select :fam, :ada, id, 'want' from public.media where tmdb_id = 7804;
update public.list_items set status = 'watched', watched_at = '2026-03-01 12:00:00+00'
  where group_id is null and added_by = :ada and media_id = (select id from public.media where tmdb_id = 7801);
insert into public.ratings (list_item_id, user_id, score, comment)
  select li.id, :ada, 8.5, 'ADA-PRIVATE-NOTE' from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id is null and li.added_by = :ada and m.tmdb_id = 7801;
-- (A score over 7 likes the title by itself: that is Ada's reaction.)
update public.list_items set deleted_at = now()
  where group_id is null and added_by = :ada and media_id = (select id from public.media where tmdb_id = 7803);
:as_bea
insert into public.list_items (group_id, added_by, media_id, status)
  select null, :bea, id, 'want' from public.media where tmdb_id = 7805;
reset role;
-- The order they were added in, a day apart: Watched, Want, Removed, Series.
update public.list_items li set created_at = now() - (case m.tmdb_id when 7801 then interval '5 days' when 7802 then interval '4 days'
  when 7803 then interval '3 days' when 7806 then interval '2 days' end)
  from public.media m where m.id = li.media_id and li.group_id is null and li.added_by = :ada;

select test.expect_eq((select share_my_list from public.profiles where id = :ada), true, 'a new profile shares My list with its families');

-- ---- The same family -----------------------------------------------------------------------------------------------
:as_bea
select test.expect_eq(test.ml_lines(:ada), 'MLSeries:want:-, MLWant:want:-, MLWatched:watched@2026-03-01:8.5',
  'Bea sees Ada''s list: newest first, with the day it was watched and the score');
select test.expect_eq((select count(*) from public.member_list(:ada)), 3::bigint,
  'only the titles on it: not the one she removed, nor the one on the family''s list');
select test.expect_eq((select title || '|' || release_year || '|' || poster_path || '|' || tmdb_rating
  from public.member_list(:ada) where tmdb_id = 7801), 'MLWatched|1999|/watched.jpg|7.4', 'each with its year, poster and TMDB rating');
select test.expect_eq((select media_type from public.member_list(:ada) where tmdb_id = 7806), 'tv'::text, 'and whether it is a series');
select test.expect_eq((select bool_and(added_at is not null) from public.member_list(:ada)), true, 'and when it was added');
select test.expect_eq((select count(*) from public.member_list(:ada) t where t::text ilike '%ADA-PRIVATE-NOTE%'), 0::bigint, 'her note is nowhere in it');
select test.expect_eq((select count(*) from public.member_list(:bea)), 0::bigint, 'nothing for your own list: it is yours to read as it is');
select test.expect_eq((select share_my_list from public.profiles where id = :ada), true, 'Bea can tell that Ada shares it');

-- What it gives is exactly this, which is all anyone else can read of a list.
reset role;
select test.expect_eq(pg_get_function_result('public.member_list(uuid)'::regprocedure),
  'TABLE(tmdb_id integer, media_type text, title text, release_year integer, poster_path text, tmdb_rating numeric, status text, watched_at timestamp with time zone, added_at timestamp with time zone, score numeric)',
  'it gives exactly these columns: no notes, no reactions, no ids of the list entries');

-- The tables themselves are as closed as before.
:as_bea
select test.expect_eq((select count(*) from public.list_items where added_by = :ada and group_id is null), 0::bigint, 'the entries on Ada''s My list are still hidden from Bea');
select test.expect_eq((select count(*) from public.ratings where user_id = :ada), 0::bigint, 'and so are her scores and notes');
select test.expect_eq((select count(*) from public.reactions where user_id = :ada), 0::bigint, 'and her reactions');
select test.expect_error($$insert into public.list_items (group_id, added_by, media_id) select null, '3c3c3c3c-0000-0000-0000-000000000001', id from public.media where tmdb_id = 7805$$, 'row-level security');
:as_ada
select test.expect_eq((select count(*) from public.member_list(:bea)), 1::bigint, 'and the other way round: Ada sees Bea''s list');
select test.expect_eq(test.ml_lines(:bea), 'MLBea:want:-', 'with her title');

-- ---- Other families, strangers and nobody -------------------------------------------------------------------------
:as_cal
select test.expect_eq((select count(*) from public.member_list(:ada)), 0::bigint, 'Cal, who is in another family, sees nothing of Ada''s');
select test.expect_eq((select count(*) from public.member_list(:bea)), 0::bigint, 'nor of Bea''s');
select test.expect_eq((select count(*) from public.profiles where id = :ada), 0::bigint, 'he cannot even read Ada''s profile');
select test.expect_eq((select count(*) from public.member_list(null)), 0::bigint, 'nobody in particular is nobody''s list');
select test.expect_eq((select count(*) from public.member_list('00000000-0000-0000-0000-00000000dead')), 0::bigint, 'and neither is someone who is not here');
:as_dev
select test.expect_eq((select count(*) from public.member_list(:ada)), 0::bigint, 'Dev sees nothing of Ada''s either');
:as_anon
select test.expect_error($$select * from public.member_list('3c3c3c3c-0000-0000-0000-000000000001')$$, 'permission denied');
select test.expect_error($$select * from public.member_list(null)$$, 'permission denied');

-- ---- The switch -------------------------------------------------------------------------------------------------------
:as_bea
-- Nobody else's switch is theirs to flip: the security rules hide the row, so the update reaches nothing.
update public.profiles set share_my_list = false where id = :ada;
select test.expect_error($$update public.profiles set avatar_url = null where id = '3d3d3d3d-0000-0000-0000-000000000002'$$, 'permission denied');
reset role;
select test.expect_eq((select share_my_list from public.profiles where id = :ada), true, 'Bea cannot switch Ada''s list off');
:as_ada
update public.profiles set share_my_list = false where id = :ada;
select test.expect_eq((select share_my_list from public.profiles where id = :ada), false, 'Ada switches it off');
select test.expect_eq((select count(*) from public.list_items where group_id is null and added_by = :ada and deleted_at is null), 3::bigint, 'her own list is as it was');
select test.expect_eq((public.export_my_data() -> 'account' ->> 'share_my_list_with_my_families'), 'false'::text, 'and the download says so');
:as_bea
select test.expect_eq((select count(*) from public.member_list(:ada)), 0::bigint, 'Bea now sees nothing of it');
select test.expect_eq((select share_my_list from public.profiles where id = :ada), false, 'and can tell that it is switched off');
:as_ada
update public.profiles set share_my_list = true where id = :ada;
select test.expect_eq((public.export_my_data() -> 'account' ->> 'share_my_list_with_my_families'), 'true'::text, 'switched on again, the download says so');
:as_bea
select test.expect_eq((select count(*) from public.member_list(:ada)), 3::bigint, 'and Bea sees it again');

-- ---- Changes to the list show at once -------------------------------------------------------------------------------
:as_ada
update public.list_items set deleted_at = now() where group_id is null and added_by = :ada and media_id = (select id from public.media where tmdb_id = 7802);
:as_bea
select test.expect_eq(test.ml_lines(:ada), 'MLSeries:want:-, MLWatched:watched@2026-03-01:8.5', 'a title Ada removes is gone from what Bea sees');
:as_ada
update public.list_items set deleted_at = null where group_id is null and added_by = :ada and media_id = (select id from public.media where tmdb_id = 7802);
update public.ratings set score = 9 where user_id = :ada and list_item_id = (select li.id from public.list_items li join public.media m on m.id = li.media_id where li.group_id is null and li.added_by = :ada and m.tmdb_id = 7801);
:as_bea
select test.expect_eq(test.ml_lines(:ada), 'MLSeries:want:-, MLWant:want:-, MLWatched:watched@2026-03-01:9.0', 'a new score shows, and a restored title is back');

-- ---- Joining, leaving and being removed -------------------------------------------------------------------------------
:as_cal
select public.join_group((select v from test.vals where k = 'ml33_code'));
select test.expect_eq((select count(*) from public.member_list(:ada)), 3::bigint, 'Cal joins Ada''s family as well, and sees her list');
:as_ada
select public.remove_member(:fam, :cal);
-- (Removing someone changes the family's invite code, so he cannot come back with the old one.)
reset role;
update test.vals set v = (select invite_code from public.groups where id = :fam) where k = 'ml33_code';
:as_cal
select test.expect_eq((select count(*) from public.member_list(:ada)), 0::bigint, 'Ada removes him, and he sees nothing of it again');
:as_bea
select public.leave_group(:fam);
select test.expect_eq((select count(*) from public.member_list(:ada)), 0::bigint, 'Bea leaves the family, and sees nothing of it either');
select test.expect_eq((select count(*) from public.member_list(:bea)), 0::bigint, 'still nothing of her own');
:as_ada
select test.expect_eq((select count(*) from public.member_list(:bea)), 0::bigint, 'and Ada sees nothing of Bea''s now');
-- Two families in common: leaving one is not enough to lose it.
:as_ada
select public.create_group('Second Sharing Fam');
reset role;
insert into test.vals select 'ml33_code3', invite_code from public.groups where name = 'Second Sharing Fam';
:as_bea
select public.join_group((select v from test.vals where k = 'ml33_code'));
select public.join_group((select v from test.vals where k = 'ml33_code3'));
select test.expect_eq((select count(*) from public.member_list(:ada)), 3::bigint, 'Bea is back, in both of Ada''s families');
select public.leave_group(:fam);
select test.expect_eq((select count(*) from public.member_list(:ada)), 3::bigint, 'one of them is enough');

reset role;
do $$ begin raise notice 'ALL MEMBER LIST TESTS PASSED'; end $$;
