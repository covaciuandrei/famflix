import { LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/login/actions";
import { DeleteAccount } from "@/components/delete-account";
import { ProfileForm } from "@/components/profile-form";
import { ThemePicker } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShowTourButton } from "@/components/welcome-tour";
import { getSessionProfile } from "@/lib/data";

export default async function SettingsPage() {
  const { user, profile } = await getSessionProfile();
  if (!user) redirect("/login");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProfileForm displayName={profile?.display_name ?? ""} />
          <p className="text-sm text-muted-foreground">
            Signed in with Google as {user.email}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ThemePicker />
          <p className="text-sm text-muted-foreground">
            Dark is the default. System follows your device. Saved on this
            device.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={signOut}>
            <Button variant="outline" type="submit">
              <LogOut className="size-4" />
              Sign out
            </Button>
          </form>
          <DeleteAccount />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            FamFlix is a private watchlist for families and friends to keep
            track of the movies and series they watch together.
          </p>
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/tmdb-logo.svg"
              alt="The Movie Database (TMDB)"
              width={123}
              height={16}
              className="h-4 w-auto"
            />
          </a>
          <p>
            This product uses the TMDB API but is not endorsed or certified by
            TMDB. Titles, posters, trailers and other movie information come
            from{" "}
            <a
              href="https://www.themoviedb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              The Movie Database (TMDB)
            </a>
            .
          </p>
          <Link
            href="/privacy"
            className="w-fit underline hover:text-foreground"
          >
            Privacy policy
          </Link>
          <ShowTourButton />
        </CardContent>
      </Card>
    </div>
  );
}
