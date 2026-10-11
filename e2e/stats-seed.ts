import { admin, type TestUser } from "./helpers";

// A family with a history that is known to the day, built straight in the test database (through the app it would take
// hours and could only be dated today). What the stats screens are worked out from, and what the tests check them against.

export interface SeedTitle {
  name: string;
  type: "movie" | "tv";
  /** Minutes: a movie's length, or an episode's. */
  runtime: number;
  genres: string[];
  /** The viewing the list shows now: the day, and who was there. */
  current?: { on: string; who: string[] };
  /** Viewings kept in the history. */
  earlier?: { on: string; who: string[] }[];
  /** Each person's score, by name. */
  scores?: Record<string, number>;
  /** Who likes it, by name. */
  likes?: string[];
  /** Taken off the list afterwards. */
  removed?: boolean;
}

function ok<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Seeding ${what}: ${result.error.message}`);
  return result.data as T;
}

/** Puts titles on a family's list with their viewings, scores and likes; returns each title's media id by name. */
export async function seedTitles(
  group: string,
  addedBy: string,
  people: Record<string, string>,
  titles: SeedTitle[],
): Promise<Record<string, string>> {
  const id = (name: string) => {
    const found = people[name];
    if (!found) throw new Error(`Seeding: ${name} is not one of the people`);
    return found;
  };
  // Titles are told apart by their TMDB id, which has to be new every time: the same database serves every test.
  const base = 200_000_000 + (Date.now() % 10_000_000) * 10;
  const media = ok(
    await admin
      .from("media")
      .insert(
        titles.map((t, i) => ({
          tmdb_id: base + i,
          media_type: t.type,
          title: t.name,
          runtime: t.runtime,
          genres: t.genres,
        })),
      )
      .select("id, title"),
    "titles",
  );
  const mediaId = Object.fromEntries(media.map((m) => [m.title as string, m.id as string]));

  const items = ok(
    await admin
      .from("list_items")
      .insert(
        titles.map((t) => ({
          group_id: group,
          added_by: addedBy,
          media_id: mediaId[t.name],
          status: t.current ? "watched" : "want",
          watched_at: t.current ? `${t.current.on}T12:00:00Z` : null,
        })),
      )
      .select("id, media_id"),
    "list items",
  );
  const itemId = Object.fromEntries(items.map((i) => [i.media_id as string, i.id as string]));

  const watches = titles.flatMap((t) =>
    (t.current?.who ?? []).map((name) => ({
      list_item_id: itemId[mediaId[t.name]],
      user_id: id(name),
      watched_on: t.current!.on,
      logged_by: addedBy,
      // They have skipped being asked how they liked it (the scores below weren't typed in by them), so the pages show
      // no rating prompts.
      skipped_at: new Date().toISOString(),
    })),
  );
  if (watches.length) ok(await admin.from("watches").insert(watches), "watches");

  const ratings = titles.flatMap((t) =>
    Object.entries(t.scores ?? {}).map(([name, score]) => ({
      list_item_id: itemId[mediaId[t.name]],
      user_id: id(name),
      score,
    })),
  );
  if (ratings.length) ok(await admin.from("ratings").insert(ratings), "scores");

  const reactions = titles.flatMap((t) =>
    (t.likes ?? []).map((name) => ({ list_item_id: itemId[mediaId[t.name]], user_id: id(name), value: "like" })),
  );
  if (reactions.length) ok(await admin.from("reactions").insert(reactions), "likes");

  const history = titles.flatMap((t) =>
    (t.earlier ?? []).flatMap((e) =>
      e.who.map((name) => ({ user_id: id(name), media_id: mediaId[t.name], watched_on: e.on, group_id: group, logged_by: addedBy })),
    ),
  );
  if (history.length) ok(await admin.from("watch_history").insert(history), "earlier viewings");

  const removed = titles.filter((t) => t.removed).map((t) => itemId[mediaId[t.name]]);
  if (removed.length) ok(await admin.from("list_items").update({ deleted_at: new Date().toISOString() }).in("id", removed), "removals");

  return mediaId;
}

export interface SeedNight {
  on: string;
  status: "closed" | "cancelled";
  source: "swipe" | "logged";
}

/** Movie nights a family held (or only logged, or cancelled), on known days. */
export async function seedNights(group: string, startedBy: string, nights: SeedNight[]) {
  ok(
    await admin.from("movie_nights").insert(
      nights.map((n) => ({
        group_id: group,
        source: n.source,
        status: n.status,
        started_by: startedBy,
        happened_on: n.on,
        ended_at: `${n.on}T21:00:00Z`,
      })),
    ),
    "movie nights",
  );
}

/**
 * The family of the stats tests: Ana, Bogdan and Cora, six titles over 2024 and 2025 (a series, a title watched twice in
 * 2025, one watched again from 2024, one taken off the list, scores that agree and ones that don't) and their movie nights.
 *
 *   2025: 5 titles, 6 viewings, 8 h of movies, 2 movie nights, top Bravo 7.5, most loved Alpha, most divisive Delta,
 *         busiest month March, Charlie twice; Ana & Bogdan 93% alike, Ana & Cora 52%.
 *   2024: 2 titles, 2 viewings, 3 h 30 min, 1 movie night.
 */
export async function seedStatsFamily(group: string, ana: TestUser, bogdan: TestUser, cora: TestUser) {
  const people = { Ana: ana.id, Bogdan: bogdan.id, Cora: cora.id };
  const all = ["Ana", "Bogdan", "Cora"];
  await seedTitles(group, ana.id, people, [
    {
      name: "Stats Alpha",
      type: "movie",
      runtime: 100,
      genres: ["Comedy", "Family"],
      current: { on: "2025-12-24", who: all },
      earlier: [{ on: "2024-12-24", who: ["Ana", "Bogdan"] }],
      scores: { Ana: 9, Bogdan: 9, Cora: 3 },
      likes: ["Ana", "Bogdan"],
    },
    {
      name: "Stats Bravo",
      type: "movie",
      runtime: 120,
      genres: ["Comedy"],
      current: { on: "2025-03-15", who: ["Ana", "Bogdan"] },
      scores: { Ana: 8, Bogdan: 7 },
      likes: ["Ana"],
    },
    {
      name: "Stats Charlie",
      type: "movie",
      runtime: 90,
      genres: ["Drama"],
      current: { on: "2025-03-20", who: ["Ana", "Cora"] },
      earlier: [{ on: "2025-08-08", who: ["Ana", "Cora"] }],
      scores: { Ana: 6, Cora: 6 },
    },
    {
      name: "Stats Delta",
      type: "tv",
      runtime: 50,
      genres: ["Drama", "Crime"],
      current: { on: "2025-07-04", who: all },
      scores: { Ana: 9, Bogdan: 8, Cora: 2 },
    },
    {
      name: "Stats Echo",
      type: "movie",
      runtime: 110,
      genres: ["Action"],
      current: { on: "2024-05-05", who: ["Bogdan", "Cora"] },
      scores: { Bogdan: 5, Cora: 5 },
    },
    {
      name: "Stats Foxtrot",
      type: "movie",
      runtime: 80,
      genres: ["Comedy"],
      current: { on: "2025-09-09", who: ["Ana", "Bogdan"] },
      removed: true,
    },
  ]);
  await seedNights(group, ana.id, [
    { on: "2025-12-24", status: "closed", source: "swipe" },
    { on: "2025-03-15", status: "closed", source: "swipe" },
    { on: "2024-12-24", status: "closed", source: "swipe" },
    // Not nights the family held: one that was cancelled, and one that is only a log of something watched.
    { on: "2025-05-05", status: "cancelled", source: "swipe" },
    { on: "2025-06-06", status: "closed", source: "logged" },
  ]);
}
