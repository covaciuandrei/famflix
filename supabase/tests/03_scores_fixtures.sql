\set ON_ERROR_STOP 1
\set as_dan    'reset role; select set_config(''request.jwt.claim.sub'', ''dddddddd-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_elena  'reset role; select set_config(''request.jwt.claim.sub'', ''eeeeeeee-0000-0000-0000-000000000005'', false); set role authenticated;'
-- Fixtures for 04 and 05: Dan joins Elena's Fam3; Elena adds Interstellar and gives it a whole-number 8.
reset role;
insert into test.vals select 'fam3', id::text from public.groups where name = 'Fam3';
insert into test.vals select 'fam3_code', invite_code from public.groups where name = 'Fam3';
:as_dan
select public.join_group((select v from test.vals where k = 'fam3_code'));
:as_elena
reset role; insert into public.media (tmdb_id, media_type, title) values (157336, 'movie', 'Interstellar'); set role authenticated;
insert into public.list_items (group_id, added_by, media_id)
  select (select v::uuid from test.vals where k = 'fam3'), 'eeeeeeee-0000-0000-0000-000000000005', id
  from public.media where tmdb_id = 157336;
reset role;
insert into test.vals select 'interstellar', li.id::text from public.list_items li
  join public.media m on m.id = li.media_id where m.tmdb_id = 157336;
:as_elena
insert into public.ratings (list_item_id, user_id, score)
  values ((select v::uuid from test.vals where k = 'interstellar'), 'eeeeeeee-0000-0000-0000-000000000005', 8);
select 'SCORE FIXTURES READY' as result;
