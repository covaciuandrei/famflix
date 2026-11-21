import type { MetadataRoute } from "next";

import { APP_HOME } from "@/lib/constants";
import { THEME_COLORS } from "@/lib/theme";
import { DEFAULT_UI_VERSION } from "@/lib/ui-preview";

export default function manifest(): MetadataRoute.Manifest {
  const background = THEME_COLORS[DEFAULT_UI_VERSION].dark;
  return {
    name: "FamFlix — family watchlist",
    short_name: "FamFlix",
    description: "Track the movies and series you watch together.",
    start_url: APP_HOME,
    display: "standalone",
    background_color: background,
    theme_color: background,
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
