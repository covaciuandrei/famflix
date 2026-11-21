"use client";

import { useSyncExternalStore } from "react";

import { readUiVersion, setUiVersion, UI_VERSION_CHANGE } from "@/lib/ui-preview";

function subscribe(onChange: () => void) {
  window.addEventListener(UI_VERSION_CHANGE, onChange);
  return () => window.removeEventListener(UI_VERSION_CHANGE, onChange);
}

export function UiPreviewSwitch() {
  const version = useSyncExternalStore(subscribe, readUiVersion, () => "original");

  return (
    <div role="group" aria-label="Compare designs" className="ui-preview-switch">
      <span>Design preview</span>
      <button type="button" aria-pressed={version === "original"} onClick={() => setUiVersion("original")}>
        Original
      </button>
      <button type="button" aria-pressed={version === "v2"} onClick={() => setUiVersion("v2")}>
        V2
      </button>
    </div>
  );
}
