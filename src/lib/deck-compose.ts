import { cardKey, MIN_SUGGESTIONS } from "@/lib/movie-night";
import { seededShuffle } from "@/lib/random";
import type { MediaType } from "@/lib/types";

interface Keyed {
  mediaType: MediaType;
  tmdbId: number;
}

/** Round-robin across several lists, so the first cards are varied instead of all one genre. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) result.push(list[i]);
    }
  }
  return result;
}

function unique<T extends Keyed>(cards: readonly T[], taken: Set<string>): T[] {
  return cards.filter((card) => {
    const key = cardKey(card);
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
}

/**
 * Builds a stack of `size` cards from the titles on a list and suggestions from TMDB. Up to `size - 5` come from the
 * list (random ones if there are more, but the titles in `first` are taken before any other: the ones put back on the
 * list to watch again); suggestions fill the rest, so a short list still gives a full stack with at least 5
 * suggestions. If the suggestions fall short, leftover list titles top it up. A title on both counts as a list title,
 * and nothing appears twice.
 */
export function composeDeck<T extends Keyed>(input: {
  list: readonly T[];
  suggestions: readonly T[];
  size: number;
  seed: number;
  minSuggestions?: number;
  /** Titles of `list` that lead the list's share. */
  first?: readonly Keyed[];
}): { card: T; origin: "list" | "suggested" }[] {
  const { size, seed } = input;
  const listShare = Math.max(0, size - (input.minSuggestions ?? MIN_SUGGESTIONS));
  const taken = new Set<string>();
  const list = unique(input.list, taken);
  const firstKeys = new Set((input.first ?? []).map(cardKey));
  const listPool = [
    ...seededShuffle(list.filter((card) => firstKeys.has(cardKey(card))), seed),
    ...seededShuffle(list.filter((card) => !firstKeys.has(cardKey(card))), seed),
  ];
  const suggestionPool = unique(input.suggestions, taken);

  const fromList = listPool.slice(0, listShare);
  const fromSuggestions = suggestionPool.slice(0, size - fromList.length);
  const missing = size - fromList.length - fromSuggestions.length;
  if (missing > 0) {
    fromList.push(...listPool.slice(fromList.length, fromList.length + missing));
  }

  return [
    ...fromList.map((card) => ({ card, origin: "list" as const })),
    ...fromSuggestions.map((card) => ({ card, origin: "suggested" as const })),
  ];
}
