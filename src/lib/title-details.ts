/**
 * What a title's page shows besides the basics, read from TMDB's answer for it: the top-billed cast, who directed it (or
 * created it), the age rating and the collection it belongs to. Pure and client-safe, so it is unit tested with answers
 * shaped like TMDB's. The calls themselves, and the titles TMDB recommends, are in lib/tmdb.ts.
 */

import type { MediaType } from "@/lib/types";

/** The parts of `credits` this reads. */
export interface RawCredits {
  cast?: { id?: number; name?: string; character?: string; profile_path?: string | null; order?: number }[];
  crew?: { id?: number; name?: string; job?: string }[];
}

/** `release_dates` of a movie: for each country, the certifications of its releases (type 3 is the cinema release). */
export interface RawReleaseDates {
  results?: { iso_3166_1?: string; release_dates?: { certification?: string; type?: number }[] }[];
}

/** `content_ratings` of a series: for each country, its rating. */
export interface RawContentRatings {
  results?: { iso_3166_1?: string; rating?: string }[];
}

/** The parts of TMDB's answer for a title that this reads. */
export interface RawTitleExtras {
  credits?: RawCredits;
  /** A series' creators. */
  created_by?: { id?: number; name?: string }[];
  release_dates?: RawReleaseDates;
  content_ratings?: RawContentRatings;
  belongs_to_collection?: { id?: number; name?: string } | null;
}

export interface CastMember {
  id: number;
  name: string;
  /** The part they play, when TMDB says. */
  character: string | null;
  profilePath: string | null;
}

export interface TitleExtras {
  cast: CastMember[];
  /** "Director" or "Created by" and the names (a movie's directors, a series' creators); null when TMDB lists none. */
  credit: { label: string; names: string[] } | null;
  /** The age rating, like "PG-13" or "15"; null when there is none. */
  certification: string | null;
  /** The collection (a series of films) it is part of. */
  collection: { id: number; name: string } | null;
}

/** How many of the cast a title's page shows. */
export const MAX_CAST = 12;
const MAX_CREDITS = 3;

const clean = (value: unknown, max = 100): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text === "" ? null : text;
};

/** The top-billed cast, in TMDB's order (the order of the credits), with the people it lists no name for left out. */
export function topCast(credits: RawCredits | undefined, limit = MAX_CAST): CastMember[] {
  const cast = (credits?.cast ?? [])
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => Number.isInteger(member.id) && clean(member.name) !== null)
    .sort((a, b) => (a.member.order ?? a.index) - (b.member.order ?? b.index) || a.index - b.index);
  const seen = new Set<number>();
  const people: CastMember[] = [];
  for (const { member } of cast) {
    if (seen.has(member.id as number)) continue;
    seen.add(member.id as number);
    people.push({
      id: member.id as number,
      name: clean(member.name) as string,
      character: clean(member.character),
      profilePath: typeof member.profile_path === "string" && member.profile_path.startsWith("/") ? member.profile_path : null,
    });
    if (people.length >= limit) break;
  }
  return people;
}

/** Who directed a movie (its crew's directors), or created a series (TMDB lists its creators); each name once. */
export function creditOf(mediaType: MediaType, raw: RawTitleExtras): TitleExtras["credit"] {
  const found =
    mediaType === "tv"
      ? (raw.created_by ?? []).map((person) => clean(person.name))
      : (raw.credits?.crew ?? []).filter((person) => person.job === "Director").map((person) => clean(person.name));
  const names = [...new Set(found.filter((name): name is string => name !== null))].slice(0, MAX_CREDITS);
  if (names.length === 0) return null;
  const label = mediaType === "tv" ? "Created by" : "Directed by";
  return { label, names };
}

// Countries whose rating is shown: the American one, else the British one.
const COUNTRIES = ["US", "GB"];
// A movie's release types, the cinema release first (3), then a limited one (2), digital (4), physical (5), a premiere
// (1) and television (6).
const RELEASE_ORDER = [3, 2, 4, 5, 1, 6];

const releaseRank = (type: number | undefined): number => {
  const rank = RELEASE_ORDER.indexOf(type ?? -1);
  return rank === -1 ? RELEASE_ORDER.length : rank;
};

/** The age rating: the American one, else the British one; a movie's from its cinema release when it has one. */
export function pickCertification(mediaType: MediaType, raw: RawTitleExtras): string | null {
  for (const country of COUNTRIES) {
    if (mediaType === "tv") {
      const rating = clean(raw.content_ratings?.results?.find((r) => r.iso_3166_1 === country)?.rating, 12);
      if (rating) return rating;
      continue;
    }
    const releases = (raw.release_dates?.results?.find((r) => r.iso_3166_1 === country)?.release_dates ?? [])
      .map((release, index) => ({ certification: clean(release.certification, 12), rank: releaseRank(release.type), index }))
      .filter((release) => release.certification !== null)
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    if (releases.length > 0) return releases[0].certification;
  }
  return null;
}

/** The collection a movie belongs to, when it does. */
export function collectionRef(raw: RawTitleExtras): TitleExtras["collection"] {
  const collection = raw.belongs_to_collection;
  const name = clean(collection?.name);
  if (!collection || !Number.isInteger(collection.id) || (collection.id as number) <= 0 || !name) return null;
  return { id: collection.id as number, name };
}

/** Everything of this kind from TMDB's answer for a title (asked for with `credits` and the release dates or ratings). */
export function titleExtrasFrom(mediaType: MediaType, raw: RawTitleExtras): TitleExtras {
  return {
    cast: topCast(raw.credits),
    credit: creditOf(mediaType, raw),
    certification: pickCertification(mediaType, raw),
    collection: mediaType === "movie" ? collectionRef(raw) : null,
  };
}
