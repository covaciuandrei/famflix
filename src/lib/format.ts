/** Small pure formatting helpers, safe for both server and client. */

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "–";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-03" -> "Oct 3, 2026", identical on server and client (no time-zone or locale shifts). */
export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. Render on the server only. */
export function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return formatDay(iso.slice(0, 10));
}

/** "5 h" or "40 min" until the given time, rounded up. Render on the server only. */
export function timeUntil(iso: string): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
}
