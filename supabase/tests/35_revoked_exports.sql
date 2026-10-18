\set ON_ERROR_STOP 1
-- Former members retain their own contributions, not later changes to shared family state.
select gen_random_uuid() as rev_owner, gen_random_uuid() as rev_member \gset
insert into auth.users(id, email, raw_user_meta_data) values
  (:'rev_owner', :'rev_owner' || '@security.test', '{"full_name":"Export owner"}'),
  (:'rev_member', :'rev_member' || '@security.test', '{"full_name":"Export member"}');
insert into public.media(tmdb_id, media_type, title)
  select 900000100 + i, 'movie', 'Revoked export title ' || i from generate_series(1, 9) i;
select id as rev_movie from public.media where tmdb_id = 900000109 \gset
select jsonb_agg(jsonb_build_object('media_id', id, 'origin', 'suggested') order by tmdb_id) as rev_cards
  from public.media where tmdb_id between 900000101 and 900000108 \gset

select set_config('request.jwt.claim.sub', :'rev_owner', false);
set role authenticated;
select (public.create_group('Export membership')).id as rev_family \gset
select invite_code as rev_code from public.groups where id = :'rev_family' \gset
reset role;
select set_config('request.jwt.claim.sub', :'rev_member', false);
set role authenticated;
select public.join_group(:'rev_code');
insert into public.list_items(group_id, added_by, media_id)
  values (:'rev_family', :'rev_member', :'rev_movie') returning id as rev_item \gset
insert into public.ratings(list_item_id, user_id, score, comment)
  values (:'rev_item', :'rev_member', 8.5, 'MY-RETAINED-NOTE');
select public.start_movie_night(:'rev_family', '{}', '{}', :'rev_cards') as rev_night \gset
select public.plan_movie_night(:'rev_family', now() + interval '2 days', 'MY-PLANNING-NOTE', array['comedy']) as rev_plan \gset
select public.export_my_data() as rev_before \gset
select test.expect_eq((:'rev_before'::jsonb -> 'family_lists' -> 0 -> 'titles' -> 0 ->> 'status'),
  'want'::text, 'current members see their contributed title status');

reset role;
select set_config('request.jwt.claim.sub', :'rev_owner', false);
set role authenticated;
select public.remove_member(:'rev_family', :'rev_member');
select public.rename_group(:'rev_family', 'NEW-FAMILY-NAME-AFTER-DEPARTURE');
select public.pick_movie_night_title(:'rev_night', :'rev_movie', current_date,
  jsonb_build_array(jsonb_build_object('user_id', :'rev_owner', 'score', null)));
update public.list_items set deleted_at = now() where id = :'rev_item';
select public.cancel_movie_night_plan(:'rev_plan');
select invite_code as rev_fresh_code from public.groups where id = :'rev_family' \gset
select public.export_my_data() as rev_owner_export \gset
select test.expect_eq((:'rev_owner_export'::jsonb -> 'movie_nights' -> 0 ->> 'picked_title'),
  'Revoked export title 9'::text, 'the current member still sees the chosen title');
select test.expect_eq((:'rev_owner_export'::jsonb -> 'movie_nights' -> 0 ->> 'status'),
  'closed'::text, 'current members still see the night outcome');

reset role;
select set_config('request.jwt.claim.sub', :'rev_member', false);
set role authenticated;
select public.export_my_data() as rev_after \gset
select test.expect_eq((select count(*) from public.movie_nights where id = :'rev_night'), 0::bigint,
  'a removed member cannot read the night directly');
select test.expect_eq(jsonb_array_length(:'rev_after'::jsonb -> 'families'), 0,
  'the departed family is no longer a membership');
select test.expect_eq(position('NEW-FAMILY-NAME-AFTER-DEPARTURE' in :'rev_after'), 0,
  'no export section reveals a family name changed after departure');
select test.expect_eq((:'rev_after'::jsonb -> 'family_lists' -> 0 ->> 'still_a_member')::boolean, false,
  'retained contributions are marked as a former membership');
select test.expect_eq(:'rev_after'::jsonb -> 'family_lists' -> 0 -> 'titles' -> 0 ->> 'status', null::text,
  'subsequent shared title status is withheld');
select test.expect_eq(:'rev_after'::jsonb -> 'family_lists' -> 0 -> 'titles' -> 0 ->> 'removed_at', null::text,
  'subsequent shared title removal time is withheld');
select test.expect_eq(:'rev_after'::jsonb -> 'family_lists' -> 0 -> 'titles' -> 0 ->> 'my_note',
  'MY-RETAINED-NOTE'::text, 'the caller keeps their own note');
select test.expect_eq((:'rev_after'::jsonb -> 'family_lists' -> 0 -> 'titles' -> 0 ->> 'my_score')::numeric,
  8.5::numeric, 'the caller keeps their own score');
select test.expect_eq(jsonb_array_length(:'rev_after'::jsonb -> 'movie_nights'), 1,
  'the caller keeps the night creation record');
select test.expect_eq((:'rev_after'::jsonb -> 'movie_nights' -> 0 ->> 'started_by_me')::boolean, true,
  'their authorship remains recorded');
select test.expect_eq(:'rev_after'::jsonb -> 'movie_nights' -> 0 ->> 'picked_title', null::text,
  'a later title chosen without them is withheld');
select test.expect_eq(:'rev_after'::jsonb -> 'movie_nights' -> 0 ->> 'happened_on', null::text,
  'the later family viewing day is withheld');
select test.expect_eq(:'rev_after'::jsonb -> 'movie_nights' -> 0 ->> 'status', null::text,
  'the later night outcome is withheld');
select test.expect_eq(:'rev_after'::jsonb -> 'movie_night_plans' -> 0 ->> 'status', null::text,
  'the later plan cancellation is withheld');
select test.expect_eq(:'rev_after'::jsonb -> 'movie_night_plans' -> 0 ->> 'note',
  'MY-PLANNING-NOTE'::text, 'the caller keeps their planning note');
select test.expect_eq(:'rev_after'::jsonb -> 'movie_night_plans' -> 0 -> 'mood', '["comedy"]'::jsonb,
  'the caller keeps the mood they planned');
select test.expect_eq(:'rev_after'::jsonb -> 'movie_night_plans' -> 0 ->> 'starts_at' is not null, true,
  'the caller keeps the scheduled time they chose');

select public.join_group(:'rev_fresh_code');
select public.export_my_data() as rev_rejoined \gset
select test.expect_eq(:'rev_rejoined'::jsonb -> 'movie_nights' -> 0 ->> 'status', 'closed'::text,
  'rejoining with a valid new invitation restores current family visibility');
select test.expect_eq(:'rev_rejoined'::jsonb -> 'movie_night_plans' -> 0 ->> 'status', 'cancelled'::text,
  'a rejoined member sees current plan status');
select public.leave_group(:'rev_family');
select public.export_my_data() as rev_left \gset
select test.expect_eq(:'rev_left'::jsonb -> 'movie_nights' -> 0 ->> 'status', null::text,
  'voluntary departure applies the same privacy boundary');
reset role;
