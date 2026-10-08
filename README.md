This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

# FamFlix

A small, free, browser-based watchlist for families and friends. Create a
shared family list (anyone can add titles, mark them watched, rate them 1–10,
leave a note, and like/dislike) plus a private personal list. Movie and series
data comes from **TMDB**. Accounts, storage and access control use **Supabase**.

- **Stack:** Next.js (App Router) · Supabase (Postgres + Auth + Row-Level Security) · TMDB API · Tailwind CSS
- **Multi-tenant:** each "family" is isolated by invite code and enforced with RLS.

## 1. Prerequisites

- Node.js 20+
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

## 4. Enable authentication

In Supabase → **Authentication → Providers**:

- **Email**: enabled by default. (For instant testing you can turn off "Confirm email".)
- **Google** (optional): enable it and add your Google OAuth client ID/secret.

Under **Authentication → URL Configuration**, add your site URL and the redirect
`http://localhost:3000/auth/callback` (and your production URL when deployed).

## 5. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, then
create a family or join one with an invite code.

## Deploy (free)

1. Push this repo to GitHub.
2. Import it into [Vercel](https://vercel.com/new) and add the three env vars.
3. In Supabase URL Configuration, add your Vercel URL + `/auth/callback`.

## Notes

- This product uses the TMDB API but is not endorsed or certified by TMDB.
- Personal lists are private to each user; family lists are visible only to
  members of that family — enforced at the database level via RLS.
