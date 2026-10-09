\set ON_ERROR_STOP 1
-- Leaving a title's watch record ("I wasn't there", or deleting an account): the title stays watched together while
-- anyone is still on the record, and goes back to To watch (Watched unmarked) when the last person leaves.
\set as_uma 'reset role; select set_config(''request.jwt.claim.sub'', ''b1b1b1b1-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_vic 'reset role; select set_config(''request.jwt.claim.sub'', ''b2b2b2b2-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_wes 'reset role; select set_config(''request.jwt.claim.sub'', ''b3b3b3b3-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_xan 'reset role; select set_config(''request.jwt.claim.sub'', ''b4b4b4b4-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_auth_server 'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
\set uma '''b1b1b1b1-0000-0000-0000-000000000001'''
\set vic '''b2b2b2b2-0000-0000-0000-000000000002'''
\set wes '''b3b3b3b3-0000-0000-0000-000000000003'''
\set xan '''b4b4b4b4-0000-0000-0000-000000000004'''
\set fam '(select v::uuid from test.vals where k = ''lw_fam'')'
\set solo '(select v::uuid from test.vals where k = ''lw_solo'')'
\set a '(select v::uuid from test.vals where k = ''lw_a'')'
\set b '(select v::uuid from test.vals where k = ''lw_b'')'
\set c '(select v::uuid from test.vals where k = ''lw_c'')'
\set d '(select v::uuid from test.vals where k = ''lw_d'')'
\set e '(select v::uuid from test.vals where k = ''lw_e'')'
\set f '(select v::uuid from test.vals where k = ''lw_f'')'
\set s '(select v::uuid from test.vals where k = ''lw_s'')'
\set just_vic '[{"user_id":"b2b2b2b2-0000-0000-0000-000000000002","score":null}]'
\set just_wes '[{"user_id":"b3b3b3b3-0000-0000-0000-000000000003","score":null}]'
\set uma_and_vic '[{"user_id":"b1b1b1b1-0000-0000-0000-000000000001","score":null},{"user_id":"b2b2b2b2-0000-0000-0000-000000000002","score":null}]'
\set uma_and_wes '[{"user_id":"b1b1b1b1-0000-0000-0000-000000000001","score":null},{"user_id":"b3b3b3b3-0000-0000-0000-000000000003","score":null}]'

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1b1b1b1-0000-0000-0000-000000000001', 'uma@x.test', '{"full_name":"Uma"}'),
  ('b2b2b2b2-0000-0000-0000-000000000002', 'vic@x.test', '{"full_name":"Vic"}'),
  ('b3b3b3b3-0000-0000-0000-000000000003', 'wes@x.test', '{"full_name":"Wes"}'),
  ('b4b4b4b4-0000-0000-0000-000000000004', 'xan@x.test', '{"full_name":"Xan"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

-- Uma's family has Vic and Wes in it; Xan has a family of his own.
:as_uma
select public.create_group('Leave Fam');
reset role;
insert into test.vals select 'lw_fam', id::text from public.groups where name = 'Leave Fam';
insert into test.vals select 'lw_code', invite_code from public.groups where name = 'Leave Fam';
:as_vic
select public.join_group((select v from test.vals where k = 'lw_code'));
:as_wes
select public.join_group((select v from test.vals where k = 'lw_code'));
:as_xan
select public.create_group('Xan Solo');
reset role;
insert into test.vals select 'lw_solo', id::text from public.groups where name = 'Xan Solo';

insert into public.media (tmdb_id, media_type, title) values
  (9601, 'movie', 'Leave A'), (9602, 'movie', 'Leave B'), (9603, 'movie', 'Leave C'),
  (9604, 'movie', 'Leave D'), (9605, 'movie', 'Leave E'), (9606, 'movie', 'Leave F'), (9607, 'movie', 'Leave S');
:as_uma
insert into public.list_items (group_id, added_by, media_id)
  select :fam, :uma, id from public.media where tmdb_id between 9601 and 9606;
:as_xan
insert into public.list_items (group_id, added_by, media_id)
  select :solo, :xan, id from public.media where tmdb_id = 9607;
reset role;
-- lw_a .. lw_f for Leave A .. Leave F, lw_s for Xan's title.
insert into test.vals
  select 'lw_' || case when m.tmdb_id = 9607 then 's' else chr(97 + (m.tmdb_id - 9601)::int) end, li.id::text
  from public.list_items li join public.media m on m.id = li.media_id
  where m.tmdb_id between 9601 and 9607;

-- A: Uma logs herself and Vic. Vic says "I wasn't there", but Uma was, so it stays watched together.
:as_uma
select public.log_watch(:a, current_date, :'uma_and_vic'::jsonb);
:as_vic
delete from public.watches where list_item_id = :a and user_id = :vic;
reset role;
select test.expect_eq((select status from public.list_items where id = :a), 'watched'::text, 'someone else was there: it stays watched');
select test.expect_eq((select count(*) from public.watches where list_item_id = :a), 1::bigint, 'with Uma still on the record');
-- Then Uma says it too: nobody is left, so it goes back to To watch and its watched date goes.
:as_uma
delete from public.watches where list_item_id = :a and user_id = :uma;
reset role;
select test.expect_eq((select status from public.list_items where id = :a), 'want'::text, 'the last person leaves: back to To watch');
select test.expect_eq((select watched_at from public.list_items where id = :a), null::timestamptz, 'and it has no watched date');

-- B: Uma logs only Vic (she wasn't there herself). Vic says "I wasn't there": nobody watched it.
:as_uma
select public.log_watch(:b, current_date, :'just_vic'::jsonb);
reset role;
select test.expect_eq((select status from public.list_items where id = :b), 'watched'::text, 'logging Vic marks it watched');
:as_vic
delete from public.watches where list_item_id = :b and user_id = :vic;
reset role;
select test.expect_eq((select status from public.list_items where id = :b), 'want'::text, 'he was the only one: back to To watch');
-- Logging it again marks it watched again.
:as_uma
select public.log_watch(:b, current_date, :'uma_and_vic'::jsonb);
reset role;
select test.expect_eq((select status from public.list_items where id = :b), 'watched'::text, 'logging it again marks it watched again');
select test.expect_eq((select watched_at is not null from public.list_items where id = :b), true, 'with a watched date');

-- C: Watched was already unmarked (Wes took it off), so Vic leaving changes nothing more.
:as_uma
select public.log_watch(:c, current_date, :'just_vic'::jsonb);
:as_wes
update public.list_items set status = 'want', watched_at = null where id = :c;
:as_vic
delete from public.watches where list_item_id = :c and user_id = :vic;
reset role;
select test.expect_eq((select status from public.list_items where id = :c), 'want'::text, 'already unmarked: still To watch');

-- D: Skipping the rating request isn't leaving: Vic is still on the record.
:as_uma
select public.log_watch(:d, current_date, :'just_vic'::jsonb);
:as_vic
update public.watches set skipped_at = now() where list_item_id = :d and user_id = :vic;
reset role;
select test.expect_eq((select status from public.list_items where id = :d), 'watched'::text, 'skipping the request keeps it watched');
select test.expect_eq((select count(*) from public.watches where list_item_id = :d), 1::bigint, 'and Vic is still on the record');

-- E: The only person on a record deletes their account, which is the same as leaving it. F: Uma is on it too.
:as_uma
select public.log_watch(:e, current_date, :'just_wes'::jsonb);
select public.log_watch(:f, current_date, :'uma_and_wes'::jsonb);
:as_auth_server
delete from auth.users where id = :wes;
select test.expect_eq((select status from public.list_items where id = :e), 'want'::text, 'its only viewer deleted their account: back to To watch');
select test.expect_eq((select status from public.list_items where id = :f), 'watched'::text, 'someone else was there: it stays watched');
select test.expect_eq((select count(*) from public.watches where list_item_id = :f), 1::bigint, 'with Uma on the record');

-- S: A family that goes with its last member takes its watch records along without trouble.
:as_xan
select public.log_watch(:s, current_date, '[{"user_id":"b4b4b4b4-0000-0000-0000-000000000004","score":null}]'::jsonb);
:as_auth_server
delete from auth.users where id = :xan;
select test.expect_eq((select count(*) from public.groups where id = :solo), 0::bigint, 'Xan''s family went with him');
select test.expect_eq((select count(*) from public.watches where list_item_id = :s), 0::bigint, 'and its watch records');

reset role;
do $$ begin raise notice 'ALL LEAVING-A-WATCH TESTS PASSED'; end $$;
