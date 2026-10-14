/**
 * Another person's My list, as the page for it shows it. Pure and client-safe, so the unit tests use the same rules.
 */
import type { MemberTitle } from "@/lib/types";

/** The day a title was watched, or null when it is not watched or no day is known. */
export function watchedDay(title: Pick<MemberTitle, "status" | "watched_at">): string | null {
  return title.status === "watched" && title.watched_at ? title.watched_at.slice(0, 10) : null;
}

/**
 * A list as its two tabs show it: what the person still wants to watch, as the list gives it (the newest first), and
 * what they have watched, the most recent first and those with no known day last.
 */
export function splitMemberList(titles: readonly MemberTitle[]): { toWatch: MemberTitle[]; watched: MemberTitle[] } {
  const toWatch = titles.filter((t) => t.status !== "watched");
  const watched = titles
    .map((title, order) => ({ title, order }))
    .filter(({ title }) => title.status === "watched")
    .sort((a, b) => {
      const [x, y] = [watchedDay(a.title), watchedDay(b.title)];
      if (x && y && x !== y) return y.localeCompare(x);
      if (x && !y) return -1;
      if (!x && y) return 1;
      return a.order - b.order;
    })
    .map(({ title }) => title);
  return { toWatch, watched };
}

export type MemberTab = "want" | "watched";

/** The tab asked for in the address: To watch unless it says Watched. */
export function memberTab(value: string | string[] | undefined): MemberTab {
  return value === "watched" ? "watched" : "want";
}
