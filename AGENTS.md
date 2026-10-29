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
npm run build    # production build; also the full typecheck
npm run lint
npx tsc --noEmit # quick typecheck
```

Before calling a change done, run `npm test` and `npx tsc --noEmit` (or `npm run build`).

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
  app/                   Pages (discover, recommendations, analysis, watched, watchlist,
                         search, similar, person/[id], todos, login)
  app/api/               Route handlers: discover, recommendations, similar, search, title,
                         person/[id], storage, todos, auth/login, auth/logout
  components/            TitleCard, TitleDetailsModal, StorageControls, LogoutButton
  lib/
    tmdb.ts              TMDB client and normalization (server only)
    recommend.ts         Scoring and ranking; tested in recommend.test.ts
    region.ts            Indian vs Global rule (isIndianTitle, isSouthIndianTitle)
    analysis.ts          Analytics aggregation
    storage.ts           Client state: load/save, merge, export/import, server sync
    todos.ts             Todo and daily-task model and logic ("use client")
    auth.ts              Session signing/verification via Web Crypto
  types/title.ts         Title / MediaType types and keyOf()
data/                    Local storage fallback (storage.json, reel-radar-todos-<date>.json)
```

Import through the `@/` alias (maps to `src/`).

## Conventions and invariants

- **Title identity**: a title is identified by `keyOf(t)` → `"movie:123"` / `"tv:123"`. A TMDB id alone isn't unique across media types.
- **State shape** (`State` in `lib/storage.ts`): `watched`, `watchlist` (full `Title` objects), and `displayed`, `shown`, `dismissed` (key strings). If you add a field, update all of these together: `empty()`, `mergeStates()`, the server default in `app/api/storage/route.ts`, and import/export.
- **localStorage key** `reel-radar-v1` holds user data. Don't rename it or change the shape in ways that break existing saved data. Make migrations additive.
- **Merging** (`mergeStates`) unions watched seasons. Keep it idempotent, because import and sync both depend on it.
- **Storage routes** (`api/storage`, `api/todos`) support both a private and a public Blob store (they retry with public on the "private access on a public store" error) and fall back to local files. Keep both paths working.
- **Todos** are stored one file/blob per day (`YYYY-MM-DD`), plus a `daily` key for repeating tasks. Date keys are checked against `DATE_KEY`, so keep that check in place.
- **Auth**: `lib/auth.ts` must stay Web Crypto–only (no Node `crypto`) because middleware runs on the edge. New API routes are protected automatically by the middleware matcher. Unauthenticated `/api/*` requests get a 401 JSON response, and unauthenticated pages redirect to `/login?next=...`.
- **Recommendations**: ranking in `lib/recommend.ts` must stay deterministic and must exclude watched, watchlisted, and dismissed titles. If you change scoring weights, update the formula in the README and add or adjust a test.
- **Indian vs Global**: defined once in `lib/region.ts` (origin country `IN` or an Indian original language). Always call `isIndianTitle` / `isSouthIndianTitle`. Never write language lists inline. (`originCountry: "IN"` passed to `discover()` is a TMDB query filter, which is a separate thing.)
- **TMDB**: call it only from server code via `lib/tmdb.ts` (it has the timeout, retry, and `revalidate: 3600` caching). Posters load from `image.tmdb.org`, the only allowed remote image host in `next.config.mjs`.
- **Styling**: Tailwind with the theme tokens `ink` (#07070c, background), `panel` (#11111a), and `gold` (#f6c453, accent). Use those tokens rather than raw hex values. The UI must work on phone widths.
- **Code style**: TypeScript strict, functional React components, `"use client"` only where needed. Match the formatting of the file you're editing.

## Testing

- Tests live next to their source as `*.test.ts(x)`. Covered: everything in `lib/`, `types/`, `middleware.ts`, all API routes, the shared components, and the login page. The large pages (discover, recommendations, analysis, watched, watchlist, search, similar, person, todos, home) have no render tests. Their logic lives in `lib/` and is tested there.
- Tests run in Node by default. Anything that touches the DOM or `localStorage` starts with `// @vitest-environment jsdom`.
- Shared helpers: `src/test/fixtures.ts` (`mk()` builds a `Title`, `jsonResponse()` builds a fetch response) and `src/test/setup.ts` (React cleanup, `localStorage` reset).
- Never hit the network: stub `fetch` with `vi.stubGlobal`, and mock `@/lib/tmdb` or `@vercel/blob` with `vi.mock`.
- Storage route tests must point `process.cwd()` at a temp dir and re-import the route (see `src/app/api/storage-routes.test.ts`), so the real `data/` files are never touched.
- Don't return a value from `beforeEach(() => ...)`. Vitest calls a returned function as cleanup, so `beforeEach(() => mock.mockResolvedValue(x))` ends up calling the mock after every test. Use a braced body.
- When adding a feature, add tests for it in the same change.
- Pages sit behind login. To check UI in a browser, set `APP_USERNAME`/`APP_PASSWORD`/`AUTH_SECRET` in `.env.local` and sign in at `/login`. If you couldn't view a page, say so; don't claim it was visually checked.

## Don'ts

- Don't commit secrets, `.env.local`, or `.next/`.
- `data/storage.json` is intentionally tracked in git (it holds the owner's viewing history). Don't delete it, reset it, or overwrite it with test data.
- Don't add dependencies without a clear need. The dependency list is deliberately small.
- Don't send TMDB requests or the API key from client components.

## Docs

`README.md` covers setup, features, the data flow, the scoring formula, the project structure, and troubleshooting. Keep it in sync whenever you add a page or API route, change scoring weights, or change the storage shape.
