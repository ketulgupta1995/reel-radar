# Reel Radar 🎬

Five personal apps for one user, behind a single login and installable on your phone or laptop as **My Apps**:

- **Reel Radar**: a movie & TV tracker covering Indian and global cinema. Log what you've watched (down to the season), keep a watchlist, and get recommendations and analytics based on your own taste.
- **Daily Planner**: time-blocked days, repeating tasks and streaks, deadlines, goals, lists, a day log, search across everything, a weekly review, stats, and reminders that work with the app closed.
- **Money**: spending, limits and what you owe family, with Google Pay and Paytm statement import.
- **Books**: find free ebooks (Standard Ebooks, Project Gutenberg) or upload an EPUB or PDF, and have it read aloud, or play a LibriVox recording.
- **Piano**: practice with a USB MIDI keyboard: daily sessions, note, chord, rhythm and ear-training drills, songs with falling notes (melody + chords too), bar loops, record and replay, scales with an evenness-of-touch score, milestones, a metronome and a practice log.

Built with **Next.js 16 (App Router)**, **React 19**, **TypeScript** and **Tailwind CSS**, with live metadata from **TMDB**. Your data is kept in the browser and synced across devices through **Turso** (or to local JSON files during development).

---

## Quick start

**You need:** Node.js **22** (the version is pinned in `.nvmrc`) and a free [TMDB v3 API key](https://www.themoviedb.org/settings/api).

```bash
nvm use                      # Node 22 from .nvmrc
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000, then sign in
```

> **Real Turso credentials in `.env.local` mean the dev server reads and writes your live data.** To try changes safely, turn the store off for that run: `TURSO_DATABASE_URL= npx next dev -p 3001`. Data then goes to `data/` instead.

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `TMDB_API_KEY` | ✅ | TMDB v3 key. Used only on the server. |
| `APP_USERNAME` | ✅ | Login username. |
| `APP_PASSWORD` | ✅ | Login password. |
| `AUTH_SECRET` | ✅ | Signs the session cookie. Generate one with `openssl rand -hex 32`. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | optional | Enables cloud sync via Turso. Without the URL, data is saved under `data/`. |
| `MONEY_ENCRYPTION_KEY` | for Money | Encrypts the Money docs where they're stored (`openssl rand -base64 32`). Without it the Money app can't sync. Use the same key locally and on Vercel, and keep a copy somewhere safe. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_CRON_SECRET` | for closed-app reminders | See [Reminders with the app closed](#reminders-with-the-app-closed). Without them, reminders only fire while the planner page is open. |
| `MONEY_MY_NAMES`, `MONEY_FAMILY` | no | The family the Money app starts with, so real names stay out of the repo: your statement names comma-separated, and family members split by `;` with each one's names by `,` (see `.env.example`). Server-only; served to signed-in users by `/api/money/family`. |
| `BLOB_READ_WRITE_TOKEN` | scripts only | Only for the scripts that read or clean up old Vercel Blob data (see [Troubleshooting](#move-old-blob-data-to-turso)). The app doesn't use it. |

If any of the three login variables is missing, nobody can sign in.

After 10 failed logins within an hour, login is locked for everyone (even with the right password) until the oldest failure is an hour old. Devices that are already signed in keep working. Attempts are recorded in Turso's `login_attempts` table, or `data/login-attempts.json` locally.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the test suite (Vitest + Testing Library) |
| `npm run coverage` | Tests plus a coverage report (terminal, and HTML in `coverage/`); fails below the thresholds |
| `npx vitest` | Run tests in watch mode |
| `npx tsc --noEmit` | Quick typecheck |
| `npm run build` | Production build (also does a full typecheck) |
| `npm start` | Serve the production build |

---

## Features

`/` is the **home page**: one card per app. Inside an app, the header shows a ⌂ Home button and a ▾ menu to switch to another app. `/login` is the single-user sign-in; every other page and API route requires it.

### Reel Radar

| Page | What you can do |
|---|---|
| `/reel-radar` | Landing page with a live spotlight of trending Indian and global titles |
| `/discover` | Endless feed you can filter by format (both / movies / series) and region (All / Indian / Global). Each card has **Mark seen**, **+ Watchlist**, **Not interested**, and **Trailer & details** buttons. |
| `/recommendations` | Unlocks after **10 logged titles**. Results come in four groups (Indian Movies, Global Movies, Indian Series, Global Series), plus themed shelves (Hidden Gems, Mind-Bending, Modern Classics) when each has at least 3 titles. Tune them by discovery style (balanced / popular / deep cuts), era (pre-2005, 2005-2019, 2020s) and mood (dark, adrenaline, feel-good, mind-bending), narrow them by format and region; each pick says why it was recommended. |
| `/similar` | Titles similar to one you choose, with an optional year range |
| `/analysis` | Taste analytics: total titles, hours watched, average rating, Indian vs global split, genres, decades, top directors and actors, blind spots, and your viewer "persona". Filter by movies/series and Indian/global. |
| `/watched` | Everything you've watched, with season-by-season progress for series |
| `/watchlist` | Your saved titles, with sorting and filters |
| `/dismissed` | Everything you marked **Not interested**. Restore one title, or all of them. |
| `/search` | Search across movies, series, and people |
| `/person/[id]` | An actor's or director's filmography, with quick watch and watchlist buttons |

**Season tracking.** Series are tracked per season (S1, S2, …). The more seasons you finish, the more weight a series carries in your taste profile.

**Backup.** Export your history and watchlist to a `.json` file, or import one to restore or merge, from the controls on Reel Radar's pages. **Reset All** clears your Reel Radar data on every device, after a confirmation.

### Daily Planner (`/todos`)

One page with four tabs (Today, Calendar, Plans, More), the tab bar along the bottom on a phone and in the header on a laptop. Light or dark follows the device.

- **Today**: a progress line; a card for what's on now (the block under way with a countdown, free time before the next block, a wrap-up, or all done); one **Needs attention** row (late and due-soon deadlines, overdue tasks, yesterday's unfinished ones, goals with no next step); the **day log** as tiles (water, tick and step items with a 🔥 streak from 2 days, sleep, weight, notes); an add box that understands shorthand (time, length, tag, priority, date, deadline, repeat) and can send to the day, a goal or a list; and the tasks in time order with a Done group. A week strip under the header jumps between nearby days.
- **Tasks**: tap one for its details (note, checklist, time and length, priority, tag, repeat, deadline, goal, move or copy, focus, delete). Focus fills the screen in the task's colour and keeps it on. On a phone, swipe right to finish or left to move to tomorrow, with Undo. Drag to reorder; filter by state, words or tag.
- **Schedule**: a timeline on a phone (tap a slot to add, drag to move, drag the bottom edge to resize) and a day bar on a laptop (drop a task on it, drag, resize). Auto-schedule, day templates and reminders sit above the list.
- **Repeats**: daily, on chosen weekdays, every N days, on a day of the month, or N times a week, with streaks.
- **Calendar**: a Week view (a row per day on a phone, seven columns on a laptop; drag blocks between days, Ctrl/Alt to copy) and a Month heatmap of finished tasks with each day's day-log score.
- **Plans**: **Goals** (tiles with progress, this week's count, focus time and the next step; red outline when there is none), **Lists** (wishlists, gift ideas, books to read: items with a note, link, price, photos and voice notes; `Headphones ₹2,999 amazon.in/x` fills in the price and link), and the guided **Weekly review** (look back, decide on each unfinished task, plan ahead), offered on Sundays.
- **More**: Stats (day log history grid, sleep, water, weight and steps trends, completion by weekday, planned vs. done hours, time by tag with a suggested block length, database reads and writes per day), day log items, tags, day templates, reminders, backup (export and import), a 7-day **Bin** for deleted tasks with Restore, and sync status.
- **Search** (⌕ in the header) covers every day's tasks, repeats, day notes, goals and lists.
- **Keys**: N or /, ← →, T, and on today F (focus), Space (finish), L (log); W and M on the calendar.
- `/todos?date=YYYY-MM-DD` opens a day and `/todos?list=&item=` a list item. Old addresses (`/todos/stats`, `/todos/lists`, `/todos/review`, `/todos/goals`, `/todos/search`, `/planner-next`) redirect to `/todos`.

**Backup.** Export pulls from the server first, so the file covers all your devices. Photos and voice notes stay on the server (the file keeps references). Importing adds to what's there and never deletes.

### Money

| Page | What you can do |
|---|---|
| `/money` | A hero card with the month's spending (vs last month, the monthly limit, about how much a day is left), a bar per day, income, savings against your goal, and what you owe family; spending by category with per-category limits; a card per family member with what you owe them (what they've spent since you last paid them), a **Paid ✓** button and their transactions. Transactions are grouped by day, searchable and filterable; tap one to change its category, type, owner or note. **+** adds one, **💵** logs cash in two taps. **Sort your spending** asks about imported payees with no confirmed category, one payee at a time, and learns the answer for later imports. |
| `/money/import` | Import a **Google Pay or Paytm statement PDF**, yours or a family member's. It's read in the browser (no upload, up to 20 MB), checked against the statement's printed total, and shown for review before import. Rows are keyed by UPI transaction id, so importing the same statement twice, or the same payment from both sides, keeps one copy. |
| `/money/settings` | Your statement names, family members, income, savings goal and limits. **Backup & export**: a JSON backup, a CSV of every transaction, or restore (adds, never deletes). **Delete all money data** empties every month on all devices, after a second click. |

On first use, the family from `MONEY_FAMILY` and your names from `MONEY_MY_NAMES` are filled in once (nothing is added while they're unset).

### Books

| Page | What you can do |
|---|---|
| `/books` | **Search** Standard Ebooks and Project Gutenberg at once (a book on both shows once, with its Standard Ebooks edition; if one site is down you get the other's results with a note). **Add** downloads the EPUB to this device. Or **upload an EPUB or PDF** (DRM-free, up to 50 MB). A PDF needs a text layer: it's split into chapters from its outline (or 10-page groups), with running headers, footers and page numbers removed; a PDF that looks like it has two columns gets a warning. Files stay in this browser (IndexedDB); the library and your place in each book sync across devices, and a book added elsewhere can be downloaded or re-added here to pick up where you left off. **Remove** takes a book out on every device. |
| `/books/[id]` | **Player.** The browser reads the chapter aloud one sentence at a time, highlighting the current one. Tap a sentence or use Back / Next to jump; it carries on into the next chapter. Pick a voice and a speed (0.75× to 2×). The screen stays on while playing, and playback pauses in the background. **Recordings:** *Find a recording* lists LibriVox volunteer recordings of the book; pick one and it plays section by section straight from archive.org. Needs a browser with speech synthesis (Chrome). |

### Piano (`/piano`)

Plug a MIDI keyboard (built for a Casio CT-X700) into your phone or laptop with a USB cable and open Piano in Chrome. It connects by itself (a dot in the header turns green), reconnects when replugged, and offers a device picker only when there's more than one. Without Web MIDI (Safari, iPhone) the on-screen keyboard still works through a built-in synth.

- **Today's practice** (`/piano`): three steps the app picks (a 2-minute warm-up on yesterday's slow notes, a 3-minute weak spot from the last 7 days, and 5 minutes on the song in progress), each with Swap, run in turn by one Start button, with Resume if you leave. It ends on a results screen with a card per step and a **note-speed keyboard** colouring each note fast, ok or slow. About once a week the song step brings back a **mastered song** you haven't played for 10+ days, so it doesn't fade. Below: today's minutes, the streak, **milestones** ("First song mastered", "All naturals under 1 s", "30-day streak" and five more; once earned they stay), and the **Library** of every area with its level and weak spot.
- **The stage**: every practice screen is full screen, with a slim top bar, the target or falling notes in the middle, and the keyboard docked at the bottom showing just the range needed. Settings (hands, mode, speed, ladder) are in a sheet. It keeps the screen on.
- **Drills**: **notes** (`/piano/notes`: play the named note in any octave; slow or missed notes come up more often), **chords** (`/piano/chords`: majors, minors and dominant 7ths in any inversion), **five-finger positions** (`/piano/fingers`), **rhythm** (`/piano/rhythm`: play a one-bar pattern after a count-in, scored early / on time / late), and **ear training** (`/piano/ear`: the app plays, you play it back: a note of the C position after a reference C, then three-note phrases, then "major or minor?" answered by playing the chord; Hear again replays it, and the keys light only after a miss). Groups unlock as accuracy and speed improve. The five-finger drill ends with an **evenness of touch** score from how hard each key was struck (velocity), with a bar per finger, when played on the keyboard.
- **Songs** (`/piano/songs`): 26 built-in public-domain tunes (from Hot Cross Buns and Mary Had a Little Lamb to Für Elise), 17 of them in the first two levels. Six are **melody + chords** songs written as a chord chart (Old MacDonald, London Bridge, Camptown Races, Oh! Susanna, Aura Lee, Auld Lang Syne): the left hand holds each chord (C, F, G, Am…) until the next change, and the player shows the chord sounding and the next one. All play as falling notes with letter and finger on each. **Wait mode** waits for the right keys; **Play-along** scores every note in real time and tells you where you rush or drag while the app plays the other hand. A **tempo ladder** (from about 60% of the tempo, +5 BPM after a 90% run) and a **hands ladder** (right, left, both, both at tempo) track progress. **Loop bars** (in the settings sheet, or **Practise bar N** under a run that rushed or dragged there) repeats a few bars until Stop with a small ladder of its own (+5 BPM in play-along, +10% speed in wait mode), without moving the song's ladders. **Hear your run** plays your last run back through the keyboard with the keys lit (only the last run is kept, on the device). Eight two-hand **coordination exercises** use the same player.
- **Import songs**: from a **MIDI file** (`.mid`, format 0 or 1, up to 256 KB; hands split by track or pitch, fingering suggested) or a **NoobNotes link** (a noobnotes.net song page; right hand only, with made-up timing, so the left-hand ladder steps are skipped). Imported songs sync between devices and can be deleted on all of them.
- **Scales** (`/piano/scales`): C, G, F, D and A major and A minor, with standard fingering and "thumb under" / "finger over" marks, each unlocking the next. Play-along adds a timing evenness score, and every run on the keyboard an evenness-of-touch score with a bar per finger.
- **Metronome** (`/piano/metronome`): 40-200 BPM, 2-4 beats a bar, count-in, clicks on the keyboard's own drums (or a beep). **Tap along** measures how early or late you play and sets the **latency offset** every timing score uses.
- **Free play** (`/piano/play`) and the **practice log** (`/piano/log`): today's minutes, the streak (days with 10+ minutes), the last 14 days, weekly accuracy and reaction-time trends per drill, and manual entries for practice away from the app.

Practice records, unlocks and song progress sync between devices and keep working offline. Latency, tempo and today's session state stay on each device.

**All five apps sync automatically across devices.**

---

## How it works

### Data & sync

```
Browser localStorage  ──sync──▶  /api/sync  ──▶  Turso, table docs(key, data, etag)  (if TURSO_DATABASE_URL is set)
   (instant, offline)                        └─▶  data/<doc>.json                (local fallback)
```

Data is synced as separate docs, so a change only moves the doc it touches:

| Doc | Contents |
|---|---|
| `library` | `watched`, `watchlist`, `dismissed`: what you chose |
| `history` | `displayed` (titles Discover has shown) and `shown` (titles Recommendations has shown) |
| `planner-YYYY-MM` | One month of todos |
| `planner-daily` | Repeating tasks |
| `planner-log` | Per-day wake and sleep time, weight, water, day log ticks and counts, review notes, and when a weekly review was finished |
| `planner-lists` | The planner's lists and their items (photos and voice notes only as references) |
| `planner-settings` | Tag changes, day templates, goals and day log items (built-ins have no entry until changed) |
| `planner-bin` | Tasks deleted, dropped or cleared in the last 7 days |
| `money-YYYY-MM` | One month of Money transactions (encrypted) |
| `money-settings` | Money people, limits/income/goal, learned payee categories, and the months with data (encrypted) |
| `books` | The Books library (title, author, source, a fingerprint of each file), your place in each book and any LibriVox recording you chose. Never the files themselves. A removed book stays as a marker so other devices delete their copy |
| `piano-YYYY-MM` | One month of Piano practice records (drill rounds, song runs, manual entries) |
| `piano-settings` | Piano unlocks, slow limits, song progress, the months with data, milestones reached, and the index of imported songs |
| `piano-song-<id>` | One imported song (compact notes, up to 200 KB), never edited; a deleted song becomes a `{removed: true}` marker |
| `push-subscriptions` | Devices that get closed-app reminders. Server only: never served by `/api/sync` |
| `media-<id>` | One photo or voice note, written once by `/api/media` and never through `/api/sync` |

Two more Turso tables sit beside `docs`, neither of them synced: `usage` (database reads and writes per half hour, for the stats page, served by `/api/usage`) and `login_attempts` (failed logins). Locally they're `data/usage.json` and `data/login-attempts.json`.

- **Writes are batched.** A change saves to `localStorage` at once and is pushed a few seconds later (5 s for the library and books, 3 s for the planner and piano), or when the tab is hidden. History changes ride along with the next push. Books saves your place locally after every sentence but only pushes when playback stops or the chapter changes.
- **Reads are cheap.** A page syncs on open, at most every 2 minutes, and again when the tab comes back into view after that. The client sends the etags it holds, so an unchanged doc comes back as `unchanged` with no body.
- **Merges are three-way.** Each device keeps the last copy it agreed on with the server, so a removal or a cleared history on one device carries to the others instead of coming back. A device that never pulled a doc can only create it, not replace it. Planner items carry `updatedAt`, so when both devices edited the same todo, the later edit wins.
- **Media is written once and cached for good.** Each photo or voice note gets a random id, is uploaded once to `/api/media/<id>` and served back with `Cache-Control: private, immutable`. Deleting an item, a photo, or a list deletes its media too.
- **Money docs are encrypted at rest.** The server seals them with AES-256-GCM (key from `MONEY_ENCRYPTION_KEY`, bound to the doc key) before writing to Turso or `data/`, so the database only holds `enc:v1:…` ciphertext. Without a valid key, money docs are neither written nor read, and nothing falls back to plain text. Your browser's copy and exports are plain, as the UI needs them.
- **Book files never leave the device.** EPUBs and PDFs live in the browser's IndexedDB; a book's id is a hash of its file, so the same file is the same book everywhere.
- Watch data lives in `localStorage` under `reel-radar-v1`. Each title is identified by `"<mediaType>:<tmdbId>"`, e.g. `movie:550` or `tv:1396`.

### Keeping Vercel usage low

- TMDB responses stay in Next's data cache for 6 hours (lists) or 7 days (details). TMDB-backed GET routes send `Cache-Control: private` for the same times, so the browser answers repeat requests itself. A list can therefore be up to 12 hours old, and a title or person up to 14 days.
- **↻ Get latest from TMDB** (on Discover, Recommendations, Search, Similar and person pages) gets past both caches. It expires the server's lists plus that page's person or title, then reloads the page's data.
- Recommendations keep each filter combination's results while the page is open. Requests send only the fields ranking needs, not whole titles.
- Posters load at a size that fits their slot: `w154` for list rows, `w342` for small thumbnails, and a `srcset` on title cards.
- Book search, Standard Ebooks downloads, LibriVox audio and Piano all run in the browser. Only Gutenberg EPUBs, the LibriVox and NoobNotes lookups go through small server routes (their sites don't allow cross-origin requests).
- The proxy skips static files and `/api/push/send`, and every route that calls TMDB, an outside site or the database sets `maxDuration`.
- `vercel.json` skips the build when a push only changes docs, tests or `data/`.
- Trailers are YouTube embeds and posters load straight from TMDB, so neither touches Vercel.

### Security

- **Login.** `src/proxy.ts` guards every page and API route except `/login`, `/api/auth/*`, and static files. Sessions last 30 days in an HMAC-signed cookie (`httpOnly`, `sameSite=lax`, `secure` in production). A wrong password waits 800 ms, on top of the hourly lockout.
- **`/api/push/send`** skips the login and checks `PUSH_CRON_SECRET` itself. It stays shut when the secret isn't set.
- **Outbound fetches are pinned.** The Gutenberg route only accepts a book number and only contacts gutenberg.org; the LibriVox route only passes on archive.org audio links; the NoobNotes route only contacts noobnotes.net, redirects included.
- **Untrusted files.** Uploaded EPUBs, PDFs, MIDI files and statements are size-capped and parsed defensively; copy-protected EPUBs are refused, and PDFs load no fonts.
- **Headers.** Every response sends `X-Frame-Options`, a `frame-ancestors` CSP, `X-Content-Type-Options`, `Referrer-Policy`, and a `Permissions-Policy` that allows only this site's own microphone (for voice notes). See [`next.config.mjs`](next.config.mjs).
- **Private data.** The TMDB key stays on the server. Money docs are encrypted at rest, statements are read in the browser, and real names come from environment variables. Statement PDFs under `data/` are gitignored.
- **No offline page cache.** The service worker only shows notifications, so private pages are never cached by it.

### Indian vs Global

A title counts as **Indian** if its origin country is `IN` or its original language is one of `hi, te, ta, ml, kn, bn, mr, pa, gu`. This rule is defined once in [`src/lib/region.ts`](src/lib/region.ts), and the discover feed, recommendations, analytics, and title cards all use it.

### Recommendation scoring

Your watched titles are combined into a weighted profile of genres, creators, cast, and keywords. Finished seasons add extra weight. Each candidate is then scored:

```
score = ( 4.0·genre + 2.6·director/creator + 1.8·cast + 2.0·keywords
        + quality·rating + popularityBonus + 0.4·formatFit − dislike )
        × regionFactor × seenPenalty
```

- **quality / popularityBonus**: set by the discovery style. *Deep cuts* raises the weight on rating and penalises blockbusters.
- **dislike**: overlap with titles you marked **Not interested** (by genre, people, and keywords).
- **regionFactor**: if at least 20% of what you watch is Indian, Indian titles score 1.4 and global titles 0.85. Otherwise every title scores 0.5, except Indian titles rated 7.5 or higher, which score 0.95.
- **seenPenalty**: titles you've already been shown are multiplied by 0.45.

Watched, watchlisted, and dismissed titles are never recommended, and the era and mood filters remove candidates before scoring. The top-scoring candidates are then sorted into the four groups and the themed shelves, with a step that keeps the genres varied. The ranking is deterministic, so the same inputs always give the same results. The implementation is in [`src/lib/recommend.ts`](src/lib/recommend.ts).

---

## Project structure

```
src/
├── proxy.ts                      # Auth gate: pages redirect to /login, APIs return 401
├── app/
│   ├── layout.tsx, globals.css   # Root layout + Tailwind base
│   ├── page.tsx                  # Home: app launcher (cards from lib/apps.ts)
│   ├── reel-radar/               # Reel Radar landing page
│   ├── discover/  recommendations/  similar/  analysis/
│   ├── watched/   watchlist/        dismissed/  search/   person/[id]/
│   ├── todos/                    # Daily Planner: one page, four tabs (Today, Calendar, Plans, More) and their parts
│   ├── money/                    # Money: overview, import/, settings/
│   ├── books/                    # Books: library, search and upload; [id]/ the player and LibriVox recordings
│   ├── piano/                    # Piano: home, Stage, practice/ (today's session), Results, notes/ chords/ fingers/ rhythm/ ear/,
│   │                             #   songs/ (list, player, MIDI and NoobNotes import), scales/, metronome/, play/, log/
│   ├── login/
│   └── api/
│       ├── discover/        GET   TMDB discover feed (region filters)
│       ├── recommendations/ POST  Score & categorise candidates for the posted history
│       ├── similar/         GET   ?type=&id=&minYear=&maxYear=&limit=
│       ├── search/          GET   ?query=
│       ├── title/           GET   Title details, credits, trailer
│       ├── person/[id]/     GET   Person credits
│       ├── tmdb/refresh/    POST  Expire the server's cached TMDB lists, plus one person or title
│       ├── sync/            GET ?keys=doc:etag,…  /  POST { key, data, baseEtag }
│       ├── media/[id]/      GET / PUT (raw file, ≤1.5 MB) / DELETE  Photos and voice notes for lists
│       ├── books/gutenberg/[id]/ GET  A Project Gutenberg book's no-illustrations EPUB (≤ 4.4 MB)
│       ├── books/librivox/  GET   LibriVox recordings for a title, or one recording's sections
│       ├── piano/noobnotes/ GET   ?url=  A noobnotes.net song page's title and note lines
│       ├── push/            GET key / POST / DELETE  This device's reminder subscription
│       ├── push/send/       POST (scheduler secret, no session)  Send the reminders that are due
│       ├── usage/           GET   Database reads and writes per half hour, for the stats page
│       ├── money/family/    GET   Starter family from MONEY_MY_NAMES and MONEY_FAMILY
│       └── auth/login, auth/logout   POST
├── components/
│   ├── TitleCard.tsx, TitleDetailsModal.tsx   # Poster card; trailer, synopsis, cast & crew
│   ├── StorageControls.tsx       # Reel Radar export / import
│   ├── AppSwitcher.tsx           # Header brand: Home link + switch-app menu
│   ├── ReelNavLinks.tsx          # The shared Reel Radar page links, with counts
│   ├── TmdbRefreshButton.tsx     # "Get latest from TMDB"
│   ├── PianoKeyboard.tsx         # SVG piano keyboard (held/target keys, finger numbers, tints)
│   └── LogoutButton.tsx
├── lib/
│   ├── apps.ts                   # App registry used by the home page and AppSwitcher
│   ├── auth.ts                   # HMAC session cookie (Web Crypto, edge-safe)
│   ├── sync.ts, syncDocs.ts      # Client sync engine (etags, batching, three-way merge); doc shapes and merges
│   ├── docStore.ts               # Server: docs as Turso rows, or data/ locally; money encryption; usage counts
│   ├── http.ts                   # cachedJson(): browser-cacheable API responses
│   ├── tmdb.ts, recommend.ts, analysis.ts, region.ts, storage.ts   # Reel Radar
│   ├── todos.ts, lists.ts, media.ts, planner*.ts, autoSchedule.ts, quickAdd.ts, usageStats.ts   # Daily Planner
│   ├── reminders.ts, push.ts, pushReminders.ts, webPush.ts   # Reminders (shared rules, browser, server, VAPID)
│   ├── money.ts, moneyFamily.ts, gpayStatement.ts, paytmStatement.ts   # Money
│   ├── books.ts, booksDoc.ts, epub.ts, pdf.ts, pdfText.ts, sentences.ts, player.ts, usePlayer.ts, voices.ts,
│   │   useWakeLock.ts, catalogue.ts, sources.ts, standardEbooks.ts, gutenberg.ts, librivox.ts   # Books
│   ├── piano*.ts                 # Piano: MIDI and synth, timing engine, drills (ear training too), songs, chord charts and ladders,
│   │                             #   bar loops, recording, touch, milestones, scales, MIDI file and NoobNotes import, fingering,
│   │                             #   session planner, log, local data and sync
│   └── *.test.ts                 # Vitest unit tests
├── test/                         # Shared test helpers: fixtures, fake PDFs, EPUBs, MIDI devices and files, audio
└── types/title.ts                # Title, MediaType, keyOf()
public/                           # Web app manifest, icons, service worker (sw.js, notifications only)
data/                             # storage.json backup (tracked); local fallback docs and statement PDFs (gitignored)
scripts/upload-storage.ts         # Upload data/storage.json to Turso as the library/history docs
scripts/migrate-blob-to-turso.ts  # One-off: copy the old Vercel Blob docs into Turso
```

Imports use the `@/` alias for `src/`. Each app has its own look: Reel Radar uses the Tailwind tokens `ink` `#07070c` (background), `panel` `#11111a` and `gold` `#f6c453` (accent); the planner uses `bf-*` tokens (light and dark); Piano uses `pn-*` tokens (claret felt, ivory, ebony, brass).

`CLAUDE.md` has the detailed file-by-file layout, invariants and testing rules.

---

## Testing

`npm test` runs about 1,730 tests in 131 files, entirely offline. Coverage is about 99% of lines, 98% of statements and functions, and 93% of branches (`npm run coverage`; it fails below 97% of lines or statements, 95% of functions or 90% of branches). TMDB and `fetch` are mocked, sync runs against an in-memory libSQL database, and the storage tests write to a temporary directory, never to `data/`.

| Area | What's covered |
|---|---|
| `lib/recommend`, `lib/analysis`, `lib/region`, `lib/tmdb` | Scoring, filters, categories, explanations, every analytics metric, personas; TMDB normalisation, retry and errors |
| `lib/sync`, `lib/syncDocs`, `lib/docStore` | Three-way merge, batching, refocus sync, conflict retry, mid-push edits, encryption at rest |
| Planner (`lib/todos`, `lib/lists`, `lib/planner*`, `lib/autoSchedule`, `lib/quickAdd`, `lib/usageStats`) | Daily tasks, repeats, streaks, carry-over, deadlines, goals, day log, lists, search, stats, backup, proposed plans, add-box shorthand |
| `lib/money`, `lib/moneyFamily`, `lib/gpayStatement`, `lib/paytmStatement` | Spending and balances, categories, backup and restore, starter family, statement parsing against generated fake PDFs |
| Books (`lib/books`, `lib/booksDoc`, `lib/epub`, `lib/pdf`, `lib/pdfText`, `lib/player`, catalogues, LibriVox) | EPUB and PDF reading (DRM, scans, outlines, headers and footers, columns), library sync and removal across devices, the sentence player, search merging, recordings |
| Piano (`lib/piano*`, every `/piano` page) | MIDI connection and hot-plug, timing engine, drills and unlocks, rhythm, songs in wait and play-along modes, chord charts, ladders, bar loops, record and replay, evenness of touch, ear training, milestones, scales, exercises, MIDI file and NoobNotes import, session planner, log and streaks, sync — driven by a fake MIDI device and clock |
| `lib/reminders`, `lib/push`, `lib/webPush`, PWA | Reminder rules, subscribing, VAPID signing and payload encryption, manifest and service worker |
| `lib/auth`, `proxy`, security headers | Session signing and expiry, redirects, 401s, headers on every response |
| API routes | Validation, responses, cache headers, conditional reads and writes, migration, media, push, usage, outbound-host pinning |
| Every page | Rendered and driven through the UI against the real `lib/` code: Reel Radar pages, every planner tab, Money, Books and Piano |

---

## Deploying to Vercel

1. Import the repo into Vercel.
2. Add `TMDB_API_KEY`, `APP_USERNAME`, `APP_PASSWORD`, and `AUTH_SECRET` as environment variables.
3. Create a Turso database (`turso db create reel-radar`, `turso db show reel-radar --url`, `turso db tokens create reel-radar`) and add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
4. Add `MONEY_ENCRYPTION_KEY` (`openssl rand -base64 32`), the same value as in `.env.local`.
5. Optional: add `MONEY_MY_NAMES` and `MONEY_FAMILY` for Money's starter family, and set up [reminders with the app closed](#reminders-with-the-app-closed).
6. Deploy.

Without a Turso database, sync on Vercel won't persist, because its filesystem is read-only and temporary.

---

## Install as an app

The site is an installable web app, named "My Apps" and opening on the home page. In Chrome or Edge, use the install icon in the address bar or **Add to Home screen** in the menu. On iPhone, use Share → **Add to Home Screen** in Safari; iOS only allows notifications for sites added this way.

## Reminders with the app closed

Turning on 🔔 Reminders in the planner subscribes that device. Each device has its own setting. If push isn't set up or the browser can't do it, reminders still fire while the page is open. Logging out stops them on that device.

Vercel Hobby cron jobs only run daily, so an outside scheduler triggers the sending. To set it up:

1. **Generate the keys** (once; the command is also in `.env.example`):
   ```bash
   node -e "const c=require('crypto').createECDH('prime256v1');c.generateKeys();console.log('VAPID_PUBLIC_KEY='+c.getPublicKey('base64url')+'\nVAPID_PRIVATE_KEY='+c.getPrivateKey('base64url'))"
   openssl rand -hex 32   # PUSH_CRON_SECRET
   ```
2. **Add them to Vercel** with `VAPID_SUBJECT` (`mailto:` plus an address of yours), then redeploy.
3. **Create the scheduled job**, for example on [cron-job.org](https://cron-job.org): `POST https://<your-app>/api/push/send`, every minute, with the header `Authorization: Bearer <PUSH_CRON_SECRET>`.
4. **Turn on 🔔 Reminders** in the planner on each device.

What a run costs, once per minute with at least one device subscribed: one function call and 3 database reads (subscriptions, daily tasks, this month), so about 43,000 calls and 130,000 reads a month, plus up to one `usage` write a minute. Each reminder sent adds one read and one write. With no devices it's one read a run. A slower schedule costs less, but reminders can be late by up to its interval, and an interval over 5 minutes can miss "At start" reminders.

Task text is encrypted so that only the device can read it; the push service sees ciphertext. Changes need about 3 seconds to reach the server, so a task added on a device that's offline only gets a reminder once that device syncs. If you replace the VAPID keys, turn Reminders off and on again on each device.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SyntaxError: Unexpected token '?'` when running `npx tsc` or `npm test` | Your Node is too old. Use Node 22 (`nvm use`). |
| Every page redirects to `/login` | Set `APP_USERNAME`, `APP_PASSWORD`, and `AUTH_SECRET` in `.env.local`, then restart the dev server. |
| Login says "Too many failed logins" | Wait the minutes it shows, or use a device that's still signed in. To unlock right away, clear the `login_attempts` table in Turso (or delete `data/login-attempts.json` locally). |
| `TMDB_API_KEY is not configured` / empty feeds | Add the key to `.env.local` and restart. |
| TMDB requests time out (common on WSL) | Requests already retry once. Check your network or DNS. |
| Piano says the keyboard isn't supported | Web MIDI needs Chrome or Edge (not Safari or iPhone). Allow MIDI access when asked, and check the USB cable. |
| Books won't read aloud | The browser needs speech synthesis (Chrome works; some in-app browsers have none). |

### Reset the "already shown" lists

Use **Clear Displayed & Shown** on the Discover page. It clears `shown` and `displayed` on every device.

### Move old Blob data to Turso

One time, with `BLOB_READ_WRITE_TOKEN`, `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env.local`. The script only reads Blob and skips docs Turso already has, unless you add `--overwrite`:

```bash
npx tsx scripts/migrate-blob-to-turso.ts          # list what would be copied
npx tsx scripts/migrate-blob-to-turso.ts --apply  # copy it
```

### Upload a backup to Turso

`data/storage.json` (a Reel Radar export) can be uploaded as the synced docs. The script merges it with what the store already holds, so nothing is lost:

```bash
npx tsx scripts/upload-storage.ts --dry-run  # show what would be written
npx tsx scripts/upload-storage.ts            # write it
# add --purge-old-planner to also delete the old per-day planner blobs under todos/ in Blob (needs BLOB_READ_WRITE_TOKEN)
```

---

*This product uses the TMDB API but is not endorsed or certified by TMDB.*
