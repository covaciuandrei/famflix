import type { NextConfig } from "next";

const securityHeaders = [
  // Nobody may show the app inside a frame on their own site (clickjacking).
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // The browser tests build into .next-e2e (scripts/e2e.sh), so they never replace a normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
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
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // A guest link is a secret: it mustn't be indexed or travel to other sites in a Referer header (a later entry
      // overrides an earlier one for the same header).
      {
        source: "/guest/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
