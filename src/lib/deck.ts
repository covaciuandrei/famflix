import "server-only";

import { getListCards } from "@/lib/data";
import { composeDeck } from "@/lib/deck-compose";
import { matchesAnyGenre } from "@/lib/genres";
import { isToWatch } from "@/lib/list-status";
import {
  cardKey,
  MIN_STACK_SIZE,
  MIN_SUGGESTIONS,
  movieNightMood,
  type DeckCard,
  type DiscoverCard,
  type MoodOptions,
} from "@/lib/movie-night";
import { saveMediaMany } from "@/lib/save-media";
import {
  detailsToMediaRow,
  getDeckSuggestions,
  getLikeSuggestions,
  getMediaDetails,
  type TmdbDetails,
} from "@/lib/tmdb";
import type { ListItemCard, MediaType } from "@/lib/types";

/**
 * Builds the stacks of cards for a movie night: titles from a list that fit the mood, and suggestions from TMDB.
 * Nothing here is shown to other people, so it only returns what the caller needs next.
 */

const NOT_ENOUGH =
  "We couldn't find enough titles for that mood. Try a few more genres, or include series.";
const NOT_ENOUGH_MOVIES = "We couldn't find enough movies for that mood. Try a few more genres.";
const NOT_ENOUGH_LIKE = "There aren't enough more titles like that one. Ask for more suggestions in the same mood instead.";
const TMDB_DOWN = "Couldn't reach the movie database. Please try again.";

function listKey(card: ListItemCard): string {
  return cardKey({ mediaType: card.media.media_type, tmdbId: card.media.tmdb_id });
}

/** A list title fits the mood when its type, length and genres do (the same test suggestions pass in their search). */
function fitsMood(card: ListItemCard, mood: MoodOptions): boolean {
  const { media } = card;
  if (media.media_type === "tv" && !mood.series) return false;
  if (
    media.media_type === "movie" &&
    mood.maxRuntime !== null &&
    media.runtime !== null &&
    media.runtime > mood.maxRuntime
  ) {
    return false;
  }
  return matchesAnyGenre(media.genres, mood.genres);
}

/** A title to find more like, instead of searching by mood. */
export interface LikeTitle {
  mediaType: MediaType;
  tmdbId: number;
}

/**
 * Up to `wanted` suggestions with full details (genres, length, trailer), skipping titles in `exclude`. Details come
 * from TMDB a batch at a time: a few more than needed at first, since some fail or turn out not to fit. With `like`,
 * they are titles TMDB recommends for that one (the mood's genres don't apply, its length limit still does).
 */
async function collectSuggestions({
  mood,
  seed,
  exclude,
  wanted,
  like,
}: {
  mood: MoodOptions;
  seed: number;
  exclude: ReadonlySet<string>;
  wanted: number;
  like?: LikeTitle;
}): Promise<TmdbDetails[]> {
  if (wanted <= 0) return [];
  const found = like
    ? await getLikeSuggestions(like.mediaType, like.tmdbId)
    : await getDeckSuggestions({
        genres: mood.genres,
        series: mood.series,
        maxRuntime: mood.maxRuntime,
        seed,
      });
  const queue = found.filter(
    (item) => !exclude.has(cardKey(item)) && (mood.series || item.mediaType === "movie"),
  );
  const ready: TmdbDetails[] = [];
  let next = 0;
  while (ready.length < wanted && next < queue.length) {
    const take = Math.min(queue.length - next, next === 0 ? wanted + 4 : wanted - ready.length + 2, 32);
    const batch = queue.slice(next, next + take);
    next += take;
    const details = await Promise.allSettled(
      batch.map((item) => getMediaDetails(item.mediaType, item.tmdbId)),
    );
    for (const result of details) {
      if (result.status !== "fulfilled" || ready.length >= wanted) continue;
      const title = result.value;
      const tooLong =
        mood.maxRuntime !== null &&
        title.mediaType === "movie" &&
        title.runtime !== null &&
        title.runtime > mood.maxRuntime;
      if (!tooLong) ready.push(title);
    }
  }
  return ready;
}

function toDeckCard(details: TmdbDetails): DeckCard {
  return {
    id: cardKey(details),
    mediaType: details.mediaType,
    tmdbId: details.tmdbId,
    title: details.title,
    year: details.year,
    posterPath: details.posterPath,
    backdropPath: details.backdropPath,
    overview: details.overview,
    rating: details.voteAverage > 0 ? details.voteAverage : null,
    runtime: details.runtime,
    genres: details.genres,
    trailerKey: details.trailerKey,
    origin: "suggested",
  };
}

/**
 * A Discover stack: only suggestions, never a title already on My list. The same seed gives the same stack, so a
 * refresh doesn't change the cards under someone's thumb. The titles are saved to the shared `media` table here, in one
 * go, so that swiping one right later only has to put it on the list (no waiting for TMDB per title).
 */
export async function buildDiscoverDeck({
  userId,
  mood,
  seed,
}: {
  userId: string;
  mood: MoodOptions;
  seed: number;
}): Promise<{ cards: DiscoverCard[] } | { error: string }> {
  try {
    const mine = await getListCards({ groupId: null, userId });
    const exclude = new Set(mine.map(listKey));
    const found = await collectSuggestions({ mood, seed, exclude, wanted: mood.count });
    if (found.length < MIN_STACK_SIZE) return { error: NOT_ENOUGH };

    const saved = await saveMediaMany(found.map(detailsToMediaRow));
    if ("error" in saved) return saved;
    const cards: DiscoverCard[] = [];
    for (const details of found) {
      const mediaId = saved.get(cardKey(details));
      if (!mediaId) return { error: "Couldn't save these titles. Please try again later." };
      cards.push({ ...toDeckCard(details), mediaId });
    }
    return { cards };
  } catch (error) {
    console.error("Building a Discover stack failed:", error);
    return { error: TMDB_DOWN };
  }
}

/** One card of a family night, ready to be stored: a title in `media`, and the list item it came from, if any. */
export interface FamilyCandidate {
  media_id: string;
  list_item_id: string | null;
  origin: "list" | "suggested";
}

interface PoolItem {
  mediaType: MediaType;
  tmdbId: number;
  mediaId: string | null;
  listItemId: string | null;
  details: TmdbDetails | null;
}

/**
 * The cards of a family night's stack, in order. The first stack takes up to `size - 5` of the family's To watch
 * titles that fit the mood and fills the rest with suggestions; a short list still gives a full stack. A "more
 * suggestions" stack (`suggestionsOnly`) is all suggestions. Suggestions never repeat a title on the family list or
 * in `exclude` (the night's earlier stacks and its recent nights). Suggested titles are saved to the shared `media`
 * table here, since the night stores them by id. A movie night is for movies, so a series on the family list is
 * never a card.
 */
export async function buildFamilyCandidates({
  userId,
  groupId,
  mood: asked,
  seed,
  size,
  suggestionsOnly = false,
  exclude = new Set<string>(),
  like,
}: {
  userId: string;
  groupId: string;
  mood: MoodOptions;
  seed: number;
  size?: number;
  suggestionsOnly?: boolean;
  exclude?: ReadonlySet<string>;
  /** Suggest titles like this one (a "more like this" stack). */
  like?: LikeTitle;
}): Promise<{ candidates: FamilyCandidate[] } | { error: string }> {
  const mood = movieNightMood(asked);
  const count = size ?? mood.count;
  try {
    const cards = await getListCards({ groupId, userId });
    const listPool: PoolItem[] = suggestionsOnly
      ? []
      : cards
          .filter(isToWatch)
          .filter((card) => fitsMood(card, mood))
          .map((card) => ({
            mediaType: card.media.media_type,
            tmdbId: card.media.tmdb_id,
            mediaId: card.media.id,
            listItemId: card.item.id,
            details: null,
          }));

    const listShare = Math.max(0, count - MIN_SUGGESTIONS);
    const slots = suggestionsOnly ? count : count - Math.min(listPool.length, listShare);
    const found = await collectSuggestions({
      mood,
      seed,
      exclude: new Set([...cards.map(listKey), ...exclude]),
      wanted: slots,
      like,
    });
    const suggestions: PoolItem[] = found.map((details) => ({
      mediaType: details.mediaType,
      tmdbId: details.tmdbId,
      mediaId: null,
      listItemId: null,
      details,
    }));

    const deck = composeDeck({ list: listPool, suggestions, size: count, seed });
    if (deck.length < MIN_STACK_SIZE) return { error: like ? NOT_ENOUGH_LIKE : NOT_ENOUGH_MOVIES };

    const saved = await saveMediaMany(
      deck.flatMap(({ card }) => (card.details ? [detailsToMediaRow(card.details)] : [])),
    );
    if ("error" in saved) return saved;

    const candidates = deck.map(({ card, origin }) => ({
      media_id: card.mediaId ?? saved.get(cardKey(card)) ?? "",
      list_item_id: card.listItemId,
      origin,
    }));
    if (candidates.some((c) => !c.media_id)) {
      return { error: "Couldn't save these titles. Please try again later." };
    }
    return { candidates };
  } catch (error) {
    console.error("Building a family stack failed:", error);
    return { error: TMDB_DOWN };
  }
}
