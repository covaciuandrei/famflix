/** The age rating ("PG-13", "TV-MA", "15") as a small outlined chip; nothing when there is none. */
export function AgeBadge({ certification }: { certification: string | null }) {
  if (!certification) return null;
  return (
    <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-xs font-medium text-foreground">
      <span className="sr-only">Age rating </span>
      {certification}
    </span>
  );
}
