# FamFlix

A small, free watchlist for families and friends: keep track of the movies and
series you want to watch and have watched together, and see what everyone
thought of them. Live at <https://famflix.andreicovaciu.dev>.

## Features

- **Family lists**: start a family and invite people with a code. Everyone can
  add titles, mark them watched, rate them and react. Invite codes last 24
  hours, then change by themselves. The owner can rename the family, make a
  new invite code and remove members (**Manage** on the Families page).
- **Personal list**: a private "My list" that only you can see. Every list can
  be filtered by release date (2020s, 1990s, ...) and category (genre, movies
  or series).
- **Browse and add**: search, browse trending and top rated titles, or pick a
  category (Comedy, Horror, Kids, ...) and decade, with trailers and where to
  stream them.
- **Scores and reactions**: rate 1–10 with one decimal (8.5) using a slider,
  and add a note. A score over 7 also likes the title and under 6 dislikes it;
  you can still change the thumbs yourself.
- **Watched together**: log who watched a title with you. FamFlix asks the
  others for their score, or you can fill it in for them. Family lists are split
  into To watch and Watched together, so a title one person marked Watched on
  their own stays on the family's To watch list.
- **Movie night**: shuffle what's left to watch, filter by category, or let
  the app pick.
- **Activity feed**: see what happened in each family; removed titles can be
  restored for 30 days.
- **Made for phones**: bottom navigation, sheets instead of pop-ups, and it can
  be added to the home screen. Dark theme by default, or light, or follow the
  device (Settings → Appearance).
- **Private by design**: every list is protected in the database with
  row-level security, so only you or your family members can read it.

## Tech stack

| Part                 | Technology                                                                |
| -------------------- | ------------------------------------------------------------------------- |
| UI                   | [React 19](https://react.dev) (server and client components)              |
| Framework            | [Next.js 16](https://nextjs.org) (App Router, server actions)             |
| Language             | TypeScript 5                                                              |
| Styling              | [Tailwind CSS v4](https://tailwindcss.com), [Lucide](https://lucide.dev) icons |
| Database and sign-in | [Supabase](https://supabase.com): Postgres with row-level security, Auth (Google and email) |
| Movie data           | [TMDB API](https://developer.themoviedb.org)                              |
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
| `TMDB_ACCESS_TOKEN`             | TMDB → Settings → API → **API Read Access Token** (v4 auth) |

## 3. Set up the database

In the Supabase dashboard open **SQL Editor** and run these files, in order, by
pasting each one's contents and clicking Run:

1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) —
   all tables, indexes, security policies and helper functions, plus a trigger
   that auto-creates a profile for each new user.
2. [`supabase/migrations/0002_watched_together.sql`](supabase/migrations/0002_watched_together.sql) —
   "Watched together" logging, scores filled in for others, and rating requests.
3. [`supabase/migrations/0003_family_tools.sql`](supabase/migrations/0003_family_tools.sql) —
   undo for removed titles, family settings, the activity feed and stronger
   invite codes.
4. [`supabase/migrations/0004_decimal_scores.sql`](supabase/migrations/0004_decimal_scores.sql) —
   scores with one decimal (6.7, 8.5, ...). Existing scores are kept.
5. [`supabase/migrations/0005_score_reactions.sql`](supabase/migrations/0005_score_reactions.sql) —
   your score sets your like/dislike: over 7 likes the title, under 6 dislikes
   it. Existing scores and reactions are left alone.
6. [`supabase/migrations/0006_invite_code_expiry.sql`](supabase/migrations/0006_invite_code_expiry.sql) —
   invite codes last 24 hours, then change by themselves. Existing codes get
   24 hours from when you run it.

## 4. Enable authentication

In Supabase → **Authentication → Providers**:

- **Email**: enabled by default. (For instant testing you can turn off "Confirm email".)
- **Google** (optional): enable it and add your Google OAuth client ID/secret.
  In Google Cloud, the OAuth client's authorized redirect URI is
  `https://<your-project>.supabase.co/auth/v1/callback`.

Under **Authentication → URL Configuration**, set the Site URL and add each
address the app runs on, followed by `/auth/callback`, to the Redirect URLs
(for example `http://localhost:3000/auth/callback`).

## 5. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, then
create a family or join one with an invite code. Before pushing, check with
`npx tsc --noEmit`, `npm run lint` and `npm run build`.

## Deploy

The live site runs on **Azure Static Web Apps** (Free plan).
[`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml)
builds and deploys every push to `main`; pull requests get a preview site.

[**Beginner's deployment guide**](docs/DEPLOYMENT-GUIDE.md) explains our complete
setup, manual commands, infrastructure, secrets, DNS, HTTPS, authentication,
limits and troubleshooting.

1. Create a detached Free Static Web App using the Bicep files in `infra/`,
   then use the existing GitHub Actions workflow and add these
   repository secrets in GitHub: `AZURE_STATIC_WEB_APPS_API_TOKEN`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `TMDB_ACCESS_TOKEN`. Also configure the three application variables in
   Azure's runtime settings.
2. In Supabase URL Configuration, set the Site URL to the production address
   and add `https://<your-domain>/auth/callback` to the Redirect URLs.
3. Database changes aren't deployed automatically: run any new file from
   `supabase/migrations` in the SQL Editor before pushing code that needs it.

## Project layout

- `src/app`: pages and routes. Signed-in pages live under `src/app/app`;
  server actions are in `src/app/app/actions.ts`.
- `src/components`: UI components.
- `src/lib`: data loading (`data.ts`), the TMDB client, Supabase clients and
  the theme helpers.
- `src/proxy.ts`: refreshes the Supabase session and protects `/app` (the
  Next.js 16 replacement for middleware).
- `supabase/migrations`: database tables, security policies and functions.

## Notes

- This product uses the TMDB API but is not endorsed or certified by TMDB.
- Personal lists are private to each user; family lists are visible only to
  members of that family, enforced in the database with row-level security.
