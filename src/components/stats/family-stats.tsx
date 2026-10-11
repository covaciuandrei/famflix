import Link from "next/link";

import { formatMonth, formatRuntime, formatScore } from "@/lib/format";
import { chartBars, familyShareText, MIN_SHARED_FOR_TASTE, type FamilyStats, type Period } from "@/lib/stats";

import { BarChart, BarList, Fact, Nothing, StatCard, StatTile, StatTiles, YearPicker } from "./parts";
import { ShareStats } from "./share-stats";

const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a family watched in a year (or ever): the numbers, the favourites, who watched what and whose taste is alike. */
export function FamilyStatsView({ stats, years, groupId }: { stats: FamilyStats; years: number[]; groupId: string }) {
  const href = (period: Period) => `/app/family/${groupId}?view=stats&year=${period ?? "all"}`;
  const bars = chartBars(stats.byMonth, stats.period);

  return (
    <div className="flex flex-col gap-4">
      <YearPicker years={years} period={stats.period} href={href} />

      {stats.titles === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="font-medium">
            {stats.period === null ? "Nothing watched together yet." : `Nothing watched together in ${stats.period}.`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Log a title with Watched together on the list, or pick one on{" "}
            <Link href={`/app/movie-night?who=${groupId}`} className="underline underline-offset-2 hover:text-foreground">
              Movie night
            </Link>
            , and it shows up here.
          </p>
        </div>
      ) : (
        <>
          <StatTiles>
            <StatTile value={stats.titles} label="Titles watched" />
            <StatTile value={stats.viewings} label="Viewings" />
            <StatTile value={formatRuntime(stats.minutes)} label="Movie time" hint="Series aren't counted" />
            <StatTile value={stats.nights} label="Movie nights" />
          </StatTiles>

          <div className="grid gap-4 md:grid-cols-2">
            <StatCard id="stats-top" title="Top 5">
              {stats.top.length === 0 ? (
                <Nothing>No scores yet. Rate what you watch and the best of it shows up here.</Nothing>
              ) : (
                <ol className="flex flex-col gap-2">
                  {stats.top.map((entry, i) => (
                    <li key={`${i}-${entry.title}`} className="flex items-baseline gap-3">
                      <span aria-hidden className="w-4 text-sm text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatScore(entry.average)}
                        <span className="text-sm text-muted-foreground"> · {times(entry.scores, "score", "scores")}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </StatCard>

            <StatCard id="stats-genres" title="Favourite genres">
              {stats.genres.length === 0 ? (
                <Nothing>No genres to show.</Nothing>
              ) : (
                <BarList
                  items={stats.genres.map((g) => ({
                    key: g.genre,
                    label: g.genre,
                    value: g.titles,
                    text: times(g.titles, "title", "titles"),
                  }))}
                />
              )}
            </StatCard>

            <StatCard id="stats-highlights" title="Highlights">
              {!stats.mostLoved && !stats.mostDivisive && !stats.busiestMonth ? (
                <Nothing>Likes and scores will show the favourites here.</Nothing>
              ) : (
                <dl className="flex flex-col gap-3">
                  {stats.mostLoved && (
                    <Fact label="Most loved">
                      {stats.mostLoved.title}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {times(stats.mostLoved.likes, "like", "likes")}
                      </span>
                    </Fact>
                  )}
                  {stats.mostDivisive && (
                    <Fact label="Most divisive">
                      {stats.mostDivisive.title}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · scores from {formatScore(stats.mostDivisive.low)} to {formatScore(stats.mostDivisive.high)}
                      </span>
                    </Fact>
                  )}
                  {stats.busiestMonth && (
                    <Fact label="Busiest month">
                      {formatMonth(stats.busiestMonth.month)}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {times(stats.busiestMonth.viewings, "viewing", "viewings")}
                      </span>
                    </Fact>
                  )}
                </dl>
              )}
            </StatCard>

            <StatCard id="stats-again" title="Watched again">
              {stats.rewatched.length === 0 ? (
                <Nothing>Nothing watched more than once.</Nothing>
              ) : (
                <ul className="flex flex-col gap-2">
                  {stats.rewatched.map((entry, i) => (
                    <li key={`${i}-${entry.title}`} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{entry.title}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{entry.times} times</span>
                    </li>
                  ))}
                </ul>
              )}
            </StatCard>

            <StatCard id="stats-people" title="Who watched what">
              {stats.people.length === 0 ? (
                <Nothing>Nobody is on the viewings yet.</Nothing>
              ) : (
                <BarList
                  items={stats.people.map((p) => ({
                    key: p.id,
                    label: p.name,
                    value: p.viewings,
                    text: `${times(p.viewings, "viewing", "viewings")} · ${times(p.titles, "title", "titles")}`,
                  }))}
                />
              )}
            </StatCard>

            <StatCard id="stats-taste" title="Taste">
              {stats.closest ? (
                <dl className="flex flex-col gap-3">
                  <Fact label="Closest taste">
                    {stats.closest.a} &amp; {stats.closest.b}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {stats.closest.match}% alike · {times(stats.closest.shared, "title", "titles")} scored by both
                    </span>
                  </Fact>
                  {stats.farthest && (
                    <Fact label="Most different">
                      {stats.farthest.a} &amp; {stats.farthest.b}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {stats.farthest.match}% alike · {times(stats.farthest.shared, "title", "titles")} scored by both
                      </span>
                    </Fact>
                  )}
                </dl>
              ) : (
                <Nothing>
                  Taste shows up once two of you have scored at least {MIN_SHARED_FOR_TASTE} of the same titles.
                </Nothing>
              )}
              <p className="text-xs text-muted-foreground">
                How alike two people score the titles they both rated: 100% is the same score every time.
              </p>
            </StatCard>
          </div>

          {bars.length > 0 && (
            <StatCard id="stats-months" title={stats.period === null ? "Viewings by year" : "Viewings by month"}>
              <BarChart bars={bars} one="viewing" many="viewings" />
            </StatCard>
          )}

          <ShareStats text={familyShareText(stats)} />
        </>
      )}
    </div>
  );
}
