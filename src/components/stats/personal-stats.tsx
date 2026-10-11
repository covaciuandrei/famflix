import { formatMonth, formatRuntime, formatScore } from "@/lib/format";
import { chartBars, personalShareText, type Period, type PersonalStats } from "@/lib/stats";

import { BarChart, BarList, Fact, Nothing, StatCard, StatTile, StatTiles, YearPicker } from "./parts";
import { ShareStats } from "./share-stats";

const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const href = (period: Period) => `/app/mine/stats?year=${period ?? "all"}`;

/** What a person watched in a year (or ever): how much, what they scored, what they like, and what they watched again. */
export function PersonalStatsView({ stats, years }: { stats: PersonalStats; years: number[] }) {
  const bars = chartBars(stats.byMonth, stats.period);
  const kinds = [
    stats.movies > 0 ? times(stats.movies, "movie", "movies") : null,
    stats.series > 0 ? `${stats.series} series` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <YearPicker years={years} period={stats.period} href={href} />

      {stats.titles === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="font-medium">{stats.period === null ? "Nothing watched yet." : `Nothing watched in ${stats.period}.`}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Mark a title as watched, tick the episodes of a series, or log one with your family, and it shows up here.
          </p>
        </div>
      ) : (
        <>
          <StatTiles>
            <StatTile value={stats.titles} label="Titles watched" hint={kinds.join(" · ")} />
            <StatTile value={stats.viewings} label="Viewings" hint="Movies and family watches" />
            <StatTile value={stats.episodes} label="Episodes" hint="Of series on My list" />
            <StatTile value={formatRuntime(stats.minutes)} label="Time watched" hint="Movies and episodes" />
          </StatTiles>

          <div className="grid gap-4 md:grid-cols-2">
            <StatCard id="stats-top" title="Your top 5">
              {stats.top.length === 0 ? (
                <Nothing>No scores yet. Score what you watch and your favourites show up here.</Nothing>
              ) : (
                <ol className="flex flex-col gap-2">
                  {stats.top.map((entry, i) => (
                    <li key={`${i}-${entry.title}`} className="flex items-baseline gap-3">
                      <span aria-hidden className="w-4 text-sm text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
                      <span className="shrink-0 tabular-nums">{formatScore(entry.score)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </StatCard>

            <StatCard id="stats-scores" title="Your scores">
              {stats.scores ? (
                <dl className="flex flex-col gap-3">
                  <Fact label="Average">
                    {formatScore(stats.scores.average)}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {times(stats.scores.count, "score", "scores")}
                    </span>
                  </Fact>
                  <Fact label="Lowest">{formatScore(stats.scores.low)}</Fact>
                  <Fact label="Highest">{formatScore(stats.scores.high)}</Fact>
                </dl>
              ) : (
                <Nothing>You haven&apos;t scored anything you watched {stats.period === null ? "yet" : `in ${stats.period}`}.</Nothing>
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
          </div>

          {stats.busiestMonth && bars.length > 0 && (
            <StatCard id="stats-months" title={stats.period === null ? "Watched by year" : "Watched by month"}>
              <p className="text-sm text-muted-foreground">
                Busiest month:{" "}
                <span className="font-medium text-foreground">
                  {formatMonth(stats.busiestMonth.month)} · {times(stats.busiestMonth.viewings, "viewing or episode", "viewings and episodes")}
                </span>
              </p>
              <BarChart bars={bars} one="viewing or episode" many="viewings and episodes" />
            </StatCard>
          )}

          <ShareStats text={personalShareText(stats)} />
        </>
      )}
    </div>
  );
}
