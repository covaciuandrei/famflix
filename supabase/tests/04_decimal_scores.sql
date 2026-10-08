\set ON_ERROR_STOP 1
\set as_dan    'reset role; select set_config(''request.jwt.claim.sub'', ''dddddddd-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_elena  'reset role; select set_config(''request.jwt.claim.sub'', ''eeeeeeee-0000-0000-0000-000000000005'', false); set role authenticated;'
\set as_anon   'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set item '(select v::uuid from test.vals where k = ''interstellar'')'
\set fam3 '(select v::uuid from test.vals where k = ''fam3'')'

reset role;
select test.expect_eq((select format('%s(%s,%s)', data_type, numeric_precision, numeric_scale) from information_schema.columns
                       where table_schema = 'public' and table_name = 'ratings' and column_name = 'score'), 'numeric(3,1)'::text, 'ratings.score holds one decimal');
select test.expect_eq((select format('%s(%s,%s)', data_type, numeric_precision, numeric_scale) from information_schema.columns
                       where table_schema = 'public' and table_name = 'activity' and column_name = 'score'), 'numeric(3,1)'::text, 'activity.score holds one decimal');
select test.expect_eq((select count(*) from pg_proc where proname = 'add_activity'), 1::bigint, 'one add_activity() left (no ambiguous overload)');
select test.expect_eq((select has_function_privilege('authenticated', 'public.add_activity(uuid,text,uuid,uuid,numeric,text)', 'execute')), false, 'signed-in users still can''t call add_activity()');
select test.expect_eq((select has_function_privilege('anon', 'public.add_activity(uuid,text,uuid,uuid,numeric,text)', 'execute')), false, 'visitors can''t call add_activity()');
select test.expect_eq((select has_function_privilege('authenticated', 'public.log_watch(uuid,date,jsonb)', 'execute')), true, 'log_watch() still callable when signed in');
select test.expect_eq((select has_function_privilege('anon', 'public.log_watch(uuid,date,jsonb)', 'execute')), false, 'log_watch() still closed to visitors');

:as_elena
select test.expect_eq((select score from public.ratings where list_item_id = :item and user_id = 'eeeeeeee-0000-0000-0000-000000000005'), 8.0::numeric, 'existing whole-number score kept (8)');
update public.ratings set score = 6.7, updated_at = now() where list_item_id = :item and user_id = 'eeeeeeee-0000-0000-0000-000000000005';
select test.expect_eq((select score from public.ratings where list_item_id = :item and user_id = 'eeeeeeee-0000-0000-0000-000000000005'), 6.7::numeric, 'Elena changed her score to 6.7');
select test.expect_eq((select score from public.activity where kind = 'rated' and actor_name = 'Elena' order by created_at desc limit 1), 6.7::numeric, 'feed: Elena rated Interstellar 6.7');
update public.ratings set score = 6.75 where list_item_id = :item and user_id = 'eeeeeeee-0000-0000-0000-000000000005';
select test.expect_eq((select score from public.ratings where list_item_id = :item and user_id = 'eeeeeeee-0000-0000-0000-000000000005'), 6.8::numeric, 'a second decimal is rounded (6.75 -> 6.8)');
select test.expect_error($$update public.ratings set score = 10.1 where user_id = 'eeeeeeee-0000-0000-0000-000000000005'$$, 'check constraint');
select test.expect_error($$update public.ratings set score = 0.9 where user_id = 'eeeeeeee-0000-0000-0000-000000000005'$$, 'check constraint');

select public.log_watch(:item, current_date,
  '[{"user_id":"eeeeeeee-0000-0000-0000-000000000005","score":9.9},{"user_id":"dddddddd-0000-0000-0000-000000000004","score":7.25}]'::jsonb);
select test.expect_eq((select score from public.ratings where list_item_id = :item and user_id = 'dddddddd-0000-0000-0000-000000000004'), 7.3::numeric, 'Elena filled in 7.3 for Dan (7.25 rounded)');
select test.expect_eq((select score from public.ratings where list_item_id = :item and user_id = 'eeeeeeee-0000-0000-0000-000000000005'), 6.8::numeric, 'log_watch() never overwrites an existing score');
select test.expect_eq((select score from public.activity where kind = 'rated' and subject_name = 'Dan'), 7.3::numeric, 'feed: Elena rated it 7.3 for Dan');
select test.expect_eq((select detail from public.activity where kind = 'watched_together' and media_title = 'Interstellar'), 'Dan, Elena'::text, 'feed: watched together, with names');
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'interstellar'), current_date,
  '[{"user_id":"dddddddd-0000-0000-0000-000000000004","score":10.5}]'::jsonb)$$, 'between 1 and 10');
select test.expect_error($$select public.log_watch((select v::uuid from test.vals where k = 'interstellar'), current_date,
  '[{"user_id":"dddddddd-0000-0000-0000-000000000004","score":0.5}]'::jsonb)$$, 'between 1 and 10');
select test.expect_error($$select public.add_activity((select v::uuid from test.vals where k = 'fam3'), 'rated', null, null, 9.5, null)$$, 'permission denied');

-- Functions that pass a bare null score still resolve to the new add_activity().
select public.rename_group(:fam3, 'Decimal Club');
select test.expect_eq((select detail from public.activity where kind = 'renamed' and group_id = :fam3), 'Decimal Club'::text, 'feed: renamed (null score argument still works)');

:as_dan
select test.expect_eq((select score from public.ratings where list_item_id = :item and user_id = 'dddddddd-0000-0000-0000-000000000004'), 7.3::numeric, 'Dan sees the 7.3 filled in for him');
update public.ratings set score = 9.4, updated_at = now() where list_item_id = :item and user_id = 'dddddddd-0000-0000-0000-000000000004';
select test.expect_eq((select avg(score) from public.ratings where list_item_id = :item), 8.1::numeric, 'average of 6.8 and 9.4 is 8.1');

:as_anon
select test.expect_error($$select public.add_activity('00000000-0000-0000-0000-000000000000', 'added')$$, 'permission denied');

select 'DECIMAL SCORES: ALL PASSED' as result;
