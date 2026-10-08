import type { Metadata } from "next";
import Link from "next/link";

import { ContactLink, LegalPage, Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms — FamFlix",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="October 8, 2026"
      intro={
        <p>
          These terms apply when you use FamFlix, a free watchlist for families
          and friends run by Andrei Covaciu (<ContactLink />
          ). By signing in you agree to them.
        </p>
      }
    >
      <Section title="Who can use FamFlix">
        <p>
          You need a Google account to sign in, and you must be at least 16, or
          use FamFlix with a parent&apos;s or guardian&apos;s permission. One
          account per person.
        </p>
      </Section>

      <Section title="Using it fairly">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Only share a family&apos;s invite code with people you want in that
            family. Its owner can remove members.
          </li>
          <li>
            Keep names and notes friendly and lawful. You&apos;re responsible
            for what you write; your family can read it.
          </li>
          <li>
            Don&apos;t try to get into families or data that aren&apos;t yours,
            overload the service, or use bots or scripts with it. FamFlix limits
            how often some actions can be repeated.
          </li>
        </ul>
        <p>
          Accounts that break these rules may be suspended or deleted.
        </p>
      </Section>

      <Section title="Movie information">
        <p>
          Titles, posters, trailers and other movie information come from The
          Movie Database (TMDB) and YouTube. FamFlix uses the TMDB API but is
          not endorsed or certified by TMDB.
        </p>
      </Section>

      <Section title="No guarantees">
        <p>
          FamFlix is a free personal project, offered as it is. It may change,
          have interruptions or end, and it doesn&apos;t promise to keep your
          data forever. To the extent the law allows, FamFlix isn&apos;t liable
          for losses from using it.
        </p>
      </Section>

      <Section title="Leaving">
        <p>
          You can stop using FamFlix and delete your account at any time in
          Settings. See the{" "}
          <Link
            href="/privacy"
            className="text-foreground underline underline-offset-2"
          >
            privacy policy
          </Link>{" "}
          for what that deletes.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If these terms change, the date above changes too. Important changes
          will be shown in the app. Questions: <ContactLink />.
        </p>
      </Section>
    </LegalPage>
  );
}
