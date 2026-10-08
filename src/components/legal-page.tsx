import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Who to write to about privacy, the terms or your data. */
export const CONTACT_EMAIL = "etticov@gmail.com";

export function ContactLink() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="text-foreground underline underline-offset-2"
    >
      {CONTACT_EMAIL}
    </a>
  );
}

/** The frame shared by the privacy policy and the terms. */
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
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
        <h1 className="text-3xl font-bold text-foreground">{title}</h1>
        <p>Last updated: {updated}</p>
        {intro}
      </div>
      {children}
      <p className="flex gap-4 border-t border-border pt-6 text-xs">
        <Link href="/privacy" className="underline hover:text-foreground">
          Privacy policy
        </Link>
        <Link href="/terms" className="underline hover:text-foreground">
          Terms
        </Link>
      </p>
    </main>
  );
}

export function Section({
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
