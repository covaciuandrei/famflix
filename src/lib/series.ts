/**
 * What is kept about a series (its seasons, how far it has aired, whether it has ended), and the working out of
 * progress from that and the episodes someone ticked. Pure and client-safe, so the pages, the cards and the unit tests
 * all use the same rules. The data is TMDB's, read from `/tv/{id}` and saved as one json value in `media.series`.
 */

/** Statuses TMDB gives a show that will get no new episodes. */
const FINISHED = new Set(["Ended", "Canceled"]);

/** The database accepts seasons 1 to 200 and up to 20,000 episodes in one (a daily show's year). */
export const MAX_SEASON = 200;
export const MAX_EPISODES = 20_000;

export interface SeasonInfo {
  /** The season's number (1 and up; specials, season 0, are not tracked). */
  n: number;
  /** How many episodes TMDB lists in it, aired or not. */
  episodes: number;
}

export interface EpisodeRef {
  /** Season. */
  s: number;
  /** Episode. */
  e: number;
}

export interface SeriesInfo {
  /** TMDB's status: "Returning Series", "Ended", "Canceled", "In Production", "Planned", "Pilot". */
  status: string;
  /** The regular seasons in order. */
  seasons: SeasonInfo[];
  /** The latest episode that has aired; null before the first one. */
  lastAired: EpisodeRef | null;
  /** The day the next episode airs (YYYY-MM-DD), when TMDB knows it. */
  nextAir: string | null;
}

/** The parts of TMDB's `/tv/{id}` answer this reads. */
export interface RawSeries {
  status?: string;
  seasons?: { season_number?: number; episode_count?: number }[];
  last_episode_to_air?: { season_number?: number; episode_number?: number } | null;
  next_episode_to_air?: { air_date?: string | null } | null;
}

const isCount = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads TMDB's answer for a series; null when it lists no regular season to track. */
export function seriesFromTmdb(raw: RawSeries): SeriesInfo | null {
  const seasons = (raw.seasons ?? [])
    .filter((s) => isCount(s.season_number, MAX_SEASON) && typeof s.episode_count === "number" && s.episode_count >= 1)
    .map((s) => ({ n: s.season_number as number, episodes: Math.min(Math.floor(s.episode_count as number), MAX_EPISODES) }))
    .sort((a, b) => a.n - b.n);
  if (seasons.length === 0) return null;

  const status = typeof raw.status === "string" && raw.status.trim() ? raw.status.trim().slice(0, 40) : "Unknown";
  const last = raw.last_episode_to_air;
  let lastAired: EpisodeRef | null = null;
  if (last && isCount(last.season_number, MAX_SEASON) && isCount(last.episode_number, MAX_EPISODES)) {
    const season = seasons.find((s) => s.n === last.season_number);
    if (season) lastAired = { s: season.n, e: Math.min(last.episode_number, season.episodes) };
  } else if (FINISHED.has(status)) {
    // TMDB has no "last episode" for some old shows: one that has ended has aired everything it lists.
    const season = seasons[seasons.length - 1];
    lastAired = { s: season.n, e: season.episodes };
  }

  const nextAir = raw.next_episode_to_air?.air_date;
  return { status, seasons, lastAired, nextAir: typeof nextAir === "string" && DAY.test(nextAir) ? nextAir : null };
}

/** The json value saved in `media.series`. */
export function seriesToJson(info: SeriesInfo) {
  return {
    status: info.status,
    seasons: info.seasons.map((s) => ({ n: s.n, episodes: s.episodes })),
    last_aired: info.lastAired ? { s: info.lastAired.s, e: info.lastAired.e } : null,
    next_air: info.nextAir,
  };
}

/** Reads `media.series` back; null for a movie, or for anything that isn't what seriesToJson wrote. */
export function parseSeriesInfo(value: unknown): SeriesInfo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.seasons)) return null;
  const seasons: SeasonInfo[] = [];
  for (const item of v.seasons) {
    const s = item as { n?: unknown; episodes?: unknown };
    if (!isCount(s?.n, MAX_SEASON) || !isCount(s?.episodes, MAX_EPISODES)) return null;
    seasons.push({ n: s.n, episodes: s.episodes });
  }
  const last = v.last_aired as { s?: unknown; e?: unknown } | null | undefined;
  const lastAired = last && isCount(last.s, MAX_SEASON) && isCount(last.e, MAX_EPISODES) ? { s: last.s, e: last.e } : null;
  return {
    status: typeof v.status === "string" ? v.status : "Unknown",
    seasons,
    lastAired,
    nextAir: typeof v.next_air === "string" && DAY.test(v.next_air) ? v.next_air : null,
  };
}

/** Whether two readings of a series say the same (for saving a series' info again only when TMDB has changed it). */
export function sameSeries(a: SeriesInfo | null, b: SeriesInfo | null): boolean {
  return JSON.stringify(a && seriesToJson(a)) === JSON.stringify(b && seriesToJson(b));
}

/** Whether the show will get no new episodes. */
export function isFinished(info: SeriesInfo): boolean {
  return FINISHED.has(info.status);
}

/** How many episodes of a season have aired. */
export function airedIn(info: SeriesInfo, n: number): number {
  const season = info.seasons.find((s) => s.n === n);
  const last = info.lastAired;
  if (!season || !last) return 0;
  if (n < last.s) return season.episodes;
  if (n === last.s) return Math.min(last.e, season.episodes);
  return 0;
}

export function airedTotal(info: SeriesInfo): number {
  return info.seasons.reduce((sum, s) => sum + airedIn(info, s.n), 0);
}

/** How a ticked episode is written in a set of ticks. */
export const episodeKey = (season: number, episode: number): string => `${season}:${episode}`;

/** "S2E5". */
export const episodeLabel = (season: number, episode: number): string => `S${season}E${episode}`;

/** The ticked episodes as episodeKey()s: a Set, or the Map of an EpisodeState. */
export type Ticked = { has(key: string): boolean };

export interface Progress {
  /** Aired episodes that are ticked (all of them once the series is completed). */
  watched: number;
  /** Episodes that have aired. */
  aired: number;
  /** Episodes TMDB lists, aired or not. */
  total: number;
}

/** One season's progress. `ticks` are the ticked episodes as episodeKey(); `completed` is a series marked Watched. */
export function seasonProgress(info: SeriesInfo, n: number, ticks: Ticked, completed: boolean): Progress {
  const season = info.seasons.find((s) => s.n === n);
  const aired = airedIn(info, n);
  let watched = 0;
  if (completed) watched = aired;
  else for (let e = 1; e <= aired; e++) if (ticks.has(episodeKey(n, e))) watched++;
  return { watched, aired, total: season?.episodes ?? 0 };
}

/** The whole series' progress. Ticks of episodes that have not aired (or that TMDB no longer lists) don't count. */
export function seriesProgress(info: SeriesInfo, ticks: Ticked, completed: boolean): Progress {
  const parts = info.seasons.map((s) => seasonProgress(info, s.n, ticks, completed));
  return {
    watched: parts.reduce((sum, p) => sum + p.watched, 0),
    aired: parts.reduce((sum, p) => sum + p.aired, 0),
    total: parts.reduce((sum, p) => sum + p.total, 0),
  };
}

/** The first aired episode that is not ticked; null when everything that has aired is. */
export function nextUp(info: SeriesInfo, ticks: Ticked, completed: boolean): EpisodeRef | null {
  if (completed) return null;
  for (const season of info.seasons) {
    const aired = airedIn(info, season.n);
    for (let e = 1; e <= aired; e++) if (!ticks.has(episodeKey(season.n, e))) return { s: season.n, e };
  }
  return null;
}

/** The season to show open at first: the one with the next episode, else the latest that has aired. */
export function seasonToOpen(info: SeriesInfo, ticks: Ticked, completed: boolean): number {
  const next = nextUp(info, ticks, completed);
  if (next) return next.s;
  const started = info.seasons.filter((season) => airedIn(info, season.n) > 0);
  return (started[started.length - 1] ?? info.seasons[0]).n;
}

/**
 * Where someone is with a series: Not started (no ticks), Watching, Caught up (every episode that has aired is ticked,
 * on a show that may get more; a finished one completes by itself) or Completed (marked Watched).
 */
export type SeriesStatus = "not-started" | "watching" | "caught-up" | "completed";

export function seriesStatus(info: SeriesInfo | null, ticks: Ticked, completed: boolean): SeriesStatus {
  if (completed) return "completed";
  if (!info) return "not-started";
  const { watched, aired } = seriesProgress(info, ticks, false);
  if (watched === 0) return "not-started";
  return aired > 0 && watched >= aired ? "caught-up" : "watching";
}

// ---------------------------------------------------------------------------------------------------------------
//  Ticking, as the page shows it at once (the database, in mark_episodes(), makes it so)
// ---------------------------------------------------------------------------------------------------------------

/** One ticked episode: the day, and the person's own score and note for it. */
export interface EpisodeLog {
  on: string;
  score: number | null;
  comment: string | null;
}

/** A series entry's episodes as the page keeps them: the ticks by episodeKey(), and whether it is marked Watched. */
export interface EpisodeState {
  ticks: ReadonlyMap<string, EpisodeLog>;
  completed: boolean;
}

/** The listed episodes from one to another, both included, in order (`to` may run past a season's end: it stops there). */
export function episodesBetween(info: SeriesInfo, from: EpisodeRef, to: EpisodeRef): EpisodeRef[] {
  const found: EpisodeRef[] = [];
  for (const season of info.seasons) {
    if (season.n < from.s || season.n > to.s) continue;
    const first = season.n === from.s ? from.e : 1;
    const last = Math.min(season.n === to.s ? to.e : season.episodes, season.episodes);
    for (let e = first; e <= last; e++) found.push({ s: season.n, e });
  }
  return found;
}

/** Every episode that has aired, in order. */
export function airedEpisodes(info: SeriesInfo): EpisodeRef[] {
  return info.seasons.flatMap((season) =>
    Array.from({ length: airedIn(info, season.n) }, (_, i) => ({ s: season.n, e: i + 1 })),
  );
}

/** Whether an episode shows as watched: ticked, or part of a series marked Watched (once it has aired). */
export function isTicked(info: SeriesInfo, state: EpisodeState, season: number, episode: number): boolean {
  if (state.completed) return episode <= airedIn(info, season);
  return state.ticks.has(episodeKey(season, episode));
}

/** The ticks of a state that are all of the aired episodes (what completes a series that has ended). */
function everyAiredTicked(info: SeriesInfo, ticks: Ticked): boolean {
  const aired = airedEpisodes(info);
  return aired.length > 0 && aired.every(({ s, e }) => ticks.has(episodeKey(s, e)));
}

/**
 * What ticking (or unticking) a range does, the way mark_episodes() does it: only aired episodes get ticked, ticking the
 * last aired episode of a series that has ended completes it, and unticking on a completed series first ticks every aired
 * episode, then takes the range off and reopens it. Unticking takes the episodes' scores and notes with them.
 */
export function applyMark(
  info: SeriesInfo,
  state: EpisodeState,
  mark: { watched: boolean; from: EpisodeRef; to: EpisodeRef; on: string },
): EpisodeState {
  const range = episodesBetween(info, mark.from, mark.to);
  const ticks = new Map(state.ticks);
  let completed = state.completed;

  if (mark.watched) {
    for (const { s, e } of range) {
      if (e <= airedIn(info, s) && !ticks.has(episodeKey(s, e))) ticks.set(episodeKey(s, e), { on: mark.on, score: null, comment: null });
    }
    if (!completed && isFinished(info)) completed = everyAiredTicked(info, ticks);
  } else {
    if (completed && range.some(({ s, e }) => e <= airedIn(info, s))) {
      for (const { s, e } of airedEpisodes(info)) {
        if (!ticks.has(episodeKey(s, e))) ticks.set(episodeKey(s, e), { on: mark.on, score: null, comment: null });
      }
      completed = false;
    }
    for (const { s, e } of range) ticks.delete(episodeKey(s, e));
  }
  return { ticks, completed };
}

/** A score (1 to 10, one decimal) and/or a note for one aired episode. */
export interface EpisodeRating {
  season: number;
  episode: number;
  score: number | null;
  comment: string | null;
  on: string;
}

/**
 * What rating an episode does, the way rate_episode() does it: the episode gets ticked, the note is trimmed (a blank one
 * is none), the score is kept to one decimal, and with neither a score nor a note the old ones are only taken off. Like
 * the last tick, rating the last aired episode of a series that has ended completes it. Episodes that haven't aired
 * are not rated.
 */
export function applyRating(info: SeriesInfo, state: EpisodeState, rating: EpisodeRating): EpisodeState {
  if (rating.episode > airedIn(info, rating.season)) return state;
  const key = episodeKey(rating.season, rating.episode);
  const score = rating.score === null ? null : Math.round(rating.score * 10) / 10;
  const comment = rating.comment?.trim() || null;
  const ticks = new Map(state.ticks);
  const existing = ticks.get(key);

  if (score === null && comment === null) {
    if (existing) ticks.set(key, { ...existing, score: null, comment: null });
  } else {
    ticks.set(key, { on: existing?.on ?? rating.on, score, comment });
  }
  const completed = state.completed || (isFinished(info) && everyAiredTicked(info, ticks));
  return { ticks, completed };
}
