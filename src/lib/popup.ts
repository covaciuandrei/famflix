/**
 * Runs `open` once no dialog is showing: right away when none is, otherwise when the one that is open closes. So a
 * popup that opens by itself (a movie night invite, a rating request) never lands on top of something the person is
 * in the middle of, and several waiting ones come one after the other. Returns a function that stops waiting.
 */
export function whenNoModalOpen(open: () => void): () => void {
  const busy = () => document.querySelector("dialog[open]") !== null;
  if (!busy()) {
    open();
    return () => {};
  }
  const check = () => {
    if (!busy()) {
      stop();
      open();
    }
  };
  // A dialog that is taken out of the page without closing sends no event, so look now and then as well.
  const timer = window.setInterval(check, 1000);
  document.addEventListener("close", check, true);
  function stop() {
    window.clearInterval(timer);
    document.removeEventListener("close", check, true);
  }
  return stop;
}
