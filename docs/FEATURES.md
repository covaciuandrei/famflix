# FamFlix feature guide

What FamFlix does, feature by feature. For an overview, the architecture and how
to run it, see the [README](../README.md).

- [Lists](#lists): [family lists](#family-lists), [My list](#my-list), [activity feed](#activity-feed)
- [Finding titles](#finding-titles): [browse and add](#browse-and-add), [a title's page](#a-titles-page), [Discover](#discover)
- [Tracking what you watch](#tracking-what-you-watch): [scores and reactions](#scores-and-reactions), [watched together](#watched-together), [watch again](#watch-again), [series by episode](#series-episode-by-episode)
- [Movie night](#movie-night): [the night](#the-night), [edit or delete a night](#edit-or-delete-a-night), [guests](#guests), [plan a night](#plan-a-movie-night)
- [Insights](#insights): [family stats](#family-stats), [your year](#your-year)
- [The app and your data](#the-app-and-your-data)

## Lists

### Family lists

Start a family and invite people with a code. Everyone can add titles, mark them
watched, rate them and react. Invite codes last 24 hours, then change by
themselves. The owner can rename the family, make a new invite code and remove
members (**Manage** on the Families page).

### My list

Your personal list, with To watch and Watched tabs. **Mark as watched** on a
title's page puts it straight on My list as watched. Every list can be filtered
by release date (2020s, 1990s, ...) and category (genre, movies or series).

**When you watched it.** Marking a title watched opens the *How was it?* window,
which also asks the day you watched it (today to start with). Watched it long
ago and can't say when? Tick **I don't remember**: the title stays on your
Watched list, but it has no day, so it isn't counted in Your year. A watched
title says when ("Watched 12.03.2025", or "Date unknown") with a **Change date**
button, on its card and on its page, so a title added with the wrong day, or
none, is put right at any time. On a family list a watched title says the day
and who was there, and a title the family watched together keeps the family's
day on your My list (it isn't yours to change there).

The people in your families can see it, so you can look at each other's lists
and take titles from them: the titles, whether you watched them and when, and
your score. Never your notes, reactions, ticked episodes or earlier viewings,
and never a title you removed. Switch that off under **Settings → Privacy** and
only you can see it; My list's header says which it is. A family's **Members**
tab lists everyone with a link to their list ("Not sharing their list" when they
have switched it off), and a list can be read, with To watch and Watched tabs,
and an Add button on each title (to My list or a family's list).

From My list, **Add to family** on a title puts it on a family's list (a menu when
you are in several; a family that has it already says so). It is only there when
you are in at least one family.

### Activity feed

See what happened in each family; removed titles can be restored for 30 days.

## Finding titles

### Browse and add

Search, browse trending and top rated titles, or filter them by type (movies or
series), decade and category (Comedy, Horror, Kids, ...); the filters work
together, and only offer the categories the chosen type has. A row of titles
scrolls sideways: swipe it on a phone, or use the arrows at its edges with a
mouse (they show only while there is more to see that way). A row has no last
card: as you near its end the next page of titles is loaded from TMDB, without
repeating a title, for as long as TMDB has more. A row nobody has touched only
loads what it shows; once you scroll it, it stays about forty cards ahead of you,
so the next titles are usually there before you get to them (a few placeholders
hold the place when you outrun it). A page that fails to load is tried once more
by itself, and if that fails too the row says so and waits for "Try again".
The "Because you liked ..." rows and "More like this" on a title's page keep going
the same way; the cast and a film's collection are short and don't. Trailers play
from YouTube only once you press play.

**Filtered rows don't end early.** Rows made by a filter are the most popular or the
best rated titles, and keep out obscure ones by asking for a minimum number of votes
(a thousand for the best rated movies, say). A narrow filter, such as westerns of
the eighties, has few titles with that many votes, so such a row asks for the strictest
minimum that still leaves it about two hundred titles, and goes down to fewer votes
only as far as it has to (series, which get fewer votes, start lower). Rows with
plenty of titles keep the strict minimum, so what you see first is still the well
known ones.

### A title's page

Besides the poster, score and trailer it shows the age rating (the American one,
else the British one), who directed it or created it, the top-billed cast with
their photos, the other films of its collection and **More like this** (TMDB's
recommendations, with the lists a title is on and an Add button). Whatever TMDB
doesn't know is left out.

### Discover

On Browse, pick a mood and swipe through a stack of suggestions on your own: ✓
yes or ♥ love puts the title on My list the moment you swipe it (the stack's
titles are saved up front, so it is a quick insert), ✕ nope and 👁 seen it add
nothing. Buttons or the arrow keys on a computer, swipes on a phone. There is
nothing to wait for at the end: the last card ends with a note of how many titles
are on My list and buttons to show it or to Discover more.

## Tracking what you watch

### Scores and reactions

Rate 1–10 with one decimal (8.5) using a slider, and add a note. Marking a title
watched asks for both right away. A score over 7 also likes the title and under 6
dislikes it; you can still change the thumbs yourself.

On a family list, tap the star score to see each person's rating, including your
own. Scores filled in for someone else say who entered them; notes without a
score do not count as ratings. **Who reacted?** beside the thumbs shows separate
lists of who liked and disliked the title. Looking at either breakdown never
changes your rating or reaction. The same breakdowns are available from the
scores and reaction counts in the movie-night To watch list.

Saved guests can have a score too, entered by a family member. It counts in the
family average and is labelled Guest with who entered it. There is one current
score per person and title, not one contribution for each time they watched it.
Use **Record a guest score** under the card's rating panel to add one, or **Edit**
beside their score in the family breakdown to change or clear it. Guest scores
do not create swipe votes or likes/dislikes.

### Watched together

- Log who watched a title with you and add your own note.
- You can fill in the others' scores; FamFlix then asks each of them to confirm
  their score (or rate it) and add their note, or to say "I wasn't there", which
  takes them off the record and drops the score filled in for them.
- Family lists are split into To watch and Watched together, so a title one
  person marked Watched on their own stays on the family's To watch list, and a
  title everyone on the record says they weren't at goes back to To watch.
- Everyone you tick also gets the title on their **My list** as watched (moved
  over from To watch if it was there), with their score and note, and a line on
  the card: "Watched with Ben, Cara on 09.10.2026". Their score there follows the
  family's until they change it on My list, and "I wasn't there" takes the title
  off their My list again.

### Watch again

A watched title has a Watch again button, on its card (a family's Watched
together tab, My list's Watched tab) and on its page.

- **Put back on To watch** brings it back to the list, for a movie night or for
  next time.
- **We watched it again** logs a new viewing (a family gets the Watched together
  window, My list asks for the day).

The viewing the title had is kept in the watch history, so nothing is lost: the
card says "Watched 3×" and tapping it lists the days (a family's with who was
there), and a title put back on To watch says "Watch again · seen 2×". Several
viewings on one day count once; each viewing with no day ("I don't remember",
listed as "Date unknown") counts as a viewing of its own. There is still one
score and note per person per title (watching it again asks to update them).

### Series, episode by episode

- A series is one title on My list, and its page lists its seasons and episodes
  (from TMDB). Tick the episodes you have watched one by one, a whole season, or
  everything up to an episode, or tap **Watched S2E5** for the next one.
- The page says where you are: Not started, Watching, Caught up (a show that is
  still airing, with everything that has aired ticked) or Completed. Only
  episodes that have aired can be ticked.
- Ticking the last aired episode of a show that has ended makes it Watched and
  asks how it was; **Mark as watched** marks a whole series without rewriting
  your ticks (so un-marking brings them back), and a series marked watched shows
  every episode as watched until you untick one. Ticking an episode puts the
  series on My list.
- Each episode also takes your own score (1–10, one decimal) and note (250
  characters): **Rate / note** under it. Rating an episode ticks it, and
  unticking one that has a score or note asks first, since that deletes them.
- **When you watched it.** Ticking one episode is for today. Ticking several at
  once (a season, the rest of a season, everything up to an episode) asks the day
  first, with the same **I don't remember** tick, which is how you catch up on a
  series you watched years ago without it counting as this month. A ticked
  episode says when you watched it ("Watched 12.03.2025", or "Date unknown") with
  **Change date**. A series marked Watched has one day for all of its episodes,
  which you can change on its page.
- On My list a series is still one card: once you have ticked an episode it shows
  where you are, a progress bar and a button for the next episode (**Watched
  S2E5**), and the series moves to a **Watching** tab (which is there while you
  have any). Your ticks, scores and notes are private, like My list: family lists
  keep a series as one title, with no episodes.

**Watching a series, or an episode, again.** A ticked episode has **Watched
again** (the day, today to start with): the day it had is kept in the history and
the row says "Watched 3×" with the days. **Start again**, on the series' page and
on the card of a series marked Watched, begins a new pass: what you had watched
of it, with its days, scores and notes, goes into the history as pass 1, 2, ...
and the series is Not started again (the page says "Watching again · pass 2" and
the card "Watched 2×" once it is finished again). The series' own score and note
stay. A family series is one title and is watched again like a movie.

## Movie night

### The night

A family thing, and for movies only (a series is tracked on My list, and one
watched together doesn't make a night in the history).

- Can't decide? Start one for a family, pick a mood and everyone in it swipes
  through the same stack (the family's To watch movies plus suggestions from
  TMDB; titles put back on the list with Watch again come first, and a card or
  leaderboard row says "Watched before" for a title the family has seen): ✕ nope
  (−1 point), ♥ love (+2, three per stack), ✓ yes (+1) or 👁 seen it (0, you've
  already seen it), with buttons or the arrow keys on a computer and swipes on a
  phone.
- Everyone gets an invite when the night starts and sees the leaderboard once
  they have finished: points per title, who voted what, "more suggestions" or
  "more like this" for another stack.
- Any member can show the results early, cancel, or pick a title ("We watched
  this"), which logs it as Watched together, ends the night and adds its best 7
  titles to the family list. The family may also have decided on something that
  wasn't in the stack: "Pick something else" (on the leaderboard, or in the
  night's menu) searches for any movie and ends the night with it the same way.
- A night closes by itself after 12 hours without activity. The page lists every
  night of the family you chose (the first one until you pick another) with its
  status (in progress, finished, cancelled or expired), the ones in progress
  first; each one opens its own page. Without a family the page points to
  creating or joining one, and to Discover for swiping on your own. The old
  shuffle of what's left to watch is still there under "Browse your To watch
  list".

### Edit or delete a night

Open a completed night and use **Edit participants**, beside the attendance
summary or in its menu. It changes the people who watched and the viewing date,
not swipe votes, rankings, the picked movie, or member ratings and notes.

- Family members and saved guests can be added retrospectively, even if they
  never opened a link. At least one family member must remain selected.
- The date and attendees start from that exact viewing. **I don't remember**
  keeps it watched with **Date unknown**, not today's date. The same control is
  available when logging Watched together, picking a movie, or watching again.
- Older viewings can be corrected too. Changing their date shows a non-blocking
  notice; a date before another viewing, or on the same day, is allowed. Invalid
  or future dates are not. Each viewing has its own identity, so editing one
  does not overwrite another viewing or an independently managed personal list.
- People with protected feedback remain ticked: only they can take themselves
  off through **I wasn't there**. If someone changed this viewing while the
  window was open, the save is refused rather than overwriting their edit.
- Reopening an already completed **Watched together** record edits it. Use
  **Watch again** to explicitly record a new viewing.
- **Delete movie night** retains its existing permissions and removes the night,
  not its underlying viewing. **Also put the title back on To watch** remains a
  separate, stricter operation for the latest, unprotected viewing. A saved guest
  profile is reusable even after one night is deleted.

### Guests

Each family has **Saved guests** under **Members**. Select a returning person,
add a new one, or correct an unregistered guest's name across that family's
history. Guests need no account or invitation to be recorded as having watched.
Duplicate old guest records can be explicitly combined by the family; names
alone do not prove that two records belong to the same person.

**Invite a guest** is visible on an active night's header as well as in its
menu. The general link lets a new guest give a name. **Invite a returning guest**
creates a private link for one saved person and that night, keeping their
history connected without matching identities by name. A duplicate name on a
general link requires a distinct name or a returning-guest invitation.

Guests swipe and see that night's leaderboard, but cannot pick, cancel, invite,
or see the family's lists, guest directory, or history. Joining or voting is not
proof of watching: confirm the actual guest attendees in **Who watched?**. Taking
someone out of an active voting session removes its votes, as before; editing
attendance does not. A night takes 10 guests, with names up to 30 characters.
Links can be revoked and stop working when the night ends; personal invitations
also expire after 24 hours.

**Invite to FamFlix** gives a saved guest a separate, single-use account
invitation. After Google sign-in and explicit confirmation, they join the family
as a member and import missing attendance and scores. Existing account ratings,
notes, reactions and personal-list status are kept; a person and their score
never count twice. Active guest nights must finish before linking is completed.
Historical votes are not rewritten. Registered members control their own
account names. Invitations are copied/shared links, not automated emails.

### Plan a movie night

Not tonight? **Plan a movie night** on the Movie night page picks a day and a
time (written in your own time zone, shown in everyone else's own), with an
optional note (100 characters) and a mood.

- The plan sits at the top of the family's nights with **Going / Maybe / Can't**
  for each member (press an answer again to take it back), who is coming,
  **Start now** and **Cancel plan**; anyone in the family can do those. Starting
  from a plan starts the night with the plan's mood.
- A family has at most 5 planned, a plan can be up to a year ahead, and one that
  nobody starts is over a day after its time (a cancelled or passed one stays in
  the list for a day). Planning and cancelling write a line in the feed.
- There is no calendar file and no e-mail: everything stays in the app, where
  FamFlix reminds the family of a plan from an hour before its time to three
  hours after: a dot on the Movie night menu and a banner on the Movie night
  page, for everyone who hasn't answered Can't, and an invite that opens by
  itself once, 15 minutes before (not while someone is swiping or already in
  Movie night).

## Insights

### Family stats

The **Stats** tab on a family's page shows what the family watched in a year
(pick one, or All time): titles and viewings, hours of movies (a series adds
none), movie nights held, the top 5 by average score, the most loved and most
divisive titles, favourite genres, the busiest month and a chart of the months,
what was watched again, who watched how much, and whose taste is closest and most
different (how alike two people score the titles they both rated, shown once they
have at least 3 in common). Every viewing counts, so a film watched each
Christmas counts each year. **Share** sends a short text with the numbers and the
top pick, and nobody's name. It only uses what members of the family can already
see.

### Your year

**Your year** on My list (`/app/mine/stats`) is the same for you alone, and
private: titles and viewings, episodes of series, hours (a movie's length for each
time you watched it, an episode's length for each episode), your average, lowest
and highest score and your top 5, favourite genres, the busiest month with a
chart, and what you watched again. It counts what is on your My list (the titles
you took off it too), the times you watched something before, and what you
watched with a family; your own score wins over the family's. Titles and
episodes you watched on a day you don't remember (**I don't remember**) have no
day to count, so they are left out, in a year and in all time. **Share** sends a
short text without anything private in it.

## The app and your data

- **Made for phones**: bottom navigation, sheets instead of pop-ups, and it can
  be added to the home screen. Dark theme by default, or light, or follow the
  device (Settings → Appearance).
- **Private by design**: sign-in is with Google only. Every list is protected in
  the database with row-level security, so only you or your family members can
  read it.
- **Download my data**: **Settings → Account → Download my data** gives you
  everything FamFlix keeps about you: one JSON file (your account, families, My
  list with the episodes you ticked and the times you watched things again, your
  part of every family list, your movie nights and votes, the feed events you
  caused) or a CSV of your watch history, one row for every time you watched
  something (a viewing on a day you don't remember has an empty date). Other
  people's scores, notes and e-mail addresses are never in it;
  the download is only for you, from FamFlix itself, up to five times an hour.
  After you leave a family or are removed, your own contributions remain in
  the download, but its current name, list status changes, movie-night outcomes
  and plan status are withheld. Your own viewing dates, scores and notes stay
  available; the CSV labels a former family's redacted name as **My list**.
- **Delete account**: **Settings → Delete account** deletes your account and
  data; your families keep the titles you added, without your name.
- **Limits against abuse**: names and notes are at most 250 characters, and each
  person is limited in how fast they can add, search, join and plan. The numbers
  are in the README's [Security](../README.md#security) section.
