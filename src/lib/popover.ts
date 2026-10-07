import type { ToggleEvent } from "react";

/** onBeforeToggle helper: pins an opening popover under `anchor` (above it if there's no room), inside the viewport. */
export function placePopover(
  e: ToggleEvent<HTMLElement>,
  anchor: () => HTMLElement | null,
  gap = 4,
) {
  if (e.newState !== "open") return;
  const popover = e.currentTarget;
  // Runs once the popover is shown but before it is painted, so it never flashes elsewhere.
  requestAnimationFrame(() => {
    const el = anchor();
    if (!el) return;
    const a = el.getBoundingClientRect();
    const p = popover.getBoundingClientRect();
    const fitsBelow = a.bottom + gap + p.height <= window.innerHeight;
    const top = fitsBelow
      ? a.bottom + gap
      : Math.max(gap, a.top - gap - p.height);
    const left = Math.min(
      Math.max(gap, a.right - p.width),
      window.innerWidth - p.width - gap,
    );
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  });
}
