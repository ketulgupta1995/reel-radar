# Reel Radar 🎬

Three personal apps for one user, behind a single login and installable on your phone or laptop:

- **Reel Radar**: a movie & TV tracker covering Indian and global cinema. Log what you've watched (down to the season), keep a watchlist, and get recommendations and analytics based on your own taste.
- **Daily Planner**: time-blocked days, repeating tasks and streaks, deadlines, goals, lists, search across everything, a weekly review, stats, and reminders that work with the app closed.
- **Money**: spending, limits and what you owe family, with Google Pay and Paytm statement import.

Built with **Next.js 16 (App Router)**, **React 19**, **TypeScript**, and **Tailwind CSS**, with live metadata from **TMDB**. Your data is kept in the browser and synced across devices through **Turso** (or to local JSON files during development).

---

## Quick start

**You need:** Node.js **20.9+** and a free [TMDB v3 API key](https://www.themoviedb.org/settings/api).

```bash
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

| Page | What you can do |
|---|---|
| `/` | **Home**: one card per app (Reel Radar, Daily Planner, Money, Books). Inside an app, the header shows a ⌂ Home button and a ▾ menu to switch to another app; it doesn't link to the other apps' pages directly. |
| `/reel-radar` | Reel Radar landing page with a live spotlight of trending Indian and global titles |
| `/discover` | Endless feed you can filter by format (both / movies / series) and region (All / Indian / Global). Each card has **Mark seen**, **+ Watchlist**, **Not interested**, and **Trailer & details** buttons. |
| `/recommendations` | Unlocks after **10 logged titles**. Results come in four groups: Indian Movies, Global Movies, Indian Series, Global Series, plus themed shelves (Hidden Gems, Mind-Bending, Modern Classics) when each has at least 3 titles. You can tune them by discovery style (balanced / popular / deep cuts), era (pre-2005, 2005-2019, 2020s) and mood (dark, adrenaline, feel-good, mind-bending), narrow them by format and region, and each pick says why it was recommended. |
| `/similar` | Titles similar to one you choose, with an optional year range |
| `/analysis` | Taste analytics: total titles, hours watched, average rating, Indian vs global split, genres, decades, top directors and actors, blind spots, and your viewer "persona". Filter by movies/series and Indian/global. |
| `/watched` | Everything you've watched, with season-by-season progress for series |
| `/watchlist` | Your saved titles, with sorting and filters |
| `/dismissed` | Everything you marked **Not interested**. Restore one title, or all of them, to let them show up again. |
| `/search` | Search across movies, series, and people |
| `/person/[id]` | An actor's or director's filmography, with quick watch and watchlist buttons |
| `/todos` | **Daily Planner**: tasks with a title, an optional note, a checklist, a priority and a colour tag (Work, Home, Health…), on a drag-to-schedule timeline where you resize blocks by dragging their bottom edge. A week strip on the day view jumps between nearby days. A **month view** shows finished tasks as a heatmap; click a day to open it. A **week view** shows seven days side by side; drag tasks between days to move them, or hold Ctrl/Alt while dropping to copy. Each task also has a ⇄ button to move or copy it to any date. A **focus timer** on any task counts down its planned time and records the time actually spent. Tasks can repeat every day, on chosen weekdays, every N days, monthly (shorter months use their last day), or N times a week on any day (it shows up daily until that week's target is met), with a 🔥 streak count. Repeating tasks don't appear in auto-schedule or day templates. **Auto-schedule** proposes times for unscheduled tasks between your wake and sleep times, by priority and length, and nothing is saved until you've reviewed and applied the plan. **Day templates** save a day's one-off tasks and times to add to any other day. **Tags** can be added, renamed and removed, up to 8 so colours stay distinct; a removed tag stays on old tasks and in stats. The planner can remind you before each block, even with the app closed once [push is set up](#reminders-with-the-app-closed), and an **Overdue** tray on today's view holds unfinished tasks from every past day: move them to today or drop them. A task can have a **deadline**, separate from the day it's planned on, so moving the task never moves it: set it from the task's 🏁 chip, the add box's options, or shorthand (`Tax return by fri`, `due 15 nov`). A **deadlines** tray on today's view lists tasks that are late or due within 7 days, wherever they're planned, and a task in it isn't listed under Overdue as well. A task planned after its deadline is marked in red. Repeating tasks and copies of a task have no deadline. Tasks and repeats can also be linked to a **goal** (see `/todos/goals`). A task postponed 3 or more times asks "Drop it or break it down?". A block's panel suggests a realistic length once that tag has enough timed history. Type shorthand in the add box (`Gym 6pm 45m #health !high daily`) to set time, length, tag, priority and repeat in one go. It also takes dates (`tomorrow`, `fri`, `next fri`, `15 nov`), deadlines (`by fri`, `due 15 nov`) and repeats (`every 3 days`, `every 2 weeks`, `every mon thu`, `weekly`, `monthly`, `on the 1st`, `3x week`), and shows how it read them before you add the task. `sun`, `sat` and `mon` are also ordinary words, so on their own they only count at the end of the title or after `on`. Drag the ⋮⋮ handle (or use ↑/↓) to reorder tasks. At the top of today, **Next up** shows the block under way, else the next one, else the first task on the list, to start or finish in one tap. The deadlines tray and the day log stay on one line until opened, and the day log keeps a + Glass button to hand. A day log records wake and sleep times on a clock, your weight in kg, water against a 2.5 L goal, and a short review; wake, sleep and water also show as marks on the schedule. Keyboard: N or / to add, ← → to change day, T for today, W for the week view, M for the month view. |
| `/todos/goals` | **Goals**: bigger aims with an optional date. Link tasks and repeats to a goal from their 🎯 chip or the add box's options, or add steps on the goal's card (the add box's shorthand works there). Each card shows tasks finished and still open, this week's count, focus time, when something was last done, and the next step, or asks for one if there's none. The bar counts one-off tasks only, as repeats have no end. Finished copies of a repeat count, including those from before it was linked; missed ones don't. Mark a goal achieved to file it away, or reopen it. Deleting a goal (after a second click) leaves its tasks. Pulls every month from the server first. |
| `/todos/search` | **Search** every day's tasks (title, note, checklist), repeating tasks, day notes, goals and lists, and jump to what you find. A repeating task is one row saying how often it was done and when it last was. Pulls everything once on open; typing only reads this browser's copy. |
| `/todos/lists` | Planner **lists**: things to remember that don't belong to a day (a wishlist, gift ideas, books to read). Make as many named lists as you like, each with an icon. An item can hold a note, a link, a price (each list totals what's still to get), photos and voice notes (up to 6 per item; voice notes up to 2 minutes). Typing `Headphones ₹2,999 amazon.in/x` in the add box fills in the price and link. Pin items to the top, tick them off into a Done section, move them between lists, search across all lists, or add one to today's tasks. 📷 opens the phone camera or photo picker; photos are shrunk to 1600 px before upload. |
| `/todos/review` | **Weekly review**: a guided flow, suggested on Sundays. Look back at what got done, how each goal moved, what slipped and your notes; decide on each unfinished task (pick a day, drop it, or move it to a list); then plan the days ahead, optionally linking what you add to a goal. On a Sunday it covers the week ending today; on other days, the week that ended last Sunday. |
| `/todos/stats` | Planner stats: sleep, water and weight trends from the day log; how completion lines up with sleep and water (at least 5 days each way, a pattern rather than a cause); completion rate by weekday, planned vs. done hours, tasks by tag, focus time, the most postponed tasks; planned vs. actual time by tag with a suggested block length (at least 3 finished, timed blocks per tag, leaving out sessions under ¼ or over 4× the plan); and database reads and writes per day for the whole app, over 7/30/90 days or all time. Pulls every month from the server first, so it covers all your devices. |
| `/money` | **Money**: a hero card with the month's spending (change vs last month, the monthly limit and about how much a day is left), a bar per day with the daily average, income, what you saved against your goal, and what you owe family; spending by category (share of the month, per-category limits); and a card per family member with what you owe them (what they've spent since you last paid them, as each payment covers what they'd spent up to then; everything they've spent if you never have), what they spent and you paid them that month, a **Paid ✓** button, and **Show transactions**: every payment to them, their spending and money between you, each marked You paid, Owed (after your last payment), Covered (before it) or Not counted. Transactions are grouped by day with the day's total, searchable (payee, note, category) and filterable by person; tap one to change its category, type (spent, refund, income, paid back, ignored), whose it is, its note, or delete it. The **+** button opens a sheet to add one (the category is guessed from the name; "Paid back" picks a family member). The **💵** button logs cash spending: type the amount, tap a category, and it's saved (marked "💵 Cash"; the hero shows how much of the month's spending was cash). **Sort your spending** shows imported spending nobody has confirmed a category for (still Other, or matching more than one category's keywords), one payee at a time with the likely categories first: a tap files all that payee's payments under it and learns it for later imports; **Keep as Other** also stops it being asked again; **Skip for now** hides it until the page reloads. On first use, after a sync shows no family yet, the family from `MONEY_FAMILY` is filled in and your own statement names from `MONEY_MY_NAMES` are set (nothing is added while they're unset). |
| `/money/import` | Import a **Google Pay or Paytm statement PDF**, yours or a family member's: drop or pick the file, and whose it is is picked from the email (or, for Paytm, the account holder's name) at its top (with a warning if the chosen owner appears in it as a payee). Rows already imported under someone else are moved to the right person. It's read in the browser (no upload, no PDF library, up to 20 MB), checked against the statement's printed total, and shown for review with totals by type: untick rows (or select all / none), show only rows that still need a category, fix a category or type, then import. Afterwards, **Sort your spending** asks about that import's rows that still need a category. Rows are keyed by UPI transaction id (Paytm's "UPI Ref No"), so importing the same statement twice, or the same payment from both sides, even one side from Paytm, keeps one copy. |
| `/money/settings` | Your name(s) as statements show them, family members and their names, monthly income, savings goal, and spending limits (overall and per category). **Backup & export**: download a JSON backup (transactions, people, limits, learned categories), download every transaction as a CSV for Excel or Google Sheets (with a Spending column: refunds negative, money that isn't spending 0), or restore a backup, which adds to what's here (same id: the backup's copy wins; settings merge by newest) and deletes nothing. **Delete all money data** (after a second click) empties every month and the settings on all devices; it syncs first, and refuses while offline. |
| `/books` | **Books** (in progress). **Search** Standard Ebooks and Project Gutenberg at once: one list, a book on both sites shows once with its Standard Ebooks edition, and if one site is down you get the other's results with a note. Tap Add and the EPUB downloads to this device (Standard Ebooks straight from their site; Gutenberg through a small route that only contacts Gutenberg and sends the no-illustrations edition, so a book over 4.5 MB is refused with a message). **Upload an EPUB** (DRM-free, up to 50 MB) works too. The same file is only added once, and copy-protected or invalid files get a plain error. The file stays in this browser (IndexedDB). **Your library and your place in each book sync across devices** (the `books` doc): a book added on another device shows up here as "The file isn't on this device", with a Download button for catalogue books or "Add the file on this device" for uploads, and adding the same file brings your place back (files are matched by a fingerprint, so a different edition starts fresh). **Remove** takes a book out of the library on every device and deletes its file here; other devices delete their copy the next time they open Books. The plan is in `.scratch/books/`. |
| `/books/[id]` | **Player.** Press Play and the browser reads the chapter aloud one sentence at a time, with the current sentence highlighted. Tap a sentence, or use Back and Next, to jump. Pause stops at once and Play repeats that sentence. At the end of a chapter it carries on into the next. Very long sentences are spoken in pieces of at most 1,000 characters, because Android's speech engine fails on longer text. Your place is saved on this device after every sentence. You can pick a **voice** (a short English list, phone voices first) and a **speed** (0.75× to 2×, applied from the next sentence); both are remembered. The screen stays on only while playing. If the app goes to the background, playback pauses. A sentence that fails to speak is tried again twice, then playback stops with a message. **Recordings.** If LibriVox has volunteer recordings of the book (public-domain books only), *Find a recording* lists them with who read them and how long they are, and you choose one yourself, since a title alone can match the wrong book. Choosing one switches the page to the recording, which plays section by section straight from archive.org (no server involved), with the browser's seek bar, your speed, Previous/Next section, and the next section starting by itself. A recording's sections don't line up with the book's chapters, so only the section is tracked (no sentence highlighting), and switching between the recording and the phone's voice keeps your chapter number. The recording you chose syncs, and each device remembers which way you listen. Needs a browser with speech (Chrome; the Claude app's built-in browser has none). Shows "upload the file again" if the file isn't on this device. |
| `/login` | Single-user sign-in. Every other page and API route requires it. |

**Season tracking.** Series are tracked per season (S1, S2, …). The more seasons you finish, the more weight a series carries in your taste profile.

**Backup.** Export your history and watchlist to a `.json` file, or import one to restore or merge data, from the controls on Reel Radar's pages. **Reset All** there clears your Reel Radar data on every device, after a confirmation. The planner has its own Export and Import: one file with every day, daily task, day log, list, tag, day template and goal. Export pulls from the server first, so the file covers all your devices (it warns you if it couldn't). Photos and voice notes on list items aren't in the file: it keeps references, and the files stay on the server. Importing adds to what's there and never deletes; older planner files still import. Money has its own backup in `/money/settings`. All three apps also sync automatically across devices.

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
| `planner-daily` | Repeating daily tasks |
| `planner-log` | Per-day wake time, sleep time, weight (kg), water (ml), review notes, and on a Sunday when its weekly review was finished |
| `planner-lists` | The planner's lists and their items (photos and voice notes only as references) |
| `planner-settings` | Tag changes (built-ins have no entry until changed), day templates and goals |
| `push-subscriptions` | Devices that get closed-app reminders. Server only: never served by `/api/sync` |
| `media-<id>` | One photo or voice note (`{ mime, data }`, base64), written once by `/api/media` and never through `/api/sync` |
| `money-YYYY-MM` | One month of Money transactions |
| `money-settings` | Money people, limits/income/goal, learned payee categories, and the list of months with data |
| `books` | The Books library (title, author, source, a fingerprint of each file) and where you stopped in each book. Never the EPUB files, which stay on each device. A removed book stays as a marker, so other devices delete their copy of the file. Also the LibriVox recording you chose for a book |

Two more Turso tables sit beside `docs`, neither of them synced: `usage` (database reads and writes per half hour, for the stats page, served by `/api/usage`) and `login_attempts` (failed logins). Locally they're `data/usage.json` and `data/login-attempts.json`.

- **Media is written once and cached for good.** Each photo or voice note gets a random id, is uploaded once to `/api/media/<id>` (one database write) and served back with `Cache-Control: private, immutable`, so each device reads it from the database at most once. Deleting an item, a photo, or a list deletes its media too. Media isn't encrypted, the same as the planner docs.
- **Money docs are encrypted at rest.** The server seals them with AES-256-GCM (key from `MONEY_ENCRYPTION_KEY`) before writing to Turso or `data/`, and opens them when reading, so the database only ever holds `enc:v1:…` ciphertext. Each one is bound to its doc key. Without a valid key, money docs are neither written nor read, and nothing falls back to plain text. A plain doc saved before encryption was added is sealed the first time it's read. Your browser's own copy (`localStorage`) and exports are plain, as the UI needs them.

- **Writes are batched.** A change saves to `localStorage` at once and is pushed a few seconds later (5 s for the library, 3 s for the planner), or when the tab is hidden. History changes ride along with the next push.
- **Reads are cheap.** A page syncs on open, at most every 2 minutes, and again when the tab comes back into view after that. The client sends the etags it holds, so an unchanged doc comes back as `unchanged` with no body.
- **Merges are three-way.** Each device keeps the last copy it agreed on with the server, so a removal or a cleared history on one device carries to the others instead of coming back.  A device that never pulled a doc can only create it, not replace it, so it merges the same way. Planner items carry `updatedAt`, so when both devices edited the same todo, the later edit wins.
- Watch data lives in `localStorage` under `reel-radar-v1` as `{ watched, watchlist, displayed, shown, dismissed }`. Saved titles drop `keywords`, `trailerYoutubeId` and `why`, which are always fetched fresh.
- Each title is identified by `"<mediaType>:<tmdbId>"`, e.g. `movie:550` or `tv:1396`.
- The first sync migrates an old single-file `storage.json` into `library` and `history`. `scripts/upload-storage.ts` uploads `data/storage.json` by hand (see below).

### Keeping Vercel usage low

- TMDB responses stay in Next's data cache for 6 hours (lists) or 7 days (details). TMDB-backed GET routes send `Cache-Control: private` for the same times, so the browser answers repeat requests itself. A list can therefore be up to 12 hours old, and a title or person up to 14 days.
- **↻ Get latest from TMDB** (on Discover, Recommendations, Search, Similar and person pages) gets past both caches when you want something newer. It expires the server's lists plus that page's person or title, then reloads the page's data. Other title details stay cached, so one press doesn't mean hundreds of TMDB calls; it costs a function call plus the TMDB requests the page then makes.
- Recommendations keep each filter combination's results while the page is open, so going back to one costs no request; **Refresh recommendations** or a change to your lists asks again. Requests send only the fields ranking needs, not whole titles.
- Posters load at a size that fits their slot: `w154` for list rows, `w342` for small thumbnails, and a `srcset` on title cards.
- The proxy skips static files and `/api/push/send`, and every route that calls TMDB or the database sets `maxDuration`.
- `vercel.json` skips the build when a push only changes docs, tests or `data/`.
- Trailers are YouTube embeds and posters load straight from TMDB, so neither touches Vercel.

### Security

- **Login.** `src/proxy.ts` guards every page and API route except `/login`, `/api/auth/*`, and static files. Sessions last 30 days in an HMAC-signed cookie (`httpOnly`, `sameSite=lax`, `secure` in production). A wrong password waits 800 ms, on top of the hourly lockout.
- **`/api/push/send`** skips the login and checks `PUSH_CRON_SECRET` itself. It stays shut when the secret isn't set.
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
│   ├── todos/                    # Daily planner: page, AddTaskForm, TaskTrays, TodoItem, NextUp, WeekView, MonthView, AutoSchedule, RepeatPicker, PlannerTools,
│   │                             #   Slipping, Deadlines, ClockTimePicker, shared planner.tsx; stats/, lists/, review/, goals/, search/
│   ├── money/                    # Money: overview page, import/, settings/, shared.tsx, ReviewQueue.tsx
│   ├── books/                    # Books: library page with upload, [id]/ chapter view
│   ├── login/
│   └── api/
│       ├── discover/        GET   TMDB discover feed (region filters)
│       ├── recommendations/ POST  Score & categorise candidates for the posted history
│       ├── similar/         GET   ?type=&id=&minYear=&maxYear=&limit=
│       ├── search/          GET   ?query=
│       ├── title/           GET   Title details, credits, trailer
│       ├── person/[id]/     GET   Person credits
│       ├── sync/            GET ?keys=doc:etag,…  /  POST { key, data, baseEtag }
│       ├── media/[id]/      GET / PUT (raw file, ≤1.5 MB) / DELETE  Photos and voice notes for lists
│       ├── books/gutenberg/[id]/ GET  The no-illustrations EPUB of a Project Gutenberg book (≤ 4.4 MB; Gutenberg only)
│       ├── books/librivox/    GET   LibriVox recordings for a title, or one recording's sections (archive.org audio only)
│       ├── push/            GET key / POST / DELETE  This device's reminder subscription
│       ├── push/send/       POST (scheduler secret, no session)  Send the reminders that are due
│       ├── usage/           GET   Database reads and writes per half hour, for the stats page
│       ├── tmdb/refresh/    POST  Expire the server's cached TMDB lists, plus one person or title
│       ├── money/family/    GET   Starter family from MONEY_MY_NAMES and MONEY_FAMILY
│       └── auth/login, auth/logout   POST
├── components/
│   ├── TitleCard.tsx             # Poster card with badges & quick actions
│   ├── TitleDetailsModal.tsx     # Trailer, synopsis, cast & crew
│   ├── StorageControls.tsx       # Export / import
│   ├── AppSwitcher.tsx           # Header brand: Home link + switch-app menu
│   ├── ReelNavLinks.tsx          # The shared Reel Radar page links, with counts
│   ├── TmdbRefreshButton.tsx     # "Get latest from TMDB": gets past the server and browser caches
│   └── LogoutButton.tsx
├── lib/
│   ├── apps.ts                   # App registry used by the home page and AppSwitcher
│   ├── tmdb.ts                   # TMDB client: normalisation, 8s timeout + one retry, 6h/7d cache
│   ├── recommend.ts              # Taste profile, scoring, categorisation, "why" text
│   ├── analysis.ts               # Analytics aggregation
│   ├── region.ts                 # Indian vs Global rule (single source of truth)
│   ├── storage.ts                # Reel Radar state: load/save, merge, sync hook, export/import
│   ├── todos.ts                  # Planner model: daily tasks, carry-over, tags, focus timer, sync, backup
│   ├── lists.ts                  # Planner lists: items, links, prices, quick-add parsing, sync
│   ├── media.ts                  # Photo/voice uploads: shrinking, size and type limits
│   ├── sync.ts                   # Client sync engine: etags, batching, three-way merge, refocus
│   ├── syncDocs.ts               # Doc shapes and merges shared by client, server and script
│   ├── docStore.ts               # Server: docs as Turso rows, or data/ locally
│   ├── http.ts                   # cachedJson(): browser-cacheable API responses
│   ├── money.ts                  # Money model: transactions, people, limits, categories, import plan, sync
│   ├── moneyFamily.ts            # Parses the starter family from the environment (server only)
│   ├── gpayStatement.ts          # Reads a statement PDF (inflate, ToUnicode, hex/literal strings), Google Pay rows
│   ├── paytmStatement.ts         # Paytm statement rows
│   ├── plannerStats.ts           # Planner stats aggregation
│   ├── plannerInsights.ts        # Sleep, day log trends and patterns, planned vs. actual time, review week, month data, goal progress
│   ├── plannerSearch.ts          # Finds text in every day's tasks and day notes
│   ├── plannerSettings.ts        # Tags, day templates and goals (synced doc, useTags(), useGoals())
│   ├── autoSchedule.ts           # Proposes a day's plan from free time, priority and length
│   ├── quickAdd.ts               # Reads the add-box shorthand: time, length, tag, priority, date, repeat
│   ├── plannerBackup.ts          # Planner export and import: days, daily tasks, day log, lists, settings
│   ├── reminders.ts              # Reminder rules shared by the planner page and the server
│   ├── push.ts                   # Browser side of reminders: service worker, subscribing, notifications
│   ├── pushReminders.ts          # Server side: subscriptions, working out what's due
│   ├── webPush.ts                # VAPID signing and payload encryption with Node's crypto
│   ├── usageStats.ts             # Database reads/writes totalled per local day
│   ├── auth.ts                   # HMAC session cookie (Web Crypto, edge-safe)
│   └── *.test.ts                 # Vitest unit tests
├── test/                         # Shared test fixtures and setup
└── types/title.ts                # Title, MediaType, keyOf()
public/                           # Web app manifest, icons, service worker (sw.js, notifications only)
data/                             # storage.json backup (tracked); local fallback docs and statement PDFs (gitignored)
scripts/upload-storage.ts         # Upload data/storage.json to Turso as the library/history docs
scripts/migrate-blob-to-turso.ts  # One-off: copy the old Vercel Blob docs into Turso
```

Imports use the `@/` alias for `src/`. Tailwind theme tokens: `ink` `#07070c` (background), `panel` `#11111a`, and `gold` `#f6c453` (accent).

---

## Testing

`npm test` runs about 780 tests in 57 files, entirely offline. Coverage is about 99% of lines, 98% of statements, 97% of functions and 93% of branches (`npm run coverage`; it fails below 97% of lines or statements, 95% of functions or 90% of branches). TMDB and `fetch` are mocked, sync runs against an in-memory libSQL database, and the storage tests write to a temporary directory, never to `data/`.

| Area | What's covered |
|---|---|
| `lib/recommend`, `lib/analysis`, `lib/region` | Scoring, filters, categories, explanations, every analytics metric, personas |
| `lib/tmdb` | Normalisation, request retry and errors, discover/search/credits/detail, similar-title scoring |
| `lib/sync`, `lib/syncDocs` | Three-way merge, batching, refocus sync, conflict retry, mid-push edits |
| `lib/storage`, `lib/todos`, `lib/plannerStats` | Merge, sync, import/export, daily tasks, repeat days, streaks, subtasks, tags, moving between days, focus timer, reminders, carry-over, skip/undo, planner stats |
| `lib/plannerInsights`, `lib/plannerSearch`, `lib/plannerSettings`, `lib/plannerBackup`, `lib/autoSchedule`, `lib/quickAdd`, `lib/usageStats` | Day log trends, goal progress, search, tags, templates and goals, planner export and import, proposed plans, add-box shorthand, usage totals |
| `lib/lists`, `lib/media` | List items, links, prices, quick-add parsing, upload limits |
| `lib/money`, `lib/moneyFamily`, `lib/gpayStatement`, `lib/paytmStatement` | Spending and balances, categories, backup and restore, starter family, statement parsing against generated fake PDFs |
| `lib/reminders`, `lib/push`, `lib/webPush`, PWA | Reminder rules, subscribing, VAPID signing and payload encryption, manifest and service worker |
| `lib/auth`, `proxy`, security headers | Session signing and expiry, redirects, 401s, headers on every response |
| API routes | Validation, responses, cache headers, conditional reads and writes, migration, private → public, media, push, usage |
| Components, `/login` | Title card, details modal, backup controls, logout, sign-in flow and safe redirects |
| Every page | Rendered and driven through the UI against the real `lib/` code: discover feed and batches, season tracking, recommendations filters, analysis sections and graph, watched/watchlist sorting and filters, not interested, search, similar, person; the planner's add/edit/delete/undo, checklist, repeats, scheduling, drag and drop, resize, quick add, carry-over, move/copy, deadlines, focus timer, reminders, backup, sync, week view, lists, goals, search, weekly review and stats; Money's overview, import and settings |

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

What a run costs, once per minute with at least one device subscribed: one function call and 3 database reads (subscriptions, daily tasks, this month), so about 43,000 calls and 130,000 reads a month, plus up to one `usage` write a minute. Each reminder sent adds one read and one write. With no devices it's one read a run. These reads show up in the usage chart on the stats page. A slower schedule costs less, but reminders can be late by up to its interval, and an interval over 5 minutes can miss "At start" reminders.

Task text is encrypted so that only the device can read it; the push service sees ciphertext. Changes need about 3 seconds to reach the server, so a task added on a device that's offline only gets a reminder once that device syncs. If you replace the VAPID keys, turn Reminders off and on again on each device.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SyntaxError: Unexpected token '?'` when running `npx tsc` or `npm test` | Your Node is too old. Use Node 20.9+ (e.g. `nvm use 20`). |
| Every page redirects to `/login` | Set `APP_USERNAME`, `APP_PASSWORD`, and `AUTH_SECRET` in `.env.local`, then restart the dev server. |
| Login says "Too many failed logins" | Wait the minutes it shows, or use a device that's still signed in. To unlock right away, clear the `login_attempts` table in Turso (or delete `data/login-attempts.json` locally). |
| `TMDB_API_KEY is not configured` / empty feeds | Add the key to `.env.local` and restart. |
| TMDB requests time out (common on WSL) | Requests already retry once. Check your network or DNS. |

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
