\set ON_ERROR_STOP 1
\set as_lim  'reset role; select set_config(''request.jwt.claim.sub'', ''81818181-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_liv  'reset role; select set_config(''request.jwt.claim.sub'', ''82828282-0000-0000-0000-000000000002'', false); set role authenticated;'
\set as_lex  'reset role; select set_config(''request.jwt.claim.sub'', ''83838383-0000-0000-0000-000000000003'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set lim '''81818181-0000-0000-0000-000000000001'''
\set liv '''82828282-0000-0000-0000-000000000002'''
\set fam '(select v::uuid from test.vals where k = ''lim_fam'')'
\set item '(select v::uuid from test.vals where k = ''lim_item'')'

-- Lim's Google name is 300 characters long.
insert into auth.users (id, email, raw_user_meta_data) values
  ('81818181-0000-0000-0000-000000000001', 'lim@x.test', jsonb_build_object('full_name', repeat('L', 300))),
  ('82828282-0000-0000-0000-000000000002', 'liv@x.test', '{"full_name":"Liv"}'),
  ('83838383-0000-0000-0000-000000000003', 'lex@x.test', '{"full_name":"Lex"}');
create table if not exists test.vals (k text primary key, v text not null);
grant select on test.vals to anon, authenticated;

-- ---- At most 250 characters for names and notes ------------------------------------------------
select test.expect_eq((select char_length(display_name) from public.profiles where id = :lim), 250, 'a longer name from Google is cut to 250 characters');

:as_lim
update public.profiles set display_name = repeat('a', 250) where id = :lim;
select test.expect_eq((select char_length(display_name) from public.profiles where id = :lim), 250, 'a 250-character name is allowed');
select test.expect_error($$update public.profiles set display_name = repeat('a', 251) where id = '81818181-0000-0000-0000-000000000001'$$, 'violates check constraint');
update public.profiles set display_name = 'Lim' where id = :lim;

select test.expect_error($$select public.create_group(repeat('f', 251))$$, 'at most 250 characters');
select public.create_group('Limits Fam');
reset role;
insert into test.vals select 'lim_fam', id::text from public.groups where name = 'Limits Fam';
insert into test.vals select 'lim_code', invite_code from public.groups where name = 'Limits Fam';
:as_lim
select test.expect_error($$select public.rename_group((select v::uuid from test.vals where k = 'lim_fam'), repeat('f', 251))$$, 'at most 250 characters');
select public.rename_group(:fam, repeat('f', 250));
select test.expect_eq((select char_length(name) from public.groups where id = :fam), 250, 'a 250-character family name is allowed');

reset role;
insert into public.media (tmdb_id, media_type, title) values (9401, 'movie', 'Limit A');
:as_lim
insert into public.list_items (group_id, added_by, media_id, status)
  select null, :lim, id, 'want' from public.media where tmdb_id = 9401;
reset role;
insert into test.vals select 'lim_item', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 9401;
:as_lim
select test.expect_error($$insert into public.ratings (list_item_id, user_id, comment) values ((select v::uuid from test.vals where k = 'lim_item'), '81818181-0000-0000-0000-000000000001', repeat('n', 251))$$, 'violates check constraint');
insert into public.ratings (list_item_id, user_id, comment) values (:item, :lim, repeat('n', 250));
select test.expect_eq((select char_length(comment) from public.ratings where list_item_id = :item), 250, 'a 250-character note is allowed');
update public.ratings set comment = repeat('🎬', 250) where list_item_id = :item;
select test.expect_eq((select char_length(comment) from public.ratings where list_item_id = :item), 250, 'emoji count as one character each');

-- ---- Guessing invite codes: 10 tries per 10 minutes --------------------------------------------
:as_liv
do $$ begin for i in 1..9 loop perform public.join_group('WRONG' || i); end loop; end $$;
select test.expect_eq(public.join_group('WRONG10'), null::uuid, 'a wrong code returns nothing (and counts as a try)');
select test.expect_error($$select public.join_group((select v from test.vals where k = 'lim_code'))$$, 'too often');
select test.expect_eq(public.is_group_member(:fam, :liv), false, 'after 10 tries even the right code is refused for a while');
:as_lex
select test.expect_eq(public.join_group((select v from test.vals where k = 'lim_code')), (select v::uuid from test.vals where k = 'lim_fam'), 'someone else can still join with the right code');
-- 10 minutes later
reset role;
update public.rate_limits set window_start = window_start - interval '10 minutes' where user_id = :liv;
:as_liv
select test.expect_eq(public.join_group((select v from test.vals where k = 'lim_code')), (select v::uuid from test.vals where k = 'lim_fam'), 'ten minutes later the right code works again');

-- ---- At most 10 new families an hour ----------------------------------------------------------
:as_lex
do $$ begin for i in 1..10 loop perform public.create_group('Lex family ' || i); end loop; end $$;
select test.expect_error($$select public.create_group('Lex family 11')$$, 'too often');
reset role;
select test.expect_eq((select count(*) from public.groups where name like 'Lex family %'), 10::bigint, 'the 11th family in an hour was not created');

-- ---- Nobody reaches the counters through the API ----------------------------------------------
:as_lim
select test.expect_error($$select * from public.rate_limits$$, 'permission denied');
select test.expect_error($$select public.hit_rate_limit('81818181-0000-0000-0000-000000000001', 'x', 1, 60)$$, 'permission denied');
:as_anon
select test.expect_error($$select public.hit_rate_limit('81818181-0000-0000-0000-000000000001', 'x', 1, 60)$$, 'permission denied');

-- Counters older than a day are cleaned up the next time that person does something.
reset role;
insert into public.rate_limits (user_id, action, window_start, hits) values (:liv, 'join_group', now() - interval '2 days', 3);
:as_liv
select public.join_group('WRONG-AGAIN');
reset role;
select test.expect_eq((select count(*) from public.rate_limits where user_id = :liv and window_start < now() - interval '1 day'), 0::bigint, 'counters older than a day are removed');

-- ---- A family's feed keeps its latest 500 events ----------------------------------------------
:as_lim
do $$ begin
  for i in 1..505 loop
    perform public.rename_group((select v::uuid from test.vals where k = 'lim_fam'), 'Round ' || i);
  end loop;
end $$;
select test.expect_eq((select count(*) from public.activity where group_id = :fam), 500::bigint, 'the feed keeps 500 events');
select test.expect_eq((select detail from public.activity where group_id = :fam order by created_at desc limit 1), 'Round 505'::text, 'the newest event is kept');
select test.expect_eq((select count(*) from public.activity where group_id = :fam and kind = 'created'), 0::bigint, 'the oldest events are dropped');

reset role;
do $$ begin raise notice 'ALL LIMITS TESTS PASSED'; end $$;
