import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeWatcher } from "@/components/theme";
import { UiPreviewSwitch } from "@/components/ui-preview-switch";
import { THEME_SCRIPT } from "@/lib/theme";
import { UI_PREVIEW_SCRIPT } from "@/lib/ui-preview";
import "./globals.css";
import "./ui-preview.css";

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
  const uiPreview = process.env.FAMFLIX_UI_PREVIEW === "1";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-ui-version={uiPreview ? "original" : undefined}
      // Theme and preview preferences are applied before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {uiPreview && <script dangerouslySetInnerHTML={{ __html: UI_PREVIEW_SCRIPT }} />}
      </head>
      <body className="bg-background text-foreground min-h-full flex flex-col">
        <ThemeWatcher />
        {uiPreview && <UiPreviewSwitch />}
        {children}
      </body>
    </html>
  );
}
