export type UiVersion = "original" | "v2";

export const DEFAULT_UI_VERSION = "v2";

const storageKey = "famflix:ui-version";

export const UI_VERSION_CHANGE = "famflix:ui-version-change";

// Apply a tab's saved selection before first paint, independent of its color theme.
export const UI_PREVIEW_SCRIPT = `(function(){try{if(sessionStorage.getItem("${storageKey}")==="original")document.documentElement.dataset.uiVersion="original"}catch{}})()`;

export function readUiVersion(): UiVersion {
  return document.documentElement.dataset.uiVersion === "original" ? "original" : DEFAULT_UI_VERSION;
}

export function setUiVersion(version: UiVersion) {
  try {
    sessionStorage.setItem(storageKey, version);
  } catch {
    // If storage is blocked, the current page can still switch designs.
  }
  document.documentElement.dataset.uiVersion = version;
  window.dispatchEvent(new Event(UI_VERSION_CHANGE));
}
