\set ON_ERROR_STOP 1
-- media.series: a series' seasons and how far it has aired, saved by the server next to the rest of its movie info. It
-- is json of a particular shape, only a series has it, and nobody signed in can write it. Titles are called SI<tmdb id>.
\set as_zed  'reset role; select set_config(''request.jwt.claim.sub'', ''2a2a2a2a-0000-0000-0000-000000000001'', false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

insert into auth.users (id, email, raw_user_meta_data) values
  ('2a2a2a2a-0000-0000-0000-000000000001', 'zed23@x.test', '{"full_name":"Zed"}');

-- What the server saves for a series, and for a series or a movie that has none.
insert into public.media (tmdb_id, media_type, title, series) values
  (8901, 'tv', 'SI9601',
   '{"status": "Ended", "seasons": [{"n": 1, "episodes": 5}], "last_aired": {"s": 1, "e": 5}, "next_air": null}'),
  (8902, 'tv', 'SI9602', null),
  (8903, 'movie', 'SI9603', null);
select test.expect_eq((select series -> 'seasons' -> 0 ->> 'episodes' from public.media where tmdb_id = 8901), '5'::text,
  'a series keeps its seasons');
select test.expect_eq((select series is null from public.media where tmdb_id = 8902), true, 'a series saved before there was series info has none');

-- Refused: a movie with series info, and json that isn't an object with a list of seasons.
select test.expect_error($$insert into public.media (tmdb_id, media_type, title, series)
  values (8904, 'movie', 'SI9604', '{"seasons": []}')$$, 'media_series_shape');
select test.expect_error($$insert into public.media (tmdb_id, media_type, title, series)
  values (8905, 'tv', 'SI9605', '[]')$$, 'media_series_shape');
select test.expect_error($$insert into public.media (tmdb_id, media_type, title, series)
  values (8906, 'tv', 'SI9606', '"Ended"')$$, 'media_series_shape');
select test.expect_error($$insert into public.media (tmdb_id, media_type, title, series)
  values (8907, 'tv', 'SI9607', '{"status": "Ended"}')$$, 'media_series_shape');
select test.expect_error($$insert into public.media (tmdb_id, media_type, title, series)
  values (8908, 'tv', 'SI9608', '{"seasons": {"n": 1}}')$$, 'media_series_shape');
select test.expect_error($$update public.media set series = '{"seasons": []}' where tmdb_id = 8903$$, 'media_series_shape');

-- Signed-in people read it (it comes with the title) but can't write it; visitors can't read it.
:as_zed
select test.expect_eq((select series ->> 'status' from public.media where tmdb_id = 8901), 'Ended'::text, 'signed-in people can read it');
select test.expect_error($$update public.media set series = '{"seasons": []}' where tmdb_id = 8901$$, 'permission denied');
select test.expect_error($$update public.media set series = null where tmdb_id = 8901$$, 'permission denied');
select test.expect_error($$insert into public.media (tmdb_id, media_type, title, series) values (8909, 'tv', 'SI9609', '{"seasons": []}')$$,
  'permission denied');
:as_anon
select test.expect_error($$select series from public.media$$, 'permission denied');
