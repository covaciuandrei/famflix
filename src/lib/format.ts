/** Small pure formatting helpers, safe for both server and client. */

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

/**
 * A profile photo worth loading: Google's own (https, on googleusercontent.com), which is what signing in gives
 * everybody. Any other address would send other people's browsers to a server they didn't choose, so it shows the
 * initials instead.
 */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol, hostname, href } = new URL(url);
    const google = hostname === "googleusercontent.com" || hostname.endsWith(".googleusercontent.com");
    return protocol === "https:" && google ? href : null;
  } catch {
    return null;
  }
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "–";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** 95 -> "1 h 35 min", 120 -> "2 h", 45 -> "45 min". */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-03" -> "March 2026", identical on server and client. */
export function formatMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_NAMES[number - 1] ?? "?"} ${year}`;
}

/** 3 -> "Mar", for the months of a chart. */
export function shortMonth(number: number): string {
  return MONTHS[number - 1] ?? "?";
}

/** "2026-10-03" -> "Oct 3, 2026", identical on server and client (no time-zone or locale shifts). */
export function formatDay(isoDate: string | null): string {
  if (isoDate === null) return "Date unknown";
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** "2026-10-09" -> "09.10.2026". */
export function formatDayNumeric(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
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
