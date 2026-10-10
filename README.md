# FamFlix

A small, free watchlist for families and friends: keep track of the movies and
series you want to watch and have watched together, and see what everyone
thought of them. Live at <https://famflix.andreicovaciu.dev>.

## Features

- **Family lists**: start a family and invite people with a code. Everyone can
  add titles, mark them watched, rate them and react. Invite codes last 24
  hours, then change by themselves. The owner can rename the family, make a
  new invite code and remove members (**Manage** on the Families page).
- **Personal list**: a private "My list" that only you can see, with To watch
  and Watched tabs. **Mark as watched** on a title's page puts it straight on
  My list as watched. Every list can be filtered by release date (2020s,
  1990s, ...) and category (genre, movies or series).
- **Browse and add**: search, browse trending and top rated titles, or pick a
  category (Comedy, Horror, Kids, ...) and decade. Trailers play from YouTube
  only once you press play.
- **Scores and reactions**: rate 1–10 with one decimal (8.5) using a slider,
  and add a note. Marking a title watched asks for both right away. A score
  over 7 also likes the title and under 6 dislikes it; you can still change the
  thumbs yourself.
- **Watched together**: log who watched a title with you and add your own note.
  You can fill in the others' scores; FamFlix then asks each of them to confirm
  their score (or rate it) and add their note, or to say "I wasn't there", which
  takes them off the record and drops the score filled in for them. Family lists
  are split into To watch and Watched together, so a title one person marked
  Watched on their own stays on the family's To watch list, and a title everyone
  on the record says they weren't at goes back to To watch. Everyone you tick
  also gets the title on their **My list** as watched (moved over from To
  watch if it was there), with their score and note, and a line on the card:
  "Watched with Ben, Cara on 09.10.2026". Their score there follows the
  family's until they change it on My list, and "I wasn't there" takes the title
  off their My list again.
- **Discover**: on Browse, pick a mood and swipe through a stack of suggestions
  on your own: ✓ yes or ♥ love puts the title on My list the moment you swipe
  it (the stack's titles are saved up front, so it is a quick insert), ✕ nope
  and 👁 seen it add nothing. Buttons or the arrow keys on a computer, swipes on
  a phone. There is nothing to wait for at the end: the last card ends with a
  note of how many titles are on My list and buttons to show it or to Discover
  more.
- **Movie night**: a family thing. Can't decide? Start one for a family, pick a
  mood and everyone in it swipes through the same stack (the family's To watch
  titles plus suggestions from TMDB): ✕ nope (−1 point), ♥ love (+2, three per
  stack), ✓ yes (+1) or 👁 seen it (0, you've already seen it), with buttons or
  the arrow keys on a computer and swipes on a phone. Everyone gets an invite
  when the night starts and sees the leaderboard once they have finished:
  points per title, who voted what, "more suggestions" or "more like this" for
  another stack. Any member can show the results early, cancel, or pick a title
  ("We watched this"), which logs it as Watched together, ends the night and
  adds its best 7 titles to the family list. A night closes by itself after 12
  hours without activity. The page lists every night of the family you chose
  (the first one until you pick another) with its status (in progress,
  finished, cancelled or expired), the ones in progress first; nothing is ever
  deleted from it. Without a family the page points to creating or joining one,
  and to Discover for swiping on your own. The old shuffle of what's left to
  watch is still there under "Browse your To watch list".
- **Activity feed**: see what happened in each family; removed titles can be
  restored for 30 days.
- **Made for phones**: bottom navigation, sheets instead of pop-ups, and it can
  be added to the home screen. Dark theme by default, or light, or follow the
  device (Settings → Appearance).
- **Private by design**: sign-in is with Google only. Every list is protected in
  the database with row-level security, so only you or your family members can
  read it. **Settings → Delete account** deletes your account and data; your
  families keep the titles you added, without your name.
- **Limits against abuse**: names and notes are at most 250 characters. Each
  person can add 30 titles and search 60 times a minute, try 10 invite codes
  per 10 minutes, and start 10 families an hour, 6 family movie nights an hour
  and 10 extra stacks an hour. Each family's activity feed keeps its latest 500
  events.

## Tech stack

| Part                 | Technology                                                                |
| -------------------- | ------------------------------------------------------------------------- |
| UI                   | [React 19](https://react.dev) (server and client components)              |
| Framework            | [Next.js 16](https://nextjs.org) (App Router, server actions)             |
| Language             | TypeScript 5                                                              |
| Styling              | [Tailwind CSS v4](https://tailwindcss.com), [Lucide](https://lucide.dev) icons |
| Database and sign-in | [Supabase](https://supabase.com): Postgres with row-level security, Auth (Google) |
| Movie data           | [TMDB API](https://developer.themoviedb.org)                              |
| Tests                | Unit tests of the logic, SQL test files for the database, [Playwright](https://playwright.dev) for the browser |
| Hosting              | Azure Static Web Apps, deployed by GitHub Actions                         |

## 1. Prerequisites

- Node.js 20 (the version `package.json` and the deploy use)
- A free [Supabase](https://supabase.com) project
- A free [TMDB](https://www.themoviedb.org) account + API Read Access Token

## 2. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in:

| Variable                        | Where to find it                                            |
| ------------------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API → Project URL             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` public key       |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API Keys → `service_role`     |
| `TMDB_ACCESS_TOKEN`             | TMDB → Settings → API → **API Read Access Token** (v4 auth) |

`SUPABASE_SERVICE_ROLE_KEY` stays on the server. It lets the app save movie info,
which signed-in users can't write themselves, and it can do anything in your
database: never put it in a `NEXT_PUBLIC_` variable, never commit it.

## 3. Set up the database

In the Supabase dashboard open **SQL Editor**, paste the contents of
[`supabase/db_init.sql`](supabase/db_init.sql) and click Run, once, on an
empty database. It creates all tables, security policies and functions, and
grants each Supabase role exactly the access it needs. That last part matters:
since 30 May 2026 new Supabase projects (and from 30 October 2026 every project)
no longer hand new tables and functions to the API automatically, and the script
doesn't count on it.

To start over on a project that already has FamFlix in it, run this first, then
`db_init.sql`. **It deletes every family, title and user: only do it before you
have real data.**

```sql
drop schema public cascade;
create schema public;
delete from auth.users;
```

Whatever you add to the database later, with a new table or function, needs its
own `grant` statements too (see the end of `db_init.sql`), or the API answers
"permission denied".

## 4. Enable authentication

FamFlix signs people in with Google only. In Supabase → **Authentication →
Sign In / Providers**:

- **Google**: enable it and add your Google OAuth client ID/secret. In Google
  Cloud, the OAuth client's authorized redirect URI is
  `https://<your-project>.supabase.co/auth/v1/callback`.
- **Email**: turn it off, so nobody can sign up with a password through the API
  either.

Under **Authentication → URL Configuration**, set the Site URL and add each
address the app runs on, followed by `/auth/callback`, to the Redirect URLs
(for example `http://localhost:3000/auth/callback`).

## 5. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), continue with Google, then
create a family or join one with an invite code.

## Tests

- `npm run test:unit`: tests of pure logic in `unit/` (building movie night stacks,
  moods, genres). No browser, server or database needed.
- `npm run test:db`: the database tests in `supabase/tests/` (security rules,
  who may use which table and function, families, scores, limits, deleting an
  account). They build a throwaway database from `supabase/db_init.sql`, twice:
  with Supabase's older defaults (new tables and functions are handed to the API
  roles) and its newer ones (nothing is), and both must pass. You need
  PostgreSQL 17 installed, or `PGHOST` pointing at a server where they may
  create a database.
- `npm run test:e2e`: the browser tests in `e2e/` (signing in, adding titles,
  watched together, movie nights from the invite to the pick, deleting an
  account), on a computer-sized and a phone-sized screen. You need Docker: they run against a local Supabase
  (`supabase/config.toml`) built from `db_init.sql` the way a new project is (nothing granted by default),
  never the live one.
  `npx supabase stop` shuts it down afterwards.

GitHub runs lint, the type check and all three test suites on every push and pull
request, and only deploys when they pass.

## Deploy

The live site runs on **Azure Static Web Apps** (Free plan).
[`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml)
tests, builds and deploys every push to `main`; pull requests get a preview site.

[**Beginner's deployment guide**](docs/DEPLOYMENT-GUIDE.md) explains our complete
setup, manual commands, infrastructure, secrets, DNS, HTTPS, authentication,
limits and troubleshooting.

1. Create a detached Free Static Web App using the Bicep files in `infra/`,
   then use the existing GitHub Actions workflow and add these
   repository secrets in GitHub: `AZURE_STATIC_WEB_APPS_API_TOKEN`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `TMDB_ACCESS_TOKEN`. Also configure the same three application variables,
   plus `SUPABASE_SERVICE_ROLE_KEY` (only the running server needs it, not the
   build), in Azure's runtime settings.
2. In Supabase URL Configuration, set the Site URL to the production address
   and add `https://<your-domain>/auth/callback` to the Redirect URLs.
3. Database changes aren't deployed automatically: run the new SQL in the SQL
   Editor before pushing code that needs it, and keep `supabase/db_init.sql`
   up to date so a fresh database gets everything.

## Project layout

- `src/app`: pages and routes. Signed-in pages live under `src/app/app`;
  server actions are in `src/app/app/actions.ts` (movie night's are in
  `src/app/app/movie-night/actions.ts`).
- `src/components`: UI components.
- `src/lib`: data loading (`data.ts`), the TMDB client, Supabase clients and
  the theme helpers.
- `src/proxy.ts`: refreshes the Supabase session and protects `/app` (the
  Next.js 16 replacement for middleware).
- `supabase/db_init.sql`: the whole database (tables, security policies and
  functions) in one file.
- `unit/`: tests of pure logic; `supabase/tests/`: database tests; `e2e/` and `scripts/e2e.sh`: browser tests;
  `supabase/config.toml`: the local Supabase the browser tests use.

## Notes

- This product uses the TMDB API but is not endorsed or certified by TMDB.
- Personal lists are private to each user; family lists are visible only to
  members of that family, enforced in the database with row-level security.
