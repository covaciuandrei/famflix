import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy — FamFlix",
};

const CONTACT = "etticov@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12 text-sm leading-relaxed text-muted-foreground">
      <div className="flex flex-col gap-3">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          FamFlix
        </Link>
        <h1 className="text-3xl font-bold text-foreground">Privacy policy</h1>
        <p>Last updated: October 8, 2026</p>
        <p>
          FamFlix is a small, private watchlist for families and friends. This
          page explains what it stores and who can see it.
        </p>
      </div>

      <Section title="What FamFlix stores">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-foreground">Your account:</strong> your
            name, email address and, if you sign in with Google, your Google
            profile picture. Google only shares these basic details; FamFlix
            never sees your Google password or anything else in your Google
            account.
          </li>
          <li>
            <strong className="text-foreground">What you add:</strong> the
            titles on your lists, your scores, notes, likes and dislikes, who
            watched what and when, the families you belong to, and a history of
            family activity (for example &ldquo;Ana added Dune&rdquo;).
          </li>
        </ul>
      </Section>

      <Section title="Who can see it">
        <ul className="list-disc space-y-2 pl-5">
          <li>Your personal list is visible only to you.</li>
          <li>
            Family lists, and your name, picture, scores, notes and reactions on
            them, are visible to the members of that family.
          </li>
          <li>
            FamFlix doesn&apos;t sell your data, show ads, or use analytics or
            tracking cookies.
          </li>
        </ul>
      </Section>

      <Section title="Services FamFlix uses">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-foreground">Supabase</strong> stores the
            data and handles sign-in.
          </li>
          <li>
            <strong className="text-foreground">Microsoft Azure</strong> hosts
            the website.
          </li>
          <li>
            <strong className="text-foreground">Google</strong> handles
            &ldquo;Continue with Google&rdquo;; profile pictures load from
            Google&apos;s servers.
          </li>
          <li>
            <strong className="text-foreground">
              The Movie Database (TMDB)
            </strong>{" "}
            supplies movie and series information. FamFlix asks TMDB about
            titles, never about you.
          </li>
          <li>
            <strong className="text-foreground">YouTube</strong> provides the
            trailers on title pages, and may set its own cookies there.
          </li>
        </ul>
      </Section>

      <Section title="Cookies and browser storage">
        <p>
          FamFlix only uses the cookies needed to keep you signed in. Your
          browser also remembers two settings for FamFlix: your theme and
          whether you&apos;ve seen the welcome tour. These stay on your device.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You can change your display name in Settings, remove titles, delete
          your scores and notes, and leave a family at any time. To delete your
          account and everything linked to it, email{" "}
          <a
            href={`mailto:${CONTACT}`}
            className="text-foreground underline underline-offset-2"
          >
            {CONTACT}
          </a>
          .
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy:{" "}
          <a
            href={`mailto:${CONTACT}`}
            className="text-foreground underline underline-offset-2"
          >
            {CONTACT}
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
