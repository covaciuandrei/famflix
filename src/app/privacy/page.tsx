import type { Metadata } from "next";

import { ContactLink, LegalPage, Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy — FamFlix",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="October 9, 2026"
      intro={
        <p>
          FamFlix is a small, private watchlist for families and friends, run
          by Andrei Covaciu (<ContactLink />
          ). This page explains what it stores, who can see it, and how to
          delete it.
        </p>
      }
    >
      <Section title="What FamFlix stores">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-foreground">Your account:</strong> you
            sign in with Google, which shares your name, email address and
            profile picture with FamFlix. FamFlix never sees your Google
            password or anything else in your Google account.
          </li>
          <li>
            <strong className="text-foreground">What you add:</strong> the
            titles on your lists (a title your family logs as watched together
            with you is also added to your personal list, which only you can
            see), the episodes you tick on a series (with your own score and
            note for each, kept on your personal list), your scores, notes,
            likes and dislikes, who watched what and when, the families you
            belong to, and a history of
            family activity (for example &ldquo;Ana added Dune&rdquo;; each
            family keeps its latest 500 events).
          </li>
          <li>
            <strong className="text-foreground">Movie nights:</strong> when a
            family starts a movie night, the titles it shows, who took part,
            how each person voted (nope, yes, love or seen it) and what was
            picked. Every night stays in the family&apos;s history. Swiping on
            your own (Discover) stores nothing except the titles you put on My
            list.
          </li>
          <li>
            <strong className="text-foreground">Counters:</strong> how often
            you add titles, search, try invite codes or start movie nights,
            kept for a day, to stop abuse.
          </li>
        </ul>
        <p>
          FamFlix uses this only to run the watchlist for you and your
          families.
        </p>
      </Section>

      <Section title="Who can see it">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Your personal list, with the episodes you tick on a series and
            your scores and notes for them, is visible only to you.
          </li>
          <li>
            Family lists, and your name, picture, scores, notes and reactions on
            them, are visible to the members of that family.
          </li>
          <li>
            Your votes in a family movie night stay private while you swipe.
            Once you finish a stack (or someone shows the results early), the
            other members of the family see them next to your name.
          </li>
          <li>
            FamFlix doesn&apos;t sell your data, show ads, or use analytics or
            tracking cookies.
          </li>
        </ul>
      </Section>

      <Section title="Where it's kept, and the services FamFlix uses">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-foreground">Supabase</strong> stores the
            data and handles sign-in, in the EU (Ireland).
          </li>
          <li>
            <strong className="text-foreground">Microsoft Azure</strong> hosts
            the website, in the EU (Netherlands).
          </li>
          <li>
            <strong className="text-foreground">Google</strong> handles
            sign-in. Profile pictures load from Google&apos;s servers.
          </li>
          <li>
            <strong className="text-foreground">
              The Movie Database (TMDB)
            </strong>{" "}
            supplies movie and series information. FamFlix never tells TMDB who
            you are, but posters and pictures load straight from TMDB&apos;s
            servers, which see your device&apos;s IP address like any site
            you load pictures from.
          </li>
          <li>
            <strong className="text-foreground">YouTube</strong> plays trailers.
            Nothing loads from YouTube until you press play; then it plays in
            YouTube&apos;s privacy-enhanced mode and may set its own cookies.
          </li>
        </ul>
      </Section>

      <Section title="Cookies and browser storage">
        <p>
          FamFlix only uses the cookies needed to keep you signed in, so it
          doesn&apos;t ask for cookie consent. Your browser also remembers two
          settings for FamFlix: your theme and whether you&apos;ve seen the
          welcome tour. These stay on your device.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          You can change your name in Settings, remove titles, delete your
          scores and notes, and leave a family at any time (which also removes
          your votes from a movie night that is still going).
        </p>
        <p>
          <strong className="text-foreground">
            Settings → Account → Delete account
          </strong>{" "}
          deletes your account right away, with your personal list (and the
          episodes you ticked) and your scores, notes, likes and dislikes. Families you shared keep the
          titles you added to their lists, without your name, and your name is
          removed from their activity history. Your votes in movie nights go
          too; the nights themselves stay in the family&apos;s history. If
          database backups are kept, deleted data drops out of them within 7
          days.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask for a copy of your data, or have it corrected or
          deleted, by writing to <ContactLink />. You can also complain to your
          data protection authority (in Romania, the ANSPDCP).
        </p>
      </Section>
    </LegalPage>
  );
}
