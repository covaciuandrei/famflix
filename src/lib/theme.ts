// Colour theme: dark (the default design), light, or follow the device ("system").
// The choice is saved per device in localStorage; <html data-theme> holds the resolved theme.

export type ThemePreference = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "famflix:theme";
// Fired in this tab when the preference changes (the "storage" event only reaches other tabs).
export const THEME_CHANGE_EVENT = "famflix:theme-change";

// Browser UI colour (<meta name="theme-color">) per theme: the page background.
const THEME_COLORS = { dark: "#0b0b0f", light: "#f6f6f9" } as const;
const LIGHT_QUERY = "(prefers-color-scheme: light)";

// Runs in <head> before the first paint so a saved light theme never flashes dark. It also adds the
// theme-color meta: React doesn't render that tag, so hydration and navigations leave it alone.
// Must match readThemePreference() + applyTheme() below.
export const THEME_SCRIPT = `(function(){var t="dark";try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");if(p==="light"||(p==="system"&&matchMedia("${LIGHT_QUERY}").matches))t="light"}catch(e){}document.documentElement.dataset.theme=t;var m=document.createElement("meta");m.name="theme-color";m.content=t==="light"?"${THEME_COLORS.light}":"${THEME_COLORS.dark}";document.head.appendChild(m)})()`;

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "system") return saved;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return "dark";
}

function resolveTheme(preference: ThemePreference): "dark" | "light" {
  if (preference === "system") {
    return matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
  }
  return preference;
}

export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "dark") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the theme still changes for this visit.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}
