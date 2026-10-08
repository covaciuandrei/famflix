\set ON_ERROR_STOP 1
\set as_dan    'reset role; select set_config(''request.jwt.claim.sub'', ''dddddddd-0000-0000-0000-000000000004'', false); set role authenticated;'
\set as_elena  'reset role; select set_config(''request.jwt.claim.sub'', ''eeeeeeee-0000-0000-0000-000000000005'', false); set role authenticated;'
\set item '(select v::uuid from test.vals where k = ''interstellar'')'
\set elena '''eeeeeeee-0000-0000-0000-000000000005'''
\set dan '''dddddddd-0000-0000-0000-000000000004'''
-- Continues from 04_decimal_scores.sql: Fam3 (Elena + Dan) has Interstellar; Elena 6.8, Dan 9.4.

:as_elena
-- 6.8 -> 7.5: over 7 likes it
update public.ratings set score = 7.5 where list_item_id = :item and user_id = :elena;
select test.expect_eq((select value from public.reactions where list_item_id = :item and user_id = :elena), 'like'::text, 'over 7: Elena now likes it');
-- 7.5 -> 6.5: the 6-7 band leaves the reaction alone
update public.ratings set score = 6.5 where list_item_id = :item and user_id = :elena;
select test.expect_eq((select value from public.reactions where list_item_id = :item and user_id = :elena), 'like'::text, '6-7: reaction unchanged');
-- exactly 7 and exactly 6 are inside the band
update public.ratings set score = 7 where list_item_id = :item and user_id = :elena;
update public.ratings set score = 6 where list_item_id = :item and user_id = :elena;
select test.expect_eq((select value from public.reactions where list_item_id = :item and user_id = :elena), 'like'::text, 'exactly 7 and exactly 6: unchanged');
-- 5.9: under 6 dislikes it
update public.ratings set score = 5.9 where list_item_id = :item and user_id = :elena;
select test.expect_eq((select value from public.reactions where list_item_id = :item and user_id = :elena), 'dislike'::text, 'under 6: Elena now dislikes it');
-- a reaction picked by hand survives editing just the note
update public.reactions set value = 'like' where list_item_id = :item and user_id = :elena;
update public.ratings set comment = 'changed my mind', score = 5.9 where list_item_id = :item and user_id = :elena;
select test.expect_eq((select value from public.reactions where list_item_id = :item and user_id = :elena), 'like'::text, 'same score, new note: manual reaction kept');
-- only one reaction row per person and title
select test.expect_eq((select count(*) from public.reactions where list_item_id = :item and user_id = :elena), 1::bigint, 'one reaction row');
-- removing the score (note only) leaves the reaction alone
update public.ratings set score = null where list_item_id = :item and user_id = :elena;
select test.expect_eq((select value from public.reactions where list_item_id = :item and user_id = :elena), 'like'::text, 'clearing the score: reaction unchanged');

-- a new title: Elena fills in a score for Dan and her own via "watched together"
reset role; insert into public.media (tmdb_id, media_type, title) values (27205, 'movie', 'Inception'); set role authenticated;
insert into public.list_items (group_id, added_by, media_id)
  select (select v::uuid from test.vals where k = 'fam3'), :elena, id from public.media where tmdb_id = 27205;
reset role;
insert into test.vals select 'inception', li.id::text from public.list_items li join public.media m on m.id = li.media_id where m.tmdb_id = 27205;
:as_elena
select public.log_watch((select v::uuid from test.vals where k = 'inception'), current_date,
  '[{"user_id":"eeeeeeee-0000-0000-0000-000000000005","score":9.1},{"user_id":"dddddddd-0000-0000-0000-000000000004","score":3.2}]'::jsonb);
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'inception') and user_id = :elena), 'like'::text, 'own score via watched together (9.1): liked');
select test.expect_eq((select count(*) from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'inception') and user_id = :dan), 0::bigint, 'score filled in for Dan (3.2): no reaction set for him');

:as_dan
-- Dan confirms the filled-in score: it becomes his own, so his 3.2 dislikes it like any score he gives
update public.ratings set score = 3.2, comment = 'yep' where list_item_id = (select v::uuid from test.vals where k = 'inception') and user_id = :dan;
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'inception') and user_id = :dan), 'dislike'::text, 'Dan confirms the filled-in 3.2: disliked');
-- Dan changes it himself
update public.ratings set score = 2.5 where list_item_id = (select v::uuid from test.vals where k = 'inception') and user_id = :dan;
select test.expect_eq((select value from public.reactions where list_item_id = (select v::uuid from test.vals where k = 'inception') and user_id = :dan), 'dislike'::text, 'Dan lowers his own score to 2.5: disliked');
-- a brand-new rating (insert) over 7
delete from public.ratings where list_item_id = :item and user_id = :dan;
delete from public.reactions where list_item_id = :item and user_id = :dan;
insert into public.ratings (list_item_id, user_id, score) values (:item, :dan, 8.2);
select test.expect_eq((select value from public.reactions where list_item_id = :item and user_id = :dan), 'like'::text, 'new rating 8.2: liked');

select 'SCORE REACTIONS: ALL PASSED' as result;
