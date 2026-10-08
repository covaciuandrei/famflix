import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // TMDB already serves each poster at the size we ask for, so the browser loads it from TMDB directly.
    // That keeps the server's image decoder (and its security bugs) out of reach of the public.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
};

export default nextConfig;
