\set ON_ERROR_STOP 1
-- A title the family watched together also goes on each viewer's My list as Watched, with their score and note, and
-- comes off again when someone says "I wasn't there".
\set as_ida 'reset role; select set_config(''request.jwt.claim.sub'', ''f1f1f1f1-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_jon 'reset role; select set_config(''request.jwt.claim.sub'', ''f2f2f2f2-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_kai 'reset role; select set_config(''request.jwt.claim.sub'', ''f3f3f3f3-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_lou 'reset role; select set_config(''request.jwt.claim.sub'', ''f4f4f4f4-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_max 'reset role; select set_config(''request.jwt.claim.sub'', ''f5f5f5f5-0000-0000-0000-000000000005'', false); set role authenticated;'
\set ida '''f1f1f1f1-0000-0000-0000-000000000001'''
\set jon '''f2f2f2f2-0000-0000-0000-000000000002'''
\set kai '''f3f3f3f3-0000-0000-0000-000000000003'''
\set lou '''f4f4f4f4-0000-0000-0000-000000000004'''
\set max '''f5f5f5f5-0000-0000-0000-000000000005'''
\set fam '(select v::uuid from test.vals where k = ''ml_fam'')'
\set gone '(select v::uuid from test.vals where k = ''ml_gone'')'
\set a '(select v::uuid from test.vals where k = ''ml_a'')'
\set b '(select v::uuid from test.vals where k = ''ml_b'')'
\set c '(select v::uuid from test.vals where k = ''ml_c'')'
\set d '(select v::uuid from test.vals where k = ''ml_d'')'
\set e '(select v::uuid from test.vals where k = ''ml_e'')'
\set g '(select v::uuid from test.vals where k = ''ml_g'')'
\set i '(select v::uuid from test.vals where k = ''ml_i'')'
\set ida_only '[{"user_id":"f1f1f1f1-0000-0000-0000-000000000001","score":null}]'
\set jon_7 '[{"user_id":"f2f2f2f2-0000-0000-0000-000000000002","score":7}]'
\set ida8_jon9_kai '[{"user_id":"f1f1f1f1-0000-0000-0000-000000000001","score":8},{"user_id":"f2f2f2f2-0000-0000-0000-000000000002","score":9},{"user_id":"f3f3f3f3-0000-0000-0000-000000000003","score":null}]'
\set ida_kai8 '[{"user_id":"f1f1f1f1-0000-0000-0000-000000000001","score":null},{"user_id":"f3f3f3f3-0000-0000-0000-000000000003","score":8}]'
\set ida_kai '[{"user_id":"f1f1f1f1-0000-0000-0000-000000000001","score":null},{"user_id":"f3f3f3f3-0000-0000-0000-000000000003","score":null}]'
\set ida_jon_kai '[{"user_id":"f1f1f1f1-0000-0000-0000-000000000001","score":null},{"user_id":"f2f2f2f2-0000-0000-0000-000000000002","score":null},{"user_id":"f3f3f3f3-0000-0000-0000-000000000003","score":null}]'
\set max_only '[{"user_id":"f5f5f5f5-0000-0000-0000-000000000005","score":null}]'

insert into auth.users (id, email, raw_user_meta_data) values
  ('f1f1f1f1-0000-0000-0000-000000000001', 'ida@x.test', '{"full_name":"Ida"}'),
  ('f2f2f2f2-0000-0000-0000-000000000002', 'jon@x.test', '{"full_name":"Jon"}'),
  ('f3f3f3f3-0000-0000-0000-000000000003', 'kai@x.test', '{"full_name":"Kai"}'),
  ('f4f4f4f4-0000-0000-0000-000000000004', 'lou@x.test', '{"full_name":"Lou"}'),
  ('f5f5f5f5-0000-0000-0000-000000000005', 'max@x.test', '{"full_name":"Max"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

-- A person's entry for a movie on their My list (removed ones too), and their score on it.
create function test.mine(p_user uuid, p_tmdb integer) returns public.list_items
language sql stable as $$
  select li.* from public.list_items li join public.media m on m.id = li.media_id
  where li.group_id is null and li.added_by = p_user and m.tmdb_id = p_tmdb;
$$;
create function test.my_rating(p_user uuid, p_tmdb integer) returns public.ratings
language sql stable as $$
  select r.* from public.ratings r where r.user_id = p_user and r.list_item_id = (test.mine(p_user, p_tmdb)).id;
$$;

-- Ida's family has Jon, Kai and Lou; Max has a family of his own.
:as_ida
select public.create_group('MyList Fam');
reset role;
insert into test.vals select 'ml_fam', id::text from public.groups where name = 'MyList Fam';
insert into test.vals select 'ml_code', invite_code from public.groups where name = 'MyList Fam';
:as_jon
select public.join_group((select v from test.vals where k = 'ml_code'));
:as_kai
select public.join_group((select v from test.vals where k = 'ml_code'));
:as_lou
select public.join_group((select v from test.vals where k = 'ml_code'));
:as_max
select public.create_group('Gone Fam');
reset role;
insert into test.vals select 'ml_gone', id::text from public.groups where name = 'Gone Fam';

insert into public.media (tmdb_id, media_type, title) values
  (9951, 'movie', 'List A'), (9952, 'movie', 'List B'), (9953, 'movie', 'List C'), (9954, 'movie', 'List D'),
  (9955, 'movie', 'List E'), (9957, 'movie', 'List G'), (9959, 'movie', 'List I');
:as_ida
insert into public.list_items (group_id, added_by, media_id)
  select :fam, :ida, id from public.media where tmdb_id in (9951, 9952, 9953, 9954, 9955, 9957);
:as_max
insert into public.list_items (group_id, added_by, media_id)
  select :gone, :max, id from public.media where tmdb_id = 9959;
-- Before anything is logged: Jon has B on his To watch, Kai has C watched on his own and D removed from his list.
:as_jon
insert into public.list_items (group_id, added_by, media_id, status)
  select null, :jon, id, 'want' from public.media where tmdb_id = 9952;
:as_kai
insert into public.list_items (group_id, added_by, media_id, status)
  select null, :kai, id, 'watched' from public.media where tmdb_id = 9953;
update public.list_items set watched_at = '2026-01-15 20:00+00'
  where group_id is null and added_by = :kai and media_id = (select id from public.media where tmdb_id = 9953);
insert into public.list_items (group_id, added_by, media_id)
  select null, :kai, id from public.media where tmdb_id = 9954;
update public.list_items set deleted_at = now()
  where group_id is null and added_by = :kai and media_id = (select id from public.media where tmdb_id = 9954);
reset role;
insert into test.vals select 'ml_a', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id is not null and m.tmdb_id = 9951;
insert into test.vals select 'ml_b', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id is not null and m.tmdb_id = 9952;
insert into test.vals select 'ml_c', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id is not null and m.tmdb_id = 9953;
insert into test.vals select 'ml_d', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id is not null and m.tmdb_id = 9954;
insert into test.vals select 'ml_e', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id is not null and m.tmdb_id = 9955;
insert into test.vals select 'ml_g', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id is not null and m.tmdb_id = 9957;
insert into test.vals select 'ml_i', li.id::text from public.list_items li join public.media m on m.id = li.media_id where li.group_id is not null and m.tmdb_id = 9959;
insert into test.vals select 'ml_kai_c_watched_at', (test.mine(:kai::uuid, 9953)).watched_at::text;
insert into test.vals select 'ml_added_events', count(*)::text from public.activity where kind = 'added';

-- ===========================================================================
--  Logging it: Ida, Jon and Kai watched A. Ida gave it an 8 and filled in a 9 for Jon.
-- ===========================================================================
:as_ida
select public.log_watch(:a, current_date - 5, :'ida8_jon9_kai');
reset role;

select test.expect_eq((test.mine(:ida::uuid, 9951)).status, 'watched'::text, 'the title is on Ida''s My list as Watched');
select test.expect_eq((test.mine(:ida::uuid, 9951)).source_item_id, :a, '... remembering the family title it came from');
select test.expect_eq((test.mine(:ida::uuid, 9951)).watch_origin, 'created'::text, '... and that the watch put it there');
select test.expect_eq((test.mine(:ida::uuid, 9951)).watched_at::date, current_date - 5, '... on the day they watched it');
select test.expect_eq((test.mine(:jon::uuid, 9951)).status, 'watched'::text, 'it is on Jon''s list too');
select test.expect_eq((test.mine(:kai::uuid, 9951)).status, 'watched'::text, 'and Kai''s');
select test.expect_eq((select count(*) from public.list_items where group_id is null and added_by = :lou), 0::bigint, 'Lou was not on the log, so he gets nothing');
select test.expect_eq((test.my_rating(:ida::uuid, 9951)).score, 8.0::numeric, 'Ida''s own 8 came along');
select test.expect_eq((test.my_rating(:jon::uuid, 9951)).score, 9.0::numeric, 'so did the 9 filled in for Jon');
select test.expect_eq((test.my_rating(:jon::uuid, 9951)).rated_by, :ida::uuid, '... still marked as filled in by Ida');
select test.expect_eq((test.my_rating(:kai::uuid, 9951)).score, null::numeric, 'Kai had no score, so there is none to copy');
select test.expect_eq((select value from public.reactions where list_item_id = (test.mine(:ida::uuid, 9951)).id and user_id = :ida::uuid), 'like'::text, 'Ida''s 8 likes it on her list as it does on the family''s');
select test.expect_eq((select count(*) from public.reactions where list_item_id = (test.mine(:jon::uuid, 9951)).id), 0::bigint, 'a score filled in for Jon doesn''t like it for him');
select test.expect_eq((select count(*) from public.activity where kind = 'added'), (select v::bigint from test.vals where k = 'ml_added_events'), 'My list entries add nothing to the family feed');

:as_lou
select test.expect_eq((select count(*) from public.list_items where group_id is null), 0::bigint, 'Lou can''t see anyone else''s My list');
select test.expect_eq((select count(*) from public.ratings r join public.list_items li on li.id = r.list_item_id where li.group_id is null), 0::bigint, '... or their scores on it');

-- Jon confirms the 9 and adds a note, the way the popup's Save does; Kai gives a 6.5. Both follow to their My lists.
:as_jon
insert into public.ratings (list_item_id, user_id, score, comment) values (:a, :jon, 9, 'great')
  on conflict (list_item_id, user_id) do update set score = excluded.score, comment = excluded.comment;
:as_kai
insert into public.ratings (list_item_id, user_id, score) values (:a, :kai, 6.5);
reset role;
select test.expect_eq((test.my_rating(:jon::uuid, 9951)).comment, 'great'::text, 'Jon''s note on the family title follows to his My list');
select test.expect_eq((test.my_rating(:jon::uuid, 9951)).rated_by, :jon::uuid, '... and it is his own score now');
select test.expect_eq((select value from public.reactions where list_item_id = (test.mine(:jon::uuid, 9951)).id and user_id = :jon::uuid), 'like'::text, 'taking over the 9 likes it on his list too');
select test.expect_eq((test.my_rating(:kai::uuid, 9951)).score, 6.5::numeric, 'a score Kai gives later reaches his list');

-- What Jon changes on his own list is his: the family's score no longer overwrites it, and it never goes the other way.
:as_jon
update public.ratings set comment = 'for me only'
  where user_id = :jon and list_item_id = (select id from public.list_items where group_id is null and added_by = :jon and source_item_id = :a);
update public.ratings set comment = 'family version two' where user_id = :jon and list_item_id = :a;
reset role;
select test.expect_eq((test.my_rating(:jon::uuid, 9951)).comment, 'for me only'::text, 'a note Jon wrote on his list stays when the family one changes');
select test.expect_eq((select comment from public.ratings where user_id = :jon and list_item_id = :a), 'family version two'::text, 'and what he writes on his list never reaches the family');
:as_jon
delete from public.ratings where user_id = :jon and list_item_id = :a;
reset role;
select test.expect_eq((test.my_rating(:jon::uuid, 9951)).comment, 'for me only'::text, 'taking his score off the family title leaves the one he changed on his list');

-- ===========================================================================
--  "I wasn't there"
-- ===========================================================================
-- Kai says it about A: the entry the watch created is gone.
:as_kai
delete from public.watches where list_item_id = :a and user_id = :kai;
reset role;
select test.expect_eq((select count(*) from public.list_items where group_id is null and added_by = :kai and media_id = (select id from public.media where tmdb_id = 9951)), 0::bigint, 'Kai wasn''t there: A is off his My list');
select test.expect_eq((select status from public.list_items where id = :a), 'watched'::text, 'the family title stays watched together while others are on the record');

-- Jon unmarks A on his own list, then says he wasn't there: it is his now, so it stays, as To watch and unlinked.
:as_jon
update public.list_items set status = 'want', watched_at = null where group_id is null and added_by = :jon and source_item_id = :a;
delete from public.watches where list_item_id = :a and user_id = :jon;
reset role;
select test.expect_eq((test.mine(:jon::uuid, 9951)).status, 'want'::text, 'an entry Jon unmarked himself stays on his list');
select test.expect_eq((test.mine(:jon::uuid, 9951)).source_item_id, null::uuid, '... no longer tied to the family title');

-- Someone logs A again: a later day moves the date, an earlier one doesn't (the record keeps the later day).
:as_ida
select public.log_watch(:a, current_date - 2, :'ida_only');
reset role;
select test.expect_eq((test.mine(:ida::uuid, 9951)).watched_at::date, current_date - 2, 'logged again on a later day, the date on her list follows');
:as_ida
select public.log_watch(:a, current_date - 9, :'ida_only');
reset role;
select test.expect_eq((test.mine(:ida::uuid, 9951)).watched_at::date, current_date - 2, 'an earlier day doesn''t move it back');

-- B was on Jon's To watch: the watch marks it Watched (with the 7 Ida filled in), and "I wasn't there" puts it back.
:as_ida
select public.log_watch(:b, current_date - 4, :'jon_7');
reset role;
select test.expect_eq((test.mine(:jon::uuid, 9952)).status, 'watched'::text, 'a title on Jon''s To watch becomes Watched');
select test.expect_eq((test.mine(:jon::uuid, 9952)).watch_origin, 'converted'::text, '... remembering it was moved');
select test.expect_eq((test.my_rating(:jon::uuid, 9952)).score, 7.0::numeric, '... with the score filled in for him');
:as_jon
delete from public.watches where list_item_id = :b and user_id = :jon;
delete from public.ratings where list_item_id = :b and user_id = :jon and rated_by <> :jon;
reset role;
select test.expect_eq((test.mine(:jon::uuid, 9952)).status, 'want'::text, 'Jon wasn''t there: B is back on his To watch');
select test.expect_eq((test.mine(:jon::uuid, 9952)).watched_at, null::timestamptz, '... with no watched day');
select test.expect_eq((test.mine(:jon::uuid, 9952)).source_item_id, null::uuid, '... and no tie to the family title');
select test.expect_eq((test.my_rating(:jon::uuid, 9952)).id, null::uuid, '... and the score that came with the watch is gone');

-- Kai had C watched on his own: the watch leaves it as it is, and so does leaving the record.
:as_ida
select public.log_watch(:c, current_date - 3, :'ida_kai8');
reset role;
select test.expect_eq((test.mine(:kai::uuid, 9953)).source_item_id, null::uuid, 'something Kai had already watched on his own is left alone');
select test.expect_eq((test.mine(:kai::uuid, 9953)).watched_at::text, (select v from test.vals where k = 'ml_kai_c_watched_at'), '... with the day he gave it');
select test.expect_eq((test.my_rating(:kai::uuid, 9953)).id, null::uuid, '... and no score copied onto it');
select test.expect_eq((test.mine(:ida::uuid, 9953)).watch_origin, 'created'::text, 'Ida, who had nothing, gets hers');
:as_kai
delete from public.watches where list_item_id = :c and user_id = :kai;
reset role;
select test.expect_eq((test.mine(:kai::uuid, 9953)).status, 'watched'::text, 'saying he wasn''t there doesn''t take away what he marked himself');

-- D was removed from Kai's list earlier: the watch brings it back.
:as_ida
select public.log_watch(:d, current_date - 1, :'ida_kai');
reset role;
select test.expect_eq((test.mine(:kai::uuid, 9954)).deleted_at, null::timestamptz, 'a title Kai had removed comes back');
select test.expect_eq((test.mine(:kai::uuid, 9954)).status, 'watched'::text, '... as Watched');
select test.expect_eq((test.mine(:kai::uuid, 9954)).source_item_id, :d, '... tied to the family title again');

-- The last person on the record leaves: the family title goes back to To watch (as before) and her entry goes too.
:as_ida
select public.log_watch(:e, current_date - 1, :'ida_only');
reset role;
select test.expect_eq((test.mine(:ida::uuid, 9955)).status, 'watched'::text, 'E is on Ida''s My list');
:as_ida
delete from public.watches where list_item_id = :e and user_id = :ida;
reset role;
select test.expect_eq((select status from public.list_items where id = :e), 'want'::text, 'nobody left on the record: the family title is back on To watch');
select test.expect_eq((select count(*) from public.list_items where group_id is null and added_by = :ida and media_id = (select id from public.media where tmdb_id = 9955)), 0::bigint, '... and it is off Ida''s My list');

-- ===========================================================================
--  When the family or an account goes away
-- ===========================================================================
-- A family that is deleted takes its titles and watches with it; the entries on My lists stay.
:as_max
select public.log_watch(:i, current_date - 1, :'max_only');
reset role;
select test.expect_eq((test.mine(:max::uuid, 9959)).watch_origin, 'created'::text, 'Max has I on his My list');
delete from public.groups where id = :gone;
select test.expect_eq((test.mine(:max::uuid, 9959)).status, 'watched'::text, 'the family is deleted but the title stays on his My list');
select test.expect_eq((test.mine(:max::uuid, 9959)).source_item_id, null::uuid, '... no longer tied to a family title');

-- An account that is deleted takes its own entries; everyone else's stay.
:as_ida
select public.log_watch(:g, current_date - 1, :'ida_jon_kai');
reset role;
select test.expect_eq((select count(*) from public.watches where list_item_id = :g), 3::bigint, 'three people watched G');
delete from auth.users where id = :kai;
select test.expect_eq((select count(*) from public.list_items where group_id is null and added_by = :kai), 0::bigint, 'Kai''s account is deleted with his My list');
select test.expect_eq((test.mine(:jon::uuid, 9957)).status, 'watched'::text, 'Jon''s entry for G is untouched');
select test.expect_eq((select count(*) from public.watches where list_item_id = :g), 2::bigint, 'and G''s record has the two left');

-- ===========================================================================
--  Who can write what
-- ===========================================================================
:as_jon
select test.expect_error($$update public.list_items set watch_origin = 'created' where group_id is null and added_by = 'f2f2f2f2-0000-0000-0000-000000000002'$$, 'permission denied');
select test.expect_error($$update public.list_items set source_item_id = null where group_id is null and added_by = 'f2f2f2f2-0000-0000-0000-000000000002'$$, 'permission denied');
select test.expect_error($$insert into public.list_items (group_id, added_by, media_id, source_item_id) values (null, 'f2f2f2f2-0000-0000-0000-000000000002', (select id from public.media limit 1), (select id from public.list_items limit 1))$$, 'permission denied');
select test.expect_error($$select public.add_to_my_list_watched('00000000-0000-0000-0000-000000000000', 'f2f2f2f2-0000-0000-0000-000000000002', current_date)$$, 'permission denied');
select test.expect_error($$select public.remove_from_my_list_watched('00000000-0000-0000-0000-000000000000', 'f2f2f2f2-0000-0000-0000-000000000002')$$, 'permission denied');

reset role;
do $$ begin raise notice 'ALL MY LIST WATCH TESTS PASSED'; end $$;
