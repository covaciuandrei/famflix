\set ON_ERROR_STOP 1
select test.expect_eq((select count(*) from auth.users), (select users from test.upgrade_snapshot), 'upgrade preserves accounts');
select test.expect_eq((select count(*) from public.list_items), (select items from test.upgrade_snapshot), 'upgrade preserves family and personal list entries');
select test.expect_eq((select count(*) from public.ratings), (select ratings from test.upgrade_snapshot), 'upgrade preserves scores and notes');
select test.expect_eq((select count(*) from public.reactions), (select reactions from test.upgrade_snapshot), 'upgrade preserves reactions');
select test.expect_eq((select count(*) from public.watches), (select watches from test.upgrade_snapshot), 'upgrade preserves current attendance');
select test.expect_eq((select count(*) from public.watch_history), (select history from test.upgrade_snapshot), 'upgrade preserves archived watch records without duplicate copies');
select test.expect_eq((select count(*) from public.movie_nights), (select nights from test.upgrade_snapshot), 'upgrade preserves movie-night history');
select test.expect_eq((select jsonb_agg(to_jsonb(v) order by guest_id, candidate_id) from public.movie_night_guest_votes v),
 (select votes from test.upgrade_snapshot), 'upgrade preserves every historical guest vote unchanged');
select test.expect_eq((select count(*) from public.family_viewings), 3::bigint, 'upgrade establishes one identity for each viewing');
select test.expect_eq((select count(*) from public.family_viewing_members), 5::bigint, 'upgrade backfills exact per-viewing members');
select test.expect_eq((select count(*) from public.family_guests), 2::bigint, 'equal legacy names remain separate identities for family review');
select test.expect_eq((select count(*) from public.family_viewing_guests), 2::bigint, 'legacy guest attendance is retained');
select test.expect_eq((select count(*) from public.watches where viewing_id is null), 0::bigint, 'all current watches have a stable viewing');
select test.expect_eq((select count(*) from public.watch_history where viewing_id is null), 0::bigint, 'historical family watches are linked');
select test.expect_eq((select position('for no key update' in prosrc) > 0 from pg_proc
  where oid = 'public.join_group(text)'::regprocedure), true, 'upgrade restores the prior family admission guard');
select test.expect_eq((select position('for no key update' in prosrc) > 0
  and position('for no key update' in prosrc) < position('insert into public.group_members' in prosrc)
  from pg_proc where oid = 'public.claim_family_guest(text)'::regprocedure), true, 'guest account admission uses the same family revocation lock');
