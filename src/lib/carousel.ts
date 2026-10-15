/** The measurements of a horizontally scrolling row, as the browser reports them. */
export type RowMetrics = { scrollLeft: number; clientWidth: number; scrollWidth: number };

/** Browsers report fractional positions on scaled screens, so being a pixel short of an edge counts as being at it. */
const EDGE_SLACK = 1;

/** Which way there is still something to scroll to; the previous/next arrows show only for these. */
export function scrollReach({ scrollLeft, clientWidth, scrollWidth }: RowMetrics) {
  return {
    back: scrollLeft > EDGE_SLACK,
    forward: scrollLeft + clientWidth < scrollWidth - EDGE_SLACK,
  };
}

/** How far from its end a row that keeps loading starts to fetch more, in widths of the row: before the end comes, not at it. */
const LOOK_AHEAD = 1.5;

/**
 * Once somebody has scrolled a row it keeps this many cards ahead of them. A page is twenty cards and takes a moment
 * to come, which a quick run of clicks on the arrow, or a fling on a phone, gets through: so the next page is asked for
 * while two pages' worth are still to be scrolled, and the one after that when the first of those arrives.
 */
export const CARDS_AHEAD = 40;

/**
 * Whether a row is scrolled close enough to its end for the titles after it to be fetched (a row that fits is at its
 * end). Nobody has scrolled it yet when `engaged` is false, and then it waits until it has to: a row that is only looked
 * at doesn't load more than it shows. `pitch` is the distance from one card to the next. A row that is not laid out,
 * such as a hidden one, never is near its end.
 */
export function nearEnd(
  { scrollLeft, clientWidth, scrollWidth }: RowMetrics,
  { engaged = false, pitch = 0 }: { engaged?: boolean; pitch?: number } = {},
) {
  if (clientWidth <= 0) return false;
  const ahead = Math.max(clientWidth * LOOK_AHEAD, engaged ? pitch * CARDS_AHEAD : 0);
  return scrollWidth - (scrollLeft + clientWidth) <= ahead;
}

/**
 * Where one click on an arrow scrolls to: a page of whole cards, so the first card in view lines up with the row's edge
 * again even after a free scroll. `pitch` is the distance from one card to the next (width plus gap); without a usable
 * one (a single card, or one wider than the row) it moves most of the visible width instead.
 */
export function pageTarget(row: RowMetrics, direction: -1 | 1, pitch: number) {
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  const wholeCards = pitch > 0 && pitch <= row.clientWidth;
  const wanted = wholeCards
    ? Math.round((row.scrollLeft + direction * Math.floor(row.clientWidth / pitch) * pitch) / pitch) * pitch
    : row.scrollLeft + direction * row.clientWidth * 0.8;
  return Math.min(max, Math.max(0, wanted));
}
