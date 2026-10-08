import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeWatcher } from "@/components/theme";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FamFlix — your family watchlist",
  description:
    "Track the movies and series you watch together. Shared family and personal watchlists, ratings and reactions.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The theme script sets data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground min-h-full flex flex-col">
        <ThemeWatcher />
        {children}
      </body>
    </html>
  );
}
