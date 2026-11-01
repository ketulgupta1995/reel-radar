# Reel Radar 🎬

A personal movie & TV tracker for one user. Log what you've watched (down to the season), keep a watchlist, get recommendations and analytics based on your own taste, plan your day, and track spending. It covers both Indian and global cinema.

Built with **Next.js 14 (App Router)**, **TypeScript**, and **Tailwind CSS**, with live metadata from **TMDB**. Your data is kept in the browser and synced to **Turso** (or to local JSON files during development).

---

## Quick start

**You need:** Node.js **18.17+** and a free [TMDB v3 API key](https://www.themoviedb.org/settings/api).

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000, then sign in
```

### Environment variables

| Variable | Required | What it does |
|---|---|---|
| `TMDB_API_KEY` | ✅ | TMDB v3 key. Used only on the server. |
| `APP_USERNAME` | ✅ | Login username. |
| `APP_PASSWORD` | ✅ | Login password. |
| `AUTH_SECRET` | ✅ | Signs the session cookie. Generate one with `openssl rand -hex 32`. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | optional | Enables cloud sync via Turso. Without the URL, data is saved under `data/`. |
| `MONEY_ENCRYPTION_KEY` | for Money | Encrypts the Money docs where they're stored (`openssl rand -base64 32`). Without it the Money app can't sync. Use the same key locally and on Vercel, and keep a copy somewhere safe. |
| `MONEY_MY_NAMES`, `MONEY_FAMILY` | no | The family the Money app starts with, so real names stay out of the repo: your statement names comma-separated, and family members split by `;` with each one's names by `,` (see `.env.example`). Server-only; served to signed-in users by `/api/money/family`. |

If any of the three login variables is missing, nobody can sign in.

After 10 failed logins within an hour, login is locked for everyone (even with the right password) until the oldest failure is an hour old. Devices that are already signed in keep working. Attempts are recorded in Turso's `login_attempts` table, or `data/login-attempts.json` locally.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the test suite (Vitest + Testing Library) |
| `npm run coverage` | Tests plus a coverage report (terminal, and HTML in `coverage/`); fails below the thresholds |
| `npx vitest` | Run tests in watch mode |
| `npm run build` | Production build (also does a full typecheck) |
| `npm start` | Serve the production build |
| `npm run lint` | Run the Next.js linter |

---

## Features

| Page | What you can do |
|---|---|
| `/` | **Home**: one card per app (Reel Radar, Daily Planner, Money). Inside an app, the header shows a ⌂ Home button and a ▾ menu to switch to another app; it doesn't link to the other apps' pages directly. |
| `/reel-radar` | Reel Radar landing page with a live spotlight of trending Indian and global titles |
| `/discover` | Endless feed you can filter by region (All / Indian / Global). Each card has **Mark seen**, **+ Watchlist**, **Not interested**, and **Trailer & details** buttons. |
| `/recommendations` | Unlocks after **10 logged titles**. Results come in four groups: Indian Movies, Global Movies, Indian Series, Global Series. You can tune them by discovery style (balanced / popular / deep cuts) and mood (dark, adrenaline, feel-good, mind-bending), and each pick says why it was recommended. |
| `/similar` | Titles similar to one you choose, with an optional year range |
| `/analysis` | Taste analytics: total titles, hours watched, average rating, Indian vs global split, genres, decades, top directors and actors, blind spots, and your viewer "persona". Filter by movies/series and Indian/global. |
| `/watched` | Everything you've watched, with season-by-season progress for series |
| `/watchlist` | Your saved titles, with sorting and filters |
| `/search` | Search across movies, series, and people |
| `/person/[id]` | An actor's or director's filmography, with quick watch and watchlist buttons |
| `/todos` | **Daily Planner**: tasks with a title, an optional note, a checklist, a priority and a colour tag (Work, Home, Health…), on a drag-to-schedule timeline where you resize blocks by dragging their bottom edge. A **week view** shows seven days side by side; drag tasks between days to move them, or hold Ctrl/Alt while dropping to copy. Each task also has a ⇄ button to move or copy it to any date. A **focus timer** on any task counts down its planned time and records the time actually spent. Tasks can repeat every day or on chosen weekdays (with a 🔥 streak count), the planner can send browser reminders before each block while the page is open, and you can bring over unfinished tasks from yesterday. Type shorthand in the add box (`Gym 6pm 45m #health !high daily`) to set time, length, tag, priority and repeat in one go. Drag the ⋮⋮ handle (or use ↑/↓) to reorder tasks. A day log records wake and sleep times on a clock, your weight in kg, water against a 2.5 L goal, and a short review. Keyboard: N or / to add, ← → to change day, T for today, W for the week view. |
| `/todos/stats` | Planner stats: completion rate by weekday, planned vs. done hours, tasks by tag, focus time, the most postponed tasks, and database reads and writes per day for the whole app, over 7/30/90 days or all time. Pulls every month from the server first, so it covers all your devices. |
| `/money` | **Money**: a hero card with the month's spending (change vs last month, the monthly limit and about how much a day is left), a bar per day with the daily average, income, what you saved against your goal, and what you owe family; spending by category (share of the month, per-category limits); and a card per family member with what you owe them (what they've spent since you last paid them, as each payment covers what they'd spent up to then; everything they've spent if you never have), what they spent and you paid them that month, a **Paid ✓** button, and **Show transactions**: every payment to them, their spending and money between you, each marked You paid, Owed (after your last payment), Covered (before it) or Not counted. Transactions are grouped by day with the day's total, searchable (payee, note, category) and filterable by person; tap one to change its category, type (spent, refund, income, paid back, ignored), whose it is, its note, or delete it. The **+** button opens a sheet to add one (the category is guessed from the name; "Paid back" picks a family member). The **💵** button logs cash spending: type the amount, tap a category, and it's saved (marked "💵 Cash"; the hero shows how much of the month's spending was cash). **Sort your spending** shows imported spending nobody has confirmed a category for (still Other, or matching more than one category's keywords), one payee at a time with the likely categories first: a tap files all that payee's payments under it and learns it for later imports; **Keep as Other** also stops it being asked again; **Skip for now** hides it until the page reloads. On first use, after a sync shows no family yet, the family from `MONEY_FAMILY` is filled in and your own statement names from `MONEY_MY_NAMES` are set (nothing is added while they're unset). |
| `/money/import` | Import a **Google Pay or Paytm statement PDF**, yours or a family member's: drop or pick the file, and whose it is is picked from the email (or, for Paytm, the account holder's name) at its top (with a warning if the chosen owner appears in it as a payee). Rows already imported under someone else are moved to the right person. It's read in the browser (no upload, no PDF library), checked against the statement's printed total, and shown for review with totals by type: untick rows (or select all / none), show only rows that still need a category, fix a category or type, then import. Afterwards, **Sort your spending** asks about that import's rows that still need a category. Rows are keyed by UPI transaction id (Paytm's "UPI Ref No"), so importing the same statement twice, or the same payment from both sides, even one side from Paytm, keeps one copy. |
| `/money/settings` | Your name(s) as statements show them, family members and their names, monthly income, savings goal, and spending limits (overall and per category). **Backup & export**: download a JSON backup (transactions, people, limits, learned categories), download every transaction as a CSV for Excel or Google Sheets (with a Spending column: refunds negative, money that isn't spending 0), or restore a backup, which adds to what's here (same id: the backup's copy wins; settings merge by newest) and deletes nothing. **Delete all money data** (after a second click) empties every month and the settings on all devices; it syncs first, and refuses while offline. |
| `/login` | Single-user sign-in. Every other page and API route requires it. |

**Season tracking.** Series are tracked per season (S1, S2, …). The more seasons you finish, the more weight a series carries in your taste profile.

**Backup.** Export your history and watchlist to a `.json` file, or import one to restore or merge data. The planner has its own Export and Import: one file with every day and daily task. Importing adds to what's there and never deletes; an older single-day planner file still imports. Both apps also sync automatically across devices.

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
| `planner-log` | Per-day wake time, sleep time, weight (kg), water (ml) and review notes |
| `money-YYYY-MM` | One month of Money transactions |
| `money-settings` | Money people, limits/income/goal, learned payee categories, and the list of months with data |

- **Money docs are encrypted at rest.** The server seals them with AES-256-GCM (key from `MONEY_ENCRYPTION_KEY`) before writing to Turso or `data/`, and opens them when reading, so the database only ever holds `enc:v1:…` ciphertext. Each one is bound to its doc key. Without a valid key, money docs are neither written nor read, and nothing falls back to plain text. A plain doc saved before encryption was added is sealed the first time it's read. Your browser's own copy (`localStorage`) and exports are plain, as the UI needs them.

- **Writes are batched.** A change saves to `localStorage` at once and is pushed a few seconds later (5 s for the library, 3 s for the planner), or when the tab is hidden. History changes ride along with the next push.
- **Reads are cheap.** A page syncs on open, at most every 2 minutes, and again when the tab comes back into view after that. The client sends the etags it holds, so an unchanged doc comes back as `unchanged` with no body.
- **Merges are three-way.** Each device keeps the last copy it agreed on with the server, so a removal or a cleared history on one device carries to the others instead of coming back. Writes are conditional on the etag: if another device wrote first, the server answers 409 with its copy, and the client merges and retries. Planner items carry `updatedAt`, so when both devices edited the same todo, the later edit wins.
- Watch data lives in `localStorage` under `reel-radar-v1` as `{ watched, watchlist, displayed, shown, dismissed }`. Saved titles drop `keywords`, `trailerYoutubeId` and `why`, which are always fetched fresh.
- Each title is identified by `"<mediaType>:<tmdbId>"`, e.g. `movie:550` or `tv:1396`.
- The first sync migrates an old single-file `storage.json` into `library` and `history`. `scripts/upload-storage.ts` uploads `data/storage.json` by hand (see below).

### Keeping Vercel usage low

- TMDB-backed GET routes send `Cache-Control: private` (1 day for titles and people, 1 hour for lists), so the browser answers repeat requests itself. TMDB responses stay in Next's data cache for 6 hours (lists) or 7 days (details).
- The middleware skips static files, and every route sets `maxDuration`.
- `vercel.json` skips the build when a push only changes docs, tests or `data/`.
- Trailers are YouTube embeds and posters load straight from TMDB, so neither touches Vercel.

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
- **regionFactor**: if at least 20% of what you watch is Indian, Indian titles score 1.4 and global titles 0.85. Otherwise highly rated Indian titles get a smaller lift.
- **seenPenalty**: titles you've already been shown are multiplied by 0.45.

Watched, watchlisted, and dismissed titles are never recommended. The top-scoring candidates are then sorted into the four groups, with a step that keeps the genres varied. The ranking is deterministic, so the same inputs always give the same results. The implementation is in [`src/lib/recommend.ts`](src/lib/recommend.ts).

---

## Project structure

```
src/
├── middleware.ts                 # Auth gate: pages redirect to /login, APIs return 401
├── app/
│   ├── layout.tsx, globals.css   # Root layout + Tailwind base
│   ├── page.tsx                  # Home: app launcher (cards from lib/apps.ts)
│   ├── reel-radar/               # Reel Radar landing page
│   ├── discover/  recommendations/  similar/  analysis/
│   ├── watched/   watchlist/        search/   person/[id]/
│   ├── todos/                    # Daily planner (page, WeekView, shared planner.tsx), stats/
│   ├── money/                    # Money: overview page, import/, settings/, shared.tsx, ReviewQueue.tsx
│   ├── login/
│   └── api/
│       ├── discover/        GET   TMDB discover feed (region filters)
│       ├── recommendations/ POST  Score & categorise candidates for the posted history
│       ├── similar/         GET   ?type=&id=&minYear=&maxYear=&limit=
│       ├── search/          GET   ?query=
│       ├── title/           GET   Title details, credits, trailer
│       ├── person/[id]/     GET   Person credits
│       ├── sync/            GET ?keys=doc:etag,…  /  POST { key, data, baseEtag }
│       └── auth/login, auth/logout   POST
├── components/
│   ├── TitleCard.tsx             # Poster card with badges & quick actions
│   ├── TitleDetailsModal.tsx     # Trailer, synopsis, cast & crew
│   ├── StorageControls.tsx       # Export / import
│   ├── AppSwitcher.tsx           # Header brand: Home link + switch-app menu
│   └── LogoutButton.tsx
├── lib/
│   ├── apps.ts                   # App registry used by the home page and AppSwitcher
│   ├── tmdb.ts                   # TMDB client: normalisation, 8s timeout + one retry, 6h/7d cache
│   ├── recommend.ts              # Taste profile, scoring, categorisation, "why" text
│   ├── analysis.ts               # Analytics aggregation
│   ├── region.ts                 # Indian vs Global rule (single source of truth)
│   ├── storage.ts                # Reel Radar state: load/save, merge, sync hook, export/import
│   ├── todos.ts                  # Planner model: daily tasks, carry-over, tags, focus timer, sync, backup
│   ├── sync.ts                   # Client sync engine: etags, batching, three-way merge, refocus
│   ├── syncDocs.ts               # Doc shapes and merges shared by client, server and script
│   ├── docStore.ts               # Server: docs as Turso rows, or data/ locally
│   ├── http.ts                   # cachedJson(): browser-cacheable API responses
│   ├── money.ts                  # Money model: transactions, people, limits, categories, import plan, sync
│   ├── gpayStatement.ts          # Reads a statement PDF (inflate, ToUnicode, hex/literal strings), Google Pay rows
│   ├── paytmStatement.ts         # Paytm statement rows
│   ├── plannerStats.ts           # Planner stats aggregation
│   ├── usageStats.ts             # Database reads/writes totalled per local day
│   ├── auth.ts                   # HMAC session cookie (Web Crypto, edge-safe)
│   └── *.test.ts                 # Vitest unit tests
├── test/                         # Shared test fixtures and setup
└── types/title.ts                # Title, MediaType, keyOf()
data/                             # storage.json backup (tracked); local fallback docs (<doc>.json, gitignored)
scripts/upload-storage.ts         # Upload data/storage.json to Turso as the library/history docs
scripts/migrate-blob-to-turso.ts  # One-off: copy the old Vercel Blob docs into Turso
```

Imports use the `@/` alias for `src/`. Tailwind theme tokens: `ink` `#07070c` (background), `panel` `#11111a`, and `gold` `#f6c453` (accent).

---

## Testing

`npm test` runs about 340 tests, entirely offline, and covers about 99% of the code (`npm run coverage`; it fails below 97% of lines, 95% of functions or 90% of branches). TMDB and `fetch` are mocked, sync runs against an in-memory libSQL database, and the storage tests write to a temporary directory, never to `data/`.

| Area | What's covered |
|---|---|
| `lib/recommend`, `lib/analysis`, `lib/region` | Scoring, filters, categories, explanations, every analytics metric, personas |
| `lib/tmdb` | Normalisation, request retry and errors, discover/search/credits/detail, similar-title scoring |
| `lib/sync`, `lib/syncDocs` | Three-way merge, batching, refocus sync, conflict retry, mid-push edits |
| `lib/storage`, `lib/todos`, `lib/plannerStats` | Merge, sync, import/export, daily tasks, repeat days, streaks, subtasks, tags, moving between days, focus timer, reminders, carry-over, skip/undo, planner stats |
| `lib/auth`, `middleware` | Session signing and expiry, redirects, 401s |
| API routes | Validation, responses, cache headers, conditional reads and writes, migration, private → public |
| Components, `/login` | Title card, details modal, backup controls, logout, sign-in flow and safe redirects |
| Every page | Rendered and driven through the UI against the real `lib/` code: discover feed and batches, season tracking, recommendations filters, analysis sections and graph, watched/watchlist sorting and filters, search, similar, person; the planner's add/edit/delete/undo, checklist, repeats, scheduling, drag and drop, resize, quick add, carry-over, move/copy, focus timer, reminders, backup, sync, week view and stats |

---

## Deploying to Vercel

1. Import the repo into Vercel.
2. Add `TMDB_API_KEY`, `APP_USERNAME`, `APP_PASSWORD`, and `AUTH_SECRET` as environment variables.
3. Create a Turso database (`turso db create reel-radar`, `turso db show reel-radar --url`, `turso db tokens create reel-radar`) and add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
4. Add `MONEY_ENCRYPTION_KEY` (`openssl rand -base64 32`), the same value as in `.env.local`.
5. Deploy.

Without a Turso database, sync on Vercel won't persist, because its filesystem is read-only and temporary.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SyntaxError: Unexpected token '?'` when running `npx tsc` or `npm test` | Your Node is too old. Use Node 18.17+ (e.g. `nvm use 20`). |
| Every page redirects to `/login` | Set `APP_USERNAME`, `APP_PASSWORD`, and `AUTH_SECRET` in `.env.local`, then restart the dev server. |
| Login says "Too many failed logins" | Wait the minutes it shows, or use a device that's still signed in. To unlock right away, clear the `login_attempts` table in Turso (or delete `data/login-attempts.json` locally). |
| `TMDB_API_KEY is not configured` / empty feeds | Add the key to `.env.local` and restart. |
| TMDB requests time out (common on WSL) | Requests already retry once. Check your network or DNS. |

### Reset the "already shown" lists

Use **Clear Displayed & Shown** on the Discover page. It clears `shown` and `displayed` on every device.

### Move old Blob data to Turso

One time, with `BLOB_READ_WRITE_TOKEN`, `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env.local`. The script only reads Blob and skips docs Turso already has:

```bash
npx vite-node --config vitest.config.ts scripts/migrate-blob-to-turso.ts            # list what would be copied
npx vite-node --config vitest.config.ts scripts/migrate-blob-to-turso.ts -- --apply # copy it
```

### Upload a backup to Turso

`data/storage.json` (a Reel Radar export) can be uploaded as the synced docs. The script merges it with what the store already holds, so nothing is lost:

```bash
npx vite-node --config vitest.config.ts scripts/upload-storage.ts -- --dry-run   # show what would be written
npx vite-node --config vitest.config.ts scripts/upload-storage.ts                # write it
# add --purge-old-planner to also delete the old per-day planner blobs under todos/ in Blob
```

---

*This product uses the TMDB API but is not endorsed or certified by TMDB.*
