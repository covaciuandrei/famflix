import type { MouseEvent, PointerEvent } from "react";

/**
 * Opens a modal <dialog> with focus on the dialog itself rather than its first field,
 * so no caret blinks and no phone keyboard pops up. The dialog needs tabIndex={-1}.
 */
export function openModal(dialog: HTMLDialogElement | null) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  dialog.focus();
}

// Clicks on the dimmed backdrop are reported on the <dialog> itself, outside its box.
function onBackdrop(e: MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false;
  const r = e.currentTarget.getBoundingClientRect();
  return (
    e.clientX < r.left ||
    e.clientX > r.right ||
    e.clientY < r.top ||
    e.clientY > r.bottom
  );
}

/**
 * Spread on a modal <dialog>: a click or tap on the backdrop closes it. The press must
 * start on the backdrop too, so dragging out of a text field doesn't close it.
 */
export const closeOnBackdrop = {
  onPointerDown(e: PointerEvent<HTMLDialogElement>) {
    e.currentTarget.dataset.backdropPress = onBackdrop(e) ? "true" : "";
  },
  onClick(e: MouseEvent<HTMLDialogElement>) {
    const startedOnBackdrop = e.currentTarget.dataset.backdropPress === "true";
    e.currentTarget.dataset.backdropPress = "";
    if (startedOnBackdrop && onBackdrop(e)) e.currentTarget.close();
  },
};
