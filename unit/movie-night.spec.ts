import { expect, test } from "@playwright/test";

import { composeDeck, interleave } from "../src/lib/deck-compose";
import { formatDayNumeric, formatRuntime } from "../src/lib/format";
import { BROWSE_GENRES, matchesAnyGenre, matchesGenreSlug } from "../src/lib/genres";
import {
  candidateToCard,
  deckOrder,
  DEFAULT_MOOD,
  deletedNightDetail,
  groupVotes,
  GUEST_SECRET,
  guestPath,
  isSwipingPath,
  isUuid,
  MAX_GENRES,
  MAX_VOTES_PER_SAVE,
  moodParams,
  MOODS,
  movieNightMood,
  NIGHT_STATUS_LABEL,
  nightAction,
  nightMood,
  nightPeople,
  ownRaters,
  parseMood,
  peopleLabel,
  personLabel,
  POINTS,
  type MemberProgress,
  type NightInfo,
  type NightCandidate,
  validVotes,
  whoWatched,
} from "../src/lib/movie-night";

const movie = (id: number) => ({ mediaType: "movie" as const, tmdbId: id });
const movies = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => movie(from + i));
const ids = (deck: { card: { tmdbId: number } }[]) => deck.map((d) => d.card.tmdbId);

test.describe("composeDeck", () => {
  test("takes up to 20 list titles and fills the rest with suggestions", () => {
    const deck = composeDeck({ list: movies(1, 40), suggestions: movies(100, 30), size: 25, seed: 1 });
    expect(deck).toHaveLength(25);
    expect(deck.filter((d) => d.origin === "list")).toHaveLength(20);
    expect(deck.filter((d) => d.origin === "suggested")).toHaveLength(5);
  });

  test("a short list is filled up with suggestions, so the stack is still full", () => {
    const deck = composeDeck({ list: movies(1, 7), suggestions: movies(100, 30), size: 25, seed: 1 });
    expect(deck).toHaveLength(25);
    expect(deck.filter((d) => d.origin === "list")).toHaveLength(7);
    expect(deck.filter((d) => d.origin === "suggested")).toHaveLength(18);
  });

  test("an empty list gives all suggestions", () => {
    const deck = composeDeck({ list: [], suggestions: movies(100, 30), size: 25, seed: 1 });
    expect(deck.filter((d) => d.origin === "suggested")).toHaveLength(25);
  });

  test("the list share follows the stack size and always leaves 5 suggestions", () => {
    const list = movies(1, 60);
    const suggestions = movies(100, 60);
    const share = (size: number) =>
      composeDeck({ list, suggestions, size, seed: 3 }).filter((d) => d.origin === "list").length;
    expect(share(20)).toBe(15);
    expect(share(25)).toBe(20);
    expect(share(30)).toBe(25);
  });

  test("when suggestions run short, leftover list titles top the stack up", () => {
    const deck = composeDeck({ list: movies(1, 40), suggestions: movies(100, 3), size: 25, seed: 1 });
    expect(deck).toHaveLength(25);
    expect(deck.filter((d) => d.origin === "suggested")).toHaveLength(3);
    expect(deck.filter((d) => d.origin === "list")).toHaveLength(22);
  });

  test("nothing appears twice, and a title on both counts as a list title", () => {
    const deck = composeDeck({
      list: [movie(1), movie(2), movie(2)],
      suggestions: [movie(2), movie(3), movie(3), movie(4)],
      size: 25,
      seed: 1,
    });
    expect(ids(deck).sort()).toEqual([1, 2, 3, 4]);
    expect(deck.find((d) => d.card.tmdbId === 2)?.origin).toBe("list");
  });

  test("a movie and a series with the same id are different titles", () => {
    const deck = composeDeck({
      list: [{ mediaType: "movie", tmdbId: 5 }],
      suggestions: [{ mediaType: "tv", tmdbId: 5 }],
      size: 25,
      seed: 1,
    });
    expect(deck).toHaveLength(2);
  });

  test("the same seed gives the same stack, a different one picks other list titles", () => {
    const args = { list: movies(1, 60), suggestions: movies(100, 30), size: 25 };
    expect(ids(composeDeck({ ...args, seed: 7 }))).toEqual(ids(composeDeck({ ...args, seed: 7 })));
    expect(ids(composeDeck({ ...args, seed: 7 }))).not.toEqual(ids(composeDeck({ ...args, seed: 8 })));
  });

  test("titles put back on the list to watch again are always in the stack, however long the list", () => {
    const list = movies(1, 200);
    const first = [movie(150), movie(33), movie(7)];
    for (let seed = 1; seed <= 25; seed++) {
      const deck = composeDeck({ list, suggestions: movies(1000, 30), size: 25, seed, first });
      expect(deck).toHaveLength(25);
      expect(deck.filter((d) => d.origin === "list")).toHaveLength(20);
      expect(ids(deck)).toEqual(expect.arrayContaining([150, 33, 7]));
    }
  });

  test("more of them than the list share are cut to it, and the rest of the share is random list titles", () => {
    const first = movies(1, 30);
    const deck = composeDeck({ list: movies(1, 100), suggestions: movies(1000, 30), size: 25, seed: 4, first });
    const fromList = deck.filter((d) => d.origin === "list").map((d) => d.card.tmdbId);
    expect(fromList).toHaveLength(20);
    expect(fromList.every((id) => id <= 30)).toBe(true);

    const some = composeDeck({ list: movies(1, 100), suggestions: movies(1000, 30), size: 25, seed: 4, first: movies(1, 5) });
    const listIds = some.filter((d) => d.origin === "list").map((d) => d.card.tmdbId);
    expect(listIds).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));
    expect(listIds.filter((id) => id > 5)).toHaveLength(15);
  });

  test("without titles to lead, the stack is what it always was", () => {
    const args = { list: movies(1, 60), suggestions: movies(100, 30), size: 25, seed: 9 };
    expect(ids(composeDeck({ ...args, first: [] }))).toEqual(ids(composeDeck(args)));
  });

  test("a title that leads but isn't on the list is not added, and one on both lists leads once", () => {
    const deck = composeDeck({
      list: movies(1, 10),
      suggestions: [movie(3), movie(50)],
      size: 25,
      seed: 1,
      first: [movie(3), movie(99)],
    });
    expect(ids(deck).filter((id) => id === 3)).toHaveLength(1);
    expect(ids(deck)).not.toContain(99);
    expect(deck.find((d) => d.card.tmdbId === 3)?.origin).toBe("list");
  });
});

test("interleave alternates between lists and keeps the longer tail", () => {
  expect(interleave([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]])).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
  expect(interleave<string>([])).toEqual([]);
});

test("a night's card carries how often the family watched the title, and a guest's carries nothing", () => {
  const card: NightCandidate = {
    id: "c1",
    stack_id: "s1",
    position: 0,
    origin: "list",
    list_item_id: null,
    media_id: "m1",
    tmdb_id: 1,
    media_type: "movie",
    title: "Dune",
    year: 2021,
    poster_path: null,
    backdrop_path: null,
    overview: null,
    rating: null,
    runtime: null,
    genres: [],
    trailer_key: null,
  };
  expect(candidateToCard({ ...card, watched_before: 2 }).watchedBefore).toBe(2);
  expect(candidateToCard({ ...card, watched_before: 0 }).watchedBefore).toBe(0);
  expect(candidateToCard({ ...card, watched_before: null }).watchedBefore).toBeUndefined();
  expect(candidateToCard(card).watchedBefore).toBeUndefined();
});

test.describe("deckOrder", () => {
  const cards = Array.from({ length: 25 }, (_, i) => i);

  test("is the same every time for the same person and stack", () => {
    expect(deckOrder("user-a", "stack-1", cards)).toEqual(deckOrder("user-a", "stack-1", cards));
  });

  test("differs between people and between stacks, and keeps every card", () => {
    const a = deckOrder("user-a", "stack-1", cards);
    expect(a).not.toEqual(deckOrder("user-b", "stack-1", cards));
    expect(a).not.toEqual(deckOrder("user-a", "stack-2", cards));
    expect([...a].sort((x, y) => x - y)).toEqual(cards);
  });
});

test.describe("genres", () => {
  test("a series' broader names match the browse categories", () => {
    expect(matchesGenreSlug(["Action & Adventure"], "action")).toBe(true);
    expect(matchesGenreSlug(["Action & Adventure"], "adventure")).toBe(true);
    expect(matchesGenreSlug(["Sci-Fi & Fantasy"], "science-fiction")).toBe(true);
    expect(matchesGenreSlug(["Sci-Fi & Fantasy"], "fantasy")).toBe(true);
    expect(matchesGenreSlug(["War & Politics"], "war")).toBe(true);
    expect(matchesGenreSlug(["Drama"], "comedy")).toBe(false);
    expect(matchesGenreSlug(["Drama"], "not-a-genre")).toBe(false);
  });

  test("every browse category matches the movie genre name it is called", () => {
    for (const genre of BROWSE_GENRES) {
      expect(matchesGenreSlug([genre.label], genre.slug), genre.slug).toBe(true);
    }
  });

  test("no categories means anything goes, otherwise any one match is enough", () => {
    expect(matchesAnyGenre(["Drama"], [])).toBe(true);
    expect(matchesAnyGenre(["Drama", "Crime"], ["comedy", "crime"])).toBe(true);
    expect(matchesAnyGenre(["Drama"], ["comedy", "crime"])).toBe(false);
  });
});

test.describe("moods", () => {
  test("every preset only uses real categories, and none is too long", () => {
    const slugs = BROWSE_GENRES.map((g) => g.slug) as string[];
    for (const mood of MOODS) {
      expect(mood.genres.length).toBeLessThanOrEqual(MAX_GENRES);
      for (const genre of mood.genres) expect(slugs, `${mood.slug}: ${genre}`).toContain(genre);
    }
  });

  test("parseMood keeps only values that make sense", () => {
    expect(parseMood({})).toEqual(DEFAULT_MOOD);
    expect(
      parseMood({ genres: "comedy, horror,comedy,bogus", series: "1", count: "30", max: "100" }),
    ).toEqual({ genres: ["comedy", "horror"], series: true, count: 30, maxRuntime: 100 });
    expect(parseMood({ genres: "", series: "yes", count: "99", max: "5" })).toEqual(DEFAULT_MOOD);
    expect(parseMood({ genres: BROWSE_GENRES.map((g) => g.slug) }).genres).toHaveLength(MAX_GENRES);
  });

  test("moodParams round-trips and leaves out the defaults", () => {
    expect(moodParams(DEFAULT_MOOD).toString()).toBe("");
    const mood = { genres: ["comedy", "family"], series: true, count: 20 as const, maxRuntime: 130 };
    expect(parseMood(Object.fromEntries(moodParams(mood)))).toEqual(mood);
  });
});

test("a family's movie night is for movies, whatever the mood or an older night asked for", () => {
  const asked = { genres: ["comedy"], series: true, count: 30 as const, maxRuntime: 100 };
  expect(movieNightMood(asked)).toEqual({ ...asked, series: false });
  expect(movieNightMood(DEFAULT_MOOD)).toEqual(DEFAULT_MOOD);
  // A night made while series were allowed still asks for more suggestions in the same mood, without series.
  const older = { genres: ["comedy"], options: { series: true, count: 20, max: 130 } } as unknown as NightInfo;
  expect(nightMood(older)).toEqual({ genres: ["comedy"], series: false, count: 20, maxRuntime: 130 });
});

test("points: love 2, yes 1, nope -1, and seen it adds nothing", () => {
  expect(POINTS).toEqual({ love: 2, yes: 1, seen: 0, nope: -1 });
});

test("formatDayNumeric writes a day as dd.mm.yyyy, from a date or a full timestamp", () => {
  expect(formatDayNumeric("2026-10-09")).toBe("09.10.2026");
  expect(formatDayNumeric("2026-01-31")).toBe("31.01.2026");
  expect(formatDayNumeric("2026-12-05T20:00:00+00:00")).toBe("05.12.2026");
});

test("formatRuntime reads like a film listing", () => {
  expect(formatRuntime(45)).toBe("45 min");
  expect(formatRuntime(95)).toBe("1 h 35 min");
  expect(formatRuntime(120)).toBe("2 h");
});

test.describe("groupVotes", () => {
  const votes = [
    { user_id: "u-cara", name: "Cara", guest: false, vote: "yes" as const },
    { user_id: "u-ana", name: "Ana", guest: false, vote: "love" as const },
    { user_id: "u-ben", name: "Ben", guest: false, vote: "yes" as const },
    { user_id: "u-dan", name: "Dan", guest: false, vote: "nope" as const },
    { user_id: "u-eva", name: "Eva", guest: false, vote: "yes" as const },
  ];

  test("goes from the strongest vote down and leaves out votes nobody gave", () => {
    expect(groupVotes(votes, "u-zed").map((g) => g.vote)).toEqual(["love", "yes", "nope"]);
  });

  test("lists you first, then the others by name", () => {
    const yes = groupVotes(votes, "u-eva").find((g) => g.vote === "yes");
    expect(yes?.names).toEqual(["You", "Ben", "Cara"]);
  });

  test("a night nobody voted on has nothing to show", () => {
    expect(groupVotes([], "u-ana")).toEqual([]);
  });

  test("marks the guests, who are told apart from a family member with the same name", () => {
    const mixed = [
      ...votes,
      { user_id: "g-1", name: "Ben", guest: true, vote: "yes" as const },
      { user_id: "g-2", name: "Zoe", guest: true, vote: "love" as const },
    ];
    expect(groupVotes(mixed, "u-zed").find((g) => g.vote === "yes")?.names).toEqual([
      "Ben",
      "Ben (guest)",
      "Cara",
      "Eva",
    ]);
    expect(groupVotes(mixed, "u-zed").find((g) => g.vote === "love")?.names).toEqual(["Ana", "Zoe (guest)"]);
    // A guest looking at the board is "You" too.
    expect(groupVotes(mixed, "g-2").find((g) => g.vote === "love")?.names).toEqual(["You", "Ana"]);
  });
});

test.describe("personLabel", () => {
  test("is You for yourself, the name for the family, and the name marked as a guest for a guest", () => {
    expect(personLabel({ user_id: "u-ana", name: "Ana", guest: false }, "u-ana")).toBe("You");
    expect(personLabel({ user_id: "u-ben", name: "Ben", guest: false }, "u-ana")).toBe("Ben");
    expect(personLabel({ user_id: "g-1", name: "Zoe", guest: true }, "u-ana")).toBe("Zoe (guest)");
    expect(personLabel({ user_id: "g-1", name: "Zoe", guest: true }, "g-1")).toBe("You");
  });
});

test.describe("who a night lists", () => {
  const ana = { name: "Ana", avatarUrl: "ana.png", watched: true };
  const ben = { name: "Ben", avatarUrl: null, watched: false };
  const cara = { name: "Cara", avatarUrl: null, watched: true };
  const listed = (people: ReturnType<typeof nightPeople>) => people.map((p) => (p.guest ? `${p.name} (guest)` : p.name));

  test("a pick lists the family members who watched, then the guests, each by name", () => {
    const people = nightPeople({ picked: true, members: [cara, ben, ana], guests: ["Zoe", "Yan"] });
    expect(listed(people)).toEqual(["Ana", "Cara", "Yan (guest)", "Zoe (guest)"]);
  });

  test("a night nobody picked from lists everyone who joined, then the guests", () => {
    const people = nightPeople({ picked: false, members: [cara, ben, ana], guests: ["Zoe"] });
    expect(listed(people)).toEqual(["Ana", "Ben", "Cara", "Zoe (guest)"]);
  });

  test("guests are listed even when no family member is ticked, and have no picture", () => {
    const people = nightPeople({ picked: true, members: [ben], guests: ["Zoe"] });
    expect(people).toEqual([{ name: "Zoe", avatarUrl: null, guest: true }]);
  });

  test("a guest with a member's name is a separate person", () => {
    const people = nightPeople({ picked: true, members: [ana], guests: ["Ana"] });
    expect(people).toEqual([
      { name: "Ana", avatarUrl: "ana.png", guest: false },
      { name: "Ana", avatarUrl: null, guest: true },
    ]);
  });

  test("a night with no guests lists just the family, as before", () => {
    expect(listed(nightPeople({ picked: true, members: [cara, ben, ana], guests: [] }))).toEqual(["Ana", "Cara"]);
    expect(nightPeople({ picked: true, members: [], guests: [] })).toEqual([]);
  });

  test("says who watched or who took part, marking the guests", () => {
    const people = nightPeople({ picked: true, members: [ana], guests: ["Zoe"] });
    expect(peopleLabel("closed", people)).toBe("Watched by: Ana, Zoe (guest)");
    expect(peopleLabel("cancelled", people)).toBe("Took part: Ana, Zoe (guest)");
    expect(peopleLabel("expired", [])).toBe("Took part: ");
  });
});

test.describe("whoWatched", () => {
  const person = (user_id: string, name: string, extra: Partial<MemberProgress> = {}): MemberProgress => ({
    user_id,
    name,
    avatar_url: null,
    guest: false,
    joined: true,
    watched: false,
    stacks: [],
    ...extra,
  });

  test("is the family members who were ticked, then every guest of the night", () => {
    const members = [
      person("g-yan", "Yan", { guest: true }),
      person("u-ana", "Ana", { watched: true }),
      person("u-ben", "Ben"),
      person("g-zoe", "Zoe", { guest: true }),
      person("u-cara", "Cara", { watched: true }),
    ];
    expect(whoWatched(members).map((m) => m.name)).toEqual(["Ana", "Cara", "Yan", "Zoe"]);
  });

  test("is nobody for a night with no ticked members and no guests", () => {
    expect(whoWatched([person("u-ben", "Ben")])).toEqual([]);
    expect(whoWatched([])).toEqual([]);
  });
});

test("a guest link lives under /guest and holds nothing but the token", () => {
  expect(guestPath("ab12")).toBe("/guest/ab12");
});

test("a guest's link token and secret are 64 lower-case hex characters, and nothing else passes", () => {
  const good = "0123456789abcdef".repeat(4);
  expect(GUEST_SECRET.test(good)).toBe(true);
  for (const bad of [good.slice(1), `${good}0`, good.toUpperCase(), `${good.slice(1)}g`, ` ${good}`, `${good}\n`, "", "../etc"]) {
    expect(GUEST_SECRET.test(bad), JSON.stringify(bad)).toBe(false);
  }
});

test.describe("validVotes", () => {
  const id = "0b9a1c7e-0d3f-4a52-8f1a-3c2d4e5f6a7b";

  test("takes one to the most a save allows, of the four votes or null to take one back", () => {
    expect(validVotes([{ candidateId: id, vote: "love" }])).toBe(true);
    expect(validVotes(["nope", "yes", "love", "seen", null].map((vote) => ({ candidateId: id, vote })))).toBe(true);
    expect(validVotes(Array.from({ length: MAX_VOTES_PER_SAVE }, () => ({ candidateId: id, vote: "yes" })))).toBe(true);
  });

  test("refuses nothing, too many, or anything that is not a card with a vote", () => {
    expect(validVotes([])).toBe(false);
    expect(validVotes(Array.from({ length: MAX_VOTES_PER_SAVE + 1 }, () => ({ candidateId: id, vote: "yes" })))).toBe(false);
    for (const bad of [
      null,
      undefined,
      "yes",
      {},
      [null],
      ["yes"],
      [{ candidateId: id }],
      [{ candidateId: id, vote: "maybe" }],
      [{ candidateId: id, vote: "LOVE" }],
      [{ candidateId: id, vote: 1 }],
      [{ candidateId: "not-an-id", vote: "yes" }],
      [{ candidateId: 7, vote: "yes" }],
      [{ vote: "yes" }],
      [{ candidateId: id, vote: "yes" }, { candidateId: id, vote: "nope" }, null],
    ]) {
      expect(validVotes(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test("an id is a UUID", () => {
    expect(isUuid(id)).toBe(true);
    expect(isUuid(id.toUpperCase())).toBe(true);
    for (const bad of [`${id}0`, id.slice(1), "", null, 5, `${id} `, id.replace(/-/g, "")]) expect(isUuid(bad)).toBe(false);
  });
});

test.describe("what a night in progress offers", () => {
  test("joining comes first, then the stacks left to swipe, then the leaderboard", () => {
    expect(nightAction({ joined: false, waiting_stacks: 1 })).toBe("Join in");
    expect(nightAction({ joined: false, waiting_stacks: 0 })).toBe("Join in");
    expect(nightAction({ joined: true, waiting_stacks: 2 })).toBe("Keep swiping");
    expect(nightAction({ joined: true, waiting_stacks: 0 })).toBe("See the leaderboard");
  });

  test("every status has a name people can read", () => {
    expect(NIGHT_STATUS_LABEL).toEqual({
      open: "In progress",
      closed: "Finished",
      cancelled: "Cancelled",
      expired: "Expired",
    });
  });
});

test.describe("isSwipingPath", () => {
  test("a movie night and Discover are swiping pages, the rest of the app isn't", () => {
    for (const path of ["/app/movie-night", "/app/movie-night/0f0f", "/app/browse/discover", "/app/browse/discover/swipe"]) {
      expect(isSwipingPath(path), path).toBe(true);
    }
    for (const path of ["/app", "/app/browse", "/app/mine", "/app/groups", "/app/media/movie/603"]) {
      expect(isSwipingPath(path), path).toBe(false);
    }
  });
});

test.describe("ownRaters", () => {
  test("counts a rating the person gave themself, or one nobody is recorded as giving", () => {
    const ratings = [
      { user_id: "ana", rated_by: "ana" },
      { user_id: "bob", rated_by: null },
    ];
    expect([...ownRaters(ratings)].sort()).toEqual(["ana", "bob"]);
  });

  test("ignores a score somebody else filled in for them", () => {
    const ratings = [
      { user_id: "ana", rated_by: "bob" },
      { user_id: "bob", rated_by: "bob" },
    ];
    expect([...ownRaters(ratings)]).toEqual(["bob"]);
  });

  test("counts a note as theirs even when somebody else filled a score in beside it", () => {
    const ratings = [
      { user_id: "ana", rated_by: "bob", comment: "Loved the ending" },
      { user_id: "cara", rated_by: "bob", comment: null },
    ];
    expect([...ownRaters(ratings)]).toEqual(["ana"]);
  });

  test("a note of only blanks is no note", () => {
    expect(ownRaters([{ user_id: "ana", rated_by: "bob", comment: "   " }]).size).toBe(0);
    expect(ownRaters([{ user_id: "ana", rated_by: "bob", comment: "" }]).size).toBe(0);
  });

  test("is empty without ratings", () => {
    expect(ownRaters([]).size).toBe(0);
  });
});

test.describe("deletedNightDetail", () => {
  test("reads the day the night was on", () => {
    expect(deletedNightDetail("2026-10-12")).toEqual({ day: "2026-10-12", undone: false });
  });

  test("knows when the title went back to To watch", () => {
    expect(deletedNightDetail("2026-10-12 undone")).toEqual({ day: "2026-10-12", undone: true });
  });

  test("copes with nothing or with text that isn't a day", () => {
    for (const detail of [null, undefined, "", "yesterday", "12/10/2026"]) {
      expect(deletedNightDetail(detail), String(detail)).toEqual({ day: null, undone: false });
    }
    expect(deletedNightDetail("soon undone")).toEqual({ day: null, undone: true });
  });
});
