# AGENTS.md

Guidance for AI coding agents working in this repo. Read this before making changes.

## What this is

Reel Radar: a single-user Next.js 14 (App Router) app for movie/TV discovery, watch tracking, recommendations, taste analytics, and a daily todo planner. Data comes from the TMDB v3 API. State lives in the browser (`localStorage`) and syncs to Vercel Blob, or to `data/*.json` locally when Blob isn't configured.

Stack: Next.js 14.2, React 18, TypeScript (strict), Tailwind 3, Vitest 2, `@vercel/blob`.

## Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest run
npm run coverage # tests + coverage report (fails below the thresholds in vitest.config.ts)
npm run build    # production build; also the full typecheck
npm run lint
npx tsc --noEmit # quick typecheck
```

Before calling a change done, run `npm run coverage` and `npx tsc --noEmit` (or `npm run build`).

Node 18.17+ is required. On this machine the system `node` is v12, which fails with `SyntaxError: Unexpected token '?'`. Use nvm's Node 20 (`nvm use 20`, or put `~/.nvm/versions/node/v20.16.0/bin` first on PATH).

## Environment

Copy `.env.example` to `.env.local`. Never commit `.env.local` or print its values.

| Var | Required | Purpose |
|---|---|---|
| `TMDB_API_KEY` | yes | Every TMDB call goes through the server; it's never exposed to the client |
| `APP_USERNAME`, `APP_PASSWORD` | yes | Single-user login credentials |
| `AUTH_SECRET` | yes | HMAC key for the session cookie |
| `BLOB_READ_WRITE_TOKEN` | no | Turns on Vercel Blob; without it, storage falls back to `data/` |

## Layout

```
src/
  middleware.ts          Auth gate for every route except /login and /api/auth/*
  app/                   Pages: / (app launcher), reel-radar (Reel Radar landing), discover,
                         recommendations, analysis, watched, watchlist, search, similar,
                         person/[id], todos, todos/stats, login
  app/api/               Route handlers: discover, recommendations, similar, search, title,
                         person/[id], sync, auth/login, auth/logout
  components/            TitleCard, TitleDetailsModal, StorageControls, LogoutButton, AppSwitcher
  lib/
    apps.ts              App registry (home page cards + AppSwitcher menu)
    tmdb.ts              TMDB client and normalization (server only)
    recommend.ts         Scoring and ranking; tested in recommend.test.ts
    region.ts            Indian vs Global rule (isIndianTitle, isSouthIndianTitle)
    analysis.ts          Analytics aggregation
    storage.ts           Reel Radar state: load/save, merge, export/import, useStorageSync()
    todos.ts             Todo and daily-task model and logic, planner sync and backup ("use client")
    sync.ts              Client sync engine (etags, batched pushes, three-way merge, refocus)
    syncDocs.ts          Doc shapes, merge3(), toStored(); shared by client, server and script
    blobStore.ts         Server-only doc storage: gzipped Blob get/put, or data/ locally
    http.ts              cachedJson() for browser-cacheable API responses
    plannerStats.ts      Planner stats aggregation (pure; used by /todos/stats)
    auth.ts              Session signing/verification via Web Crypto
  types/title.ts         Title / MediaType types and keyOf()
data/                    storage.json (tracked backup of the watch history) + local fallback docs (<doc>.json, gitignored)
scripts/upload-storage.ts  Upload data/storage.json to Blob (run with vite-node; see README)
```

Import through the `@/` alias (maps to `src/`).

## Conventions and invariants

- **Title identity**: a title is identified by `keyOf(t)` → `"movie:123"` / `"tv:123"`. A TMDB id alone isn't unique across media types.
- **State shape** (`State` in `lib/storage.ts`): `watched`, `watchlist` (full `Title` objects), and `displayed`, `shown`, `dismissed` (key strings). If you add a field, update all of these together in `lib/syncDocs.ts`: `empty()`, `libraryOf()`/`historyOf()` and `mergeLibrary()`/`mergeHistory()`, plus import/export.
- **localStorage key** `reel-radar-v1` holds user data. Don't rename it or change the shape in ways that break existing saved data. Make migrations additive.
- **Merging** (`mergeStates`) unions watched seasons. Keep it idempotent, because import and sync both depend on it.
- **Sync** (`api/sync`, `lib/blobStore.ts`, `lib/sync.ts`): data is split into docs (`library`, `history`, `planner-YYYY-MM`, `planner-daily`; the allowlist is `DOC_KEY`). Keep these properties:
  - Reads use Blob `get()` with the client's etag, never `list()`. A failed read must surface as an error, never as "missing", or the client pushes over the doc.
  - Writes are conditional (`ifMatch`). A 409 carries the server copy; the client merges and retries.
  - Pushes are batched through `markDirty()`; don't `fetch` the sync route from features directly. A sync must not write back what it just read.
  - Merges are three-way against the stored base (`merge3`), so deletes carry across devices. Planner items carry `updatedAt`; daily copies use the fixed id `<dailyId>:<date>`.
  - Both private and public stores work, and without a token everything falls back to `data/<doc>.json`.
- **Vercel usage**: TMDB GET routes answer through `cachedJson()` and every route sets `maxDuration`. Keep new routes the same.
- **Todos** are stored one doc per month (`planner-YYYY-MM`), plus `planner-daily` for repeating tasks. `loadTodos`/`saveTodos` keep the per-day API on top of that.
- **Auth**: `lib/auth.ts` must stay Web Crypto–only (no Node `crypto`) because middleware runs on the edge. New API routes are protected automatically by the middleware matcher. Unauthenticated `/api/*` requests get a 401 JSON response, and unauthenticated pages redirect to `/login?next=...`.
- **Recommendations**: ranking in `lib/recommend.ts` must stay deterministic and must exclude watched, watchlisted, and dismissed titles. If you change scoring weights, update the formula in the README and add or adjust a test.
- **Indian vs Global**: defined once in `lib/region.ts` (origin country `IN` or an Indian original language). Always call `isIndianTitle` / `isSouthIndianTitle`. Never write language lists inline. (`originCountry: "IN"` passed to `discover()` is a TMDB query filter, which is a separate thing.)
- **TMDB**: call it only from server code via `lib/tmdb.ts` (it has the timeout, retry, and data-cache TTLs: 6 h for lists, 7 days for details). Posters load from `image.tmdb.org`, the only allowed remote image host in `next.config.mjs`.
- **Apps**: the project hosts several apps (Reel Radar: discover…person; Daily Planner: todos). `/` is the launcher. Every app page's header starts with `<AppSwitcher current="<id>" />` (Home link + switch-app menu). Don't link directly to another app's pages from an app's nav. To add an app, register it in `lib/apps.ts`.
- **Styling**: Tailwind with the theme tokens `ink` (#07070c, background), `panel` (#11111a), and `gold` (#f6c453, accent). Use those tokens rather than raw hex values. The UI must work on phone widths.
- **Code style**: TypeScript strict, functional React components, `"use client"` only where needed. Match the formatting of the file you're editing.

## Testing

- Tests live next to their source as `*.test.ts(x)`. Everything is covered: `lib/`, `types/`, `middleware.ts`, all API routes, the shared components, and **every page** (each `app/**/page.tsx`, `todos/WeekView.tsx` and `todos/planner.tsx` has a render test; the home, layout, search, person and watchlist pages share `app/simple-pages.test.tsx`).
- **Pages need render tests.** A new page, or a new button, filter, form or state on one, gets a test that renders the page and drives it through the UI (click, type, drop) and checks both what's shown and what's saved. Logic in `lib/` still gets its own unit tests.
- Coverage is enforced: `npm run coverage` fails below 97% lines/statements, 95% functions and 90% branches (`vitest.config.ts`). Don't lower the thresholds to get a change through; add the missing tests.
- Page tests run against the real `lib/` code and `localStorage`; only `fetch` is faked. Use `src/test/pages.ts`: `routeFetch({ "/api/x": body | (url, init) => body })` answers by path (`/api/sync` defaults to an empty server), `requests(fetch, path)` lists calls, `seed()`/`stored()` read and write Reel Radar state, and `stubLocation()` replaces `window.location`. Mock `next/navigation` (`usePathname`, `useSearchParams`, `useParams`) in each page test.
- jsdom gaps: there's no `DragEvent`/`PointerEvent`, so set `clientY` and modifier keys on the event yourself (see `drag()` in `todos/page.test.tsx`), and dispatch pointer moves as `MouseEvent`s. `Element.scrollTo` and `Notification` need stubs.
- Tests run in Node by default. Anything that touches the DOM or `localStorage` starts with `// @vitest-environment jsdom`.
- Shared helpers: `src/test/fixtures.ts` (`mk()` builds a `Title`, `jsonResponse()` builds a fetch response), `src/test/pages.ts` (above), and `src/test/setup.ts` (React cleanup, lets pending sync work settle, then resets `localStorage`).
- Never hit the network: stub `fetch` with `vi.stubGlobal`, and mock `@/lib/tmdb` or `@vercel/blob` with `vi.mock`.
- Sync route tests must point `process.cwd()` at a temp dir and re-import the route (see `src/app/api/sync-route.test.ts`), so the real `data/` files are never touched.
- Don't return a value from `beforeEach(() => ...)`. Vitest calls a returned function as cleanup, so `beforeEach(() => mock.mockResolvedValue(x))` ends up calling the mock after every test. Use a braced body.
- When adding a feature, add tests for it in the same change.
- Pages sit behind login. To check UI in a browser, set `APP_USERNAME`/`APP_PASSWORD`/`AUTH_SECRET` in `.env.local` and sign in at `/login`. If you couldn't view a page, say so; don't claim it was visually checked.

## Don'ts

- Don't commit secrets, `.env.local`, or `.next/`.
- `data/storage.json` is intentionally tracked in git (it holds the owner's viewing history). Don't delete it, reset it, or overwrite it with test data. The other `data/*.json` files are local dev docs and stay gitignored.
- Don't run the dev server or scripts against the live Blob store to test changes. Start with `BLOB_READ_WRITE_TOKEN=` (empty) so they use `data/`.
- Don't add dependencies without a clear need. The dependency list is deliberately small.
- Don't send TMDB requests or the API key from client components.

## Docs

`README.md` covers setup, features, the data flow, the scoring formula, the project structure, and troubleshooting. Keep it in sync whenever you add a page or API route, change scoring weights, or change the storage shape.
