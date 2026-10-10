import type { MetadataRoute } from "next";

import { APP_HOME } from "@/lib/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FamFlix — family watchlist",
    short_name: "FamFlix",
    description: "Track the movies and series you watch together.",
    start_url: APP_HOME,
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
