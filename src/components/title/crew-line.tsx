import type { TitleExtras } from "@/lib/title-details";

/** "Directed by Denis Villeneuve" or "Created by Craig Mazin"; nothing when TMDB lists nobody. */
export function CrewLine({ credit }: { credit: TitleExtras["credit"] }) {
  if (!credit) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {credit.label} <span className="font-medium text-foreground">{credit.names.join(", ")}</span>
    </p>
  );
}
