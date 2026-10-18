/**
 * The watch-history CSV of "Download my data": one row for every time someone watched something, built from the JSON
 * document export_my_data() returns. Pure and client-safe, so it is unit tested without a server.
 *
 * A row is a viewing: the day, what it was (a movie, a series, or one episode of one), where (My list, or the family it
 * was with), who with, and the person's own score and note. The same viewing often turns up twice in the document (once
 * on My list, once in the family's list); those are merged.
 */

export type ExportFormat = "json" | "csv";

interface ExportEntry {
  title: string;
  type: "movie" | "tv";
  tmdb_id: number;
  year: number | null;
}

interface ExportEpisode {
  season: number;
  episode: number;
  watched_on: string | null;
  score: number | null;
  note: string | null;
}

/** What the CSV reads of the document; everything else in it is for the JSON. Any part may be missing. */
export interface ExportDocument {
  my_list?: (ExportEntry & {
    status: string;
    watched_at: string | null;
    my_score: number | null;
    my_note: string | null;
    watched_with: { family: string; people: string[] } | null;
    episodes?: ExportEpisode[];
    earlier_episode_viewings?: ExportEpisode[];
  })[];
  watch_history?: (ExportEntry & { watched_on: string | null; family: string | null })[];
  family_lists?: {
    family: string | null;
    titles?: (ExportEntry & { i_watched_on: string | null; my_score: number | null; my_note: string | null })[];
  }[];
}

export interface Viewing {
  /** YYYY-MM-DD, or empty when nobody remembers it. */
  date: string;
  kind: "movie" | "series" | "episode";
  title: string;
  season: number | null;
  episode: number | null;
  year: number | null;
  /** "My list", or the family's name. */
  where: string;
  with: string[];
  score: number | null;
  note: string | null;
}

export const MY_LIST = "My list";

const day = (value: string | null | undefined): string => (value ? value.slice(0, 10) : "");

/** Every viewing in the document, oldest first, with the ones that are the same viewing merged. */
export function viewingsOf(doc: ExportDocument): Viewing[] {
  const found = new Map<string, Viewing>();
  let undated = 0;
  const add = (v: Viewing, tmdbId: number) => {
    // Nothing says two viewings with no day are the same one, so they are never merged.
    const key = [v.kind === "episode" ? "series" : v.kind, tmdbId, v.season ?? "", v.episode ?? "", v.date || `none${undated++}`].join("|");
    const have = found.get(key);
    if (!have) {
      found.set(key, v);
      return;
    }
    // The same viewing seen from two lists: keep the family it was with, who was there, and any score or note.
    if (have.where === MY_LIST && v.where !== MY_LIST) have.where = v.where;
    have.with = [...new Set([...have.with, ...v.with])];
    have.score ??= v.score;
    have.note ??= v.note;
  };
  const kindOf = (type: "movie" | "tv"): "movie" | "series" => (type === "tv" ? "series" : "movie");

  for (const entry of doc.my_list ?? []) {
    const episodes = [...(entry.episodes ?? []), ...(entry.earlier_episode_viewings ?? [])];
    for (const e of episodes) {
      add(
        {
          date: day(e.watched_on),
          kind: "episode",
          title: entry.title,
          season: e.season,
          episode: e.episode,
          year: entry.year,
          where: MY_LIST,
          with: [],
          score: e.score,
          note: e.note,
        },
        entry.tmdb_id,
      );
    }
    // A series with ticked episodes is told by its episodes; one marked Watched without any, or a movie, by one row.
    if (entry.status === "watched" && episodes.length === 0) {
      add(
        {
          date: day(entry.watched_at),
          kind: kindOf(entry.type),
          title: entry.title,
          season: null,
          episode: null,
          year: entry.year,
          where: entry.watched_with?.family ?? MY_LIST,
          with: entry.watched_with?.people ?? [],
          score: entry.my_score,
          note: entry.my_note,
        },
        entry.tmdb_id,
      );
    }
  }

  for (const h of doc.watch_history ?? []) {
    add(
      {
        date: day(h.watched_on),
        kind: kindOf(h.type),
        title: h.title,
        season: null,
        episode: null,
        year: h.year,
        where: h.family ?? MY_LIST,
        with: [],
        score: null,
        note: null,
      },
      h.tmdb_id,
    );
  }

  for (const list of doc.family_lists ?? []) {
    for (const t of list.titles ?? []) {
      if (!t.i_watched_on) continue;
      add(
        {
          date: day(t.i_watched_on),
          kind: kindOf(t.type),
          title: t.title,
          season: null,
          episode: null,
          year: t.year,
          where: list.family ?? MY_LIST,
          with: [],
          score: t.my_score,
          note: t.my_note,
        },
        t.tmdb_id,
      );
    }
  }

  return [...found.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.title.localeCompare(b.title) ||
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? 0) - (b.episode ?? 0),
  );
}

/**
 * One cell of a CSV. A cell that starts with = + - or @ (or a tab or line break) is a formula to a spreadsheet, and a
 * title or a note is typed by people, so such a cell gets an apostrophe in front and is read as text. Cells with a comma,
 * a quote or a line break are quoted, the quotes in them doubled (RFC 4180).
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const CSV_HEADER = ["date", "kind", "title", "season", "episode", "year", "where", "with", "score", "note"];

/** The viewings as CSV text: a header row, then one row each, lines ending in CRLF. */
export function toCsv(viewings: readonly Viewing[]): string {
  const rows = viewings.map((v) =>
    [v.date, v.kind, v.title, v.season, v.episode, v.year, v.where, v.with.join(", "), v.score, v.note]
      .map(csvCell)
      .join(","),
  );
  return [CSV_HEADER.join(","), ...rows].map((line) => `${line}\r\n`).join("");
}

/** "famflix-data-2026-10-12.json": the file a download is saved as. */
export function exportFileName(format: ExportFormat, on: Date): string {
  return `famflix-data-${on.toISOString().slice(0, 10)}.${format}`;
}
