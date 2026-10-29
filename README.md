# Reel Radar 🎬

A personal movie & TV tracker for one user. Log what you've watched (down to the season), keep a watchlist, get recommendations and analytics based on your own taste, and plan your day. It covers both Indian and global cinema.

Built with **Next.js 14 (App Router)**, **TypeScript**, and **Tailwind CSS**, with live metadata from **TMDB**. Your data is kept in the browser and synced to **Vercel Blob** (or to local JSON files during development).

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
| `BLOB_READ_WRITE_TOKEN` | optional | Enables cloud sync via Vercel Blob. Without it, data is saved under `data/`. |

If any of the three login variables is missing, nobody can sign in.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Run the test suite (Vitest + Testing Library) |
| `npx vitest` | Run tests in watch mode |
| `npm run build` | Production build (also does a full typecheck) |
| `npm start` | Serve the production build |
| `npm run lint` | Run the Next.js linter |

---

## Features

| Page | What you can do |
|---|---|
| `/` | Landing page with a live spotlight of trending Indian and global titles |
| `/discover` | Endless feed you can filter by region (All / Indian / Global). Each card has **Mark seen**, **+ Watchlist**, **Not interested**, and **Trailer & details** buttons. |
| `/recommendations` | Unlocks after **10 logged titles**. Results come in four groups: Indian Movies, Global Movies, Indian Series, Global Series. You can tune them by discovery style (balanced / popular / deep cuts) and mood (dark, adrenaline, feel-good, mind-bending), and each pick says why it was recommended. |
| `/similar` | Titles similar to one you choose, with an optional year range |
| `/analysis` | Taste analytics: total titles, hours watched, average rating, Indian vs global split, genres, decades, top directors and actors, blind spots, and your viewer "persona". Filter by movies/series and Indian/global. |
| `/watched` | Everything you've watched, with season-by-season progress for series |
| `/watchlist` | Your saved titles, with sorting and filters |
| `/search` | Search across movies, series, and people |
| `/person/[id]` | An actor's or director's filmography, with quick watch and watchlist buttons |
| `/todos` | **Daily Planner**: tasks with a title, an optional note, a checklist, a priority and a colour tag (Work, Home, Health…), on a drag-to-schedule timeline where you resize blocks by dragging their bottom edge. A **week view** shows seven days side by side; drag tasks between days to move them, or hold Ctrl/Alt while dropping to copy. Each task also has a ⇄ button to move or copy it to any date. A **focus timer** on any task counts down its planned time and records the time actually spent. Tasks can repeat every day or on chosen weekdays (with a 🔥 streak count), the planner can send browser reminders before each block while the page is open, and you can bring over unfinished tasks from yesterday. |
| `/todos/stats` | Planner stats: completion rate by weekday, planned vs. done hours, tasks by tag, focus time, and the most postponed tasks, over 7/30/90 days or all time. Uses the days saved in this browser. |
| `/login` | Single-user sign-in. Every other page and API route requires it. |

**Season tracking.** Series are tracked per season (S1, S2, …). The more seasons you finish, the more weight a series carries in your taste profile.

**Backup.** Export your history and watchlist to a `.json` file, or import one to restore or merge data across devices.

---

## How it works

### Data & sync

```
Browser localStorage  ──sync──▶  /api/storage, /api/todos  ──▶  Vercel Blob   (if BLOB_READ_WRITE_TOKEN is set)
   (instant, offline)                                       └─▶  data/*.json   (local fallback)
```

- Watch data lives in `localStorage` under `reel-radar-v1`. Its shape is `{ watched, watchlist, displayed, shown, dismissed }`.
- Todos are stored one file per day (`reel-radar-todos-YYYY-MM-DD.json`), plus a `daily` file for repeating tasks.
- Each title is identified by `"<mediaType>:<tmdbId>"`, e.g. `movie:550` or `tv:1396`.
- Blob storage works with both private and public stores. If a private write fails because the store is public, it retries as public.

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
│   ├── page.tsx                  # Landing page
│   ├── discover/  recommendations/  similar/  analysis/
│   ├── watched/   watchlist/        search/   person/[id]/
│   ├── todos/                    # Daily planner (page, WeekView, shared planner.tsx), stats/
│   ├── login/
│   └── api/
│       ├── discover/        GET   TMDB discover feed (region filters)
│       ├── recommendations/ POST  Score & categorise candidates for the posted history
│       ├── similar/         GET   ?type=&id=&minYear=&maxYear=&limit=
│       ├── search/          GET   ?query=
│       ├── title/           GET   Title details, credits, trailer
│       ├── person/[id]/     GET   Person credits
│       ├── storage/         GET/POST  Watch-data sync (Blob or data/storage.json)
│       ├── todos/           GET/POST  ?date=YYYY-MM-DD|daily
│       └── auth/login, auth/logout   POST
├── components/
│   ├── TitleCard.tsx             # Poster card with badges & quick actions
│   ├── TitleDetailsModal.tsx     # Trailer, synopsis, cast & crew
│   ├── StorageControls.tsx       # Export / import
│   └── LogoutButton.tsx
├── lib/
│   ├── tmdb.ts                   # TMDB client: normalisation, 8s timeout + one retry, 1h cache
│   ├── recommend.ts              # Taste profile, scoring, categorisation, "why" text
│   ├── analysis.ts               # Analytics aggregation
│   ├── region.ts                 # Indian vs Global rule (single source of truth)
│   ├── storage.ts                # Client state: load/save, merge, sync, export/import
│   ├── todos.ts                  # Planner model: daily tasks, carry-over, tags, focus timer, sync
│   ├── plannerStats.ts           # Planner stats aggregation
│   ├── auth.ts                   # HMAC session cookie (Web Crypto, edge-safe)
│   └── *.test.ts                 # Vitest unit tests
├── test/                         # Shared test fixtures and setup
└── types/title.ts                # Title, MediaType, keyOf()
data/                             # Local storage fallback (storage.json, todo files)
```

Imports use the `@/` alias for `src/`. Tailwind theme tokens: `ink` `#07070c` (background), `panel` `#11111a`, and `gold` `#f6c453` (accent).

---

## Testing

`npm test` runs about 175 tests, entirely offline. TMDB, Vercel Blob, and `fetch` are mocked, and the storage tests write to a temporary directory, never to `data/`.

| Area | What's covered |
|---|---|
| `lib/recommend`, `lib/analysis`, `lib/region` | Scoring, filters, categories, explanations, every analytics metric, personas |
| `lib/tmdb` | Normalisation, request retry and errors, discover/search/credits/detail, similar-title scoring |
| `lib/storage`, `lib/todos`, `lib/plannerStats` | Merge, sync, import/export, daily tasks, repeat days, streaks, subtasks, tags, moving between days, focus timer, reminders, carry-over, skip/undo, planner stats |
| `lib/auth`, `middleware` | Session signing and expiry, redirects, 401s |
| API routes | Validation, responses, Blob ↔ local-file fallback, private → public retry |
| Components, `/login` | Title card, details modal, backup controls, logout, sign-in flow and safe redirects |

The large pages don't have render tests; their logic lives in `lib/` and is tested there.

---

## Deploying to Vercel

1. Import the repo into Vercel.
2. Add `TMDB_API_KEY`, `APP_USERNAME`, `APP_PASSWORD`, and `AUTH_SECRET` as environment variables.
3. Create a Blob store and connect it to the project. Vercel adds `BLOB_READ_WRITE_TOKEN` for you.
4. Deploy.

Without a Blob store, sync on Vercel won't persist, because its filesystem is read-only and temporary.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SyntaxError: Unexpected token '?'` when running `npx tsc` or `npm test` | Your Node is too old. Use Node 18.17+ (e.g. `nvm use 20`). |
| Every page redirects to `/login` | Set `APP_USERNAME`, `APP_PASSWORD`, and `AUTH_SECRET` in `.env.local`, then restart the dev server. |
| `TMDB_API_KEY is not configured` / empty feeds | Add the key to `.env.local` and restart. |
| TMDB requests time out (common on WSL) | Requests already retry once. Check your network or DNS. |

### Reset the "already shown" lists

Paste this into the browser console while signed in. It clears `shown` and `displayed` locally and on the server, so the discovery feed starts fresh:

```javascript
(() => {
  const key = "reel-radar-v1";
  const state = JSON.parse(localStorage.getItem(key) || "{}");
  state.shown = [];
  state.displayed = [];
  localStorage.setItem(key, JSON.stringify(state));
  fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  }).then(() => location.reload());
})();
```

---

*This product uses the TMDB API but is not endorsed or certified by TMDB.*
