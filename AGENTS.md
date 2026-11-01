# AGENTS.md

Guidance for AI coding agents working in this repo. Read this before making changes.

## What this is

Reel Radar: a single-user Next.js 16 (App Router) app for movie/TV discovery, watch tracking, recommendations, taste analytics, a daily todo planner, and a money tracker. Data comes from the TMDB v3 API. State lives in the browser (`localStorage`) and syncs to Turso (libSQL), or to `data/*.json` locally when Turso isn't configured.

Stack: Next.js 16, React 19, TypeScript (strict), Tailwind 3, Vitest 2, `@libsql/client`.

## Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest run
npm run coverage # tests + coverage report (fails below the thresholds in vitest.config.mts)
npm run build    # production build; also the full typecheck
npx tsc --noEmit # quick typecheck
```

Before calling a change done, run `npm run coverage` and `npx tsc --noEmit` (or `npm run build`).

Node 20.9+ is required. On this machine the system `node` is v12, which fails with `SyntaxError: Unexpected token '?'`. Use nvm's Node 20 (`nvm use 20`, or put `~/.nvm/versions/node/v20.16.0/bin` first on PATH).

## Environment

Copy `.env.example` to `.env.local`. Never commit `.env.local` or print its values.

| Var | Required | Purpose |
|---|---|---|
| `TMDB_API_KEY` | yes | Every TMDB call goes through the server; it's never exposed to the client |
| `APP_USERNAME`, `APP_PASSWORD` | yes | Single-user login credentials |
| `AUTH_SECRET` | yes | HMAC key for the session cookie |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | no | Turns on Turso storage; without the URL, storage falls back to `data/` |
| `MONEY_ENCRYPTION_KEY` | for Money | 32 bytes, base64. `docStore` encrypts `money-*` docs with it; money reads and writes fail without it |
| `MONEY_MY_NAMES`, `MONEY_FAMILY` | no | Starter family for Money (`lib/moneyFamily.ts`), served by `api/money/family` and added once by `seedFamily()`. Keeps real names out of the public repo; never make them `NEXT_PUBLIC_` (static bundles aren't behind the login) |

## Layout

```
src/
  proxy.ts               Auth gate for every route except /login and /api/auth/*
  app/                   Pages: / (app launcher), reel-radar (Reel Radar landing), discover,
                         recommendations, analysis, watched, watchlist, search, similar,
                         person/[id], todos, todos/stats, money, money/import, money/settings, login
                         (api/money/family: starter family from the env)
  app/api/               Route handlers: discover, recommendations, similar, search, title,
                         person/[id], sync, usage, auth/login, auth/logout
  components/            TitleCard, TitleDetailsModal, StorageControls, LogoutButton, AppSwitcher
  lib/
    apps.ts              App registry (home page cards + AppSwitcher menu)
    tmdb.ts              TMDB client and normalization (server only)
    recommend.ts         Scoring and ranking; tested in recommend.test.ts
    region.ts            Indian vs Global rule (isIndianTitle, isSouthIndianTitle)
    analysis.ts          Analytics aggregation
    storage.ts           Reel Radar state: load/save, merge, export/import, useStorageSync()
    todos.ts             Todo and daily-task model and logic, planner sync and backup ("use client")
    money.ts             Money model: transactions, people, limits, categories, import plan, sync ("use client")
    gpayStatement.ts     Statement PDF reader (no PDF library), Google Pay rows, parseStatementPdf(); tested with src/test/gpayPdf.ts
    paytmStatement.ts    Paytm statement rows (year from the period, sign gives direction); same reader and test helper
    sync.ts              Client sync engine (etags, batched pushes, three-way merge, refocus)
    syncDocs.ts          Doc shapes, merge3(), toStored(); shared by client, server and script
    docStore.ts          Server-only doc storage: one Turso row per doc, or data/ locally
    http.ts              cachedJson() for browser-cacheable API responses
    plannerStats.ts      Planner stats aggregation (pure; used by /todos/stats)
    usageStats.ts        Database reads/writes per local day (pure; used by /todos/stats)
    auth.ts              Session signing/verification via Web Crypto
  types/title.ts         Title / MediaType types and keyOf()
data/                    storage.json (tracked backup of the watch history) + local fallback docs (<doc>.json, gitignored)
scripts/upload-storage.ts  Upload data/storage.json to the doc store (run with tsx; see README)
scripts/migrate-blob-to-turso.ts  One-off copy of the old Vercel Blob docs into Turso
```

Import through the `@/` alias (maps to `src/`).

## Conventions and invariants

- **Title identity**: a title is identified by `keyOf(t)` → `"movie:123"` / `"tv:123"`. A TMDB id alone isn't unique across media types.
- **State shape** (`State` in `lib/storage.ts`): `watched`, `watchlist` (full `Title` objects), and `displayed`, `shown`, `dismissed` (key strings). If you add a field, update all of these together in `lib/syncDocs.ts`: `empty()`, `libraryOf()`/`historyOf()` and `mergeLibrary()`/`mergeHistory()`, plus import/export.
- **localStorage key** `reel-radar-v1` holds user data. Don't rename it or change the shape in ways that break existing saved data. Make migrations additive.
- **Merging** (`mergeStates`) unions watched seasons. Keep it idempotent, because import and sync both depend on it.
- **Sync** (`api/sync`, `lib/docStore.ts`, `lib/sync.ts`): data is split into docs (`library`, `history`, `planner-YYYY-MM`, `planner-daily`, `planner-log`, `money-YYYY-MM`, `money-settings`; the allowlist is `DOC_KEY`). Keep these properties:
  - Reads send the client's etag, and an unchanged doc comes back without its body. A failed read must surface as an error, never as "missing", or the client pushes over the doc.
  - Writes are conditional (`UPDATE ... WHERE etag = ?`). A 409 carries the server copy; the client merges and retries.
  - Pushes are batched through `markDirty()`; don't `fetch` the sync route from features directly. A sync must not write back what it just read.
  - Merges are three-way against the stored base (`merge3`), so deletes carry across devices. Planner items carry `updatedAt`; daily copies use the fixed id `<dailyId>:<date>`.
  - Without `TURSO_DATABASE_URL` everything falls back to `data/<doc>.json`.
  - `money-*` docs are encrypted at rest in `docStore` (`seal`/`unseal`: AES-256-GCM, `enc:v1:<iv>:<ciphertext+tag>`, the doc key as AAD), in Turso and `data/` alike. Etags hash the stored (encrypted) text. Never add a path that stores them unsealed or falls back to plain text when the key is missing. Plain legacy docs are sealed on read (the read query returns their body even for a matching etag). Tests set the key with `vi.stubEnv("MONEY_ENCRYPTION_KEY", ...)`.
  - `readDoc`/`writeDoc` count every call per half hour (`flushUsage()` saves the counts to the `usage` table, or `data/usage.json`; `/api/usage` serves them to the stats page). Any new code path that queries the `docs` table must go through them so it is counted.
- **Vercel usage**: TMDB GET routes answer through `cachedJson()` and every route sets `maxDuration`. Keep new routes the same.
- **Todos** are stored one doc per month (`planner-YYYY-MM`), plus `planner-daily` for repeating tasks. `loadTodos`/`saveTodos` keep the per-day API on top of that.
- **Auth**: `lib/auth.ts` must stay Web Crypto–only (no Node `crypto`) so it stays portable between the proxy and route handlers. New API routes are protected automatically by the proxy matcher. Unauthenticated `/api/*` requests get a 401 JSON response, and unauthenticated pages redirect to `/login?next=...`. Login guesses are capped (`beginLoginAttempt()`/`forgetLoginAttempt()` in `docStore`, `login_attempts` table or `data/login-attempts.json`): 10 failures an hour across all clients, then 429 even for the right password. Each attempt is recorded before the password is checked so parallel guesses count; if it can't be recorded, login answers 503 rather than skipping the cap.
- **Recommendations**: ranking in `lib/recommend.ts` must stay deterministic and must exclude watched, watchlisted, and dismissed titles. If you change scoring weights, update the formula in the README and add or adjust a test.
- **Indian vs Global**: defined once in `lib/region.ts` (origin country `IN` or an Indian original language). Always call `isIndianTitle` / `isSouthIndianTitle`. Never write language lists inline. (`originCountry: "IN"` passed to `discover()` is a TMDB query filter, which is a separate thing.)
- **TMDB**: call it only from server code via `lib/tmdb.ts` (it has the timeout, retry, and data-cache TTLs: 6 h for lists, 7 days for details). Posters load from `image.tmdb.org`, the only allowed remote image host in `next.config.mjs`.
- **Money**: transactions are one doc per month plus `money-settings`, which also lists the months that have data (a new device learns which month docs to pull from it). Amounts are positive rupees; `kind` says what they count toward (`spentOf()`, `balances()`). What you owe a family member (`balances()`) is what they've spent since your last payment to them (`lastPayments()`), not an all-time net. Imported rows use the id `gpay:<UPI id>` (Paytm's too: its "UPI Ref No" is the same number), which is what dedupes re-imports and the two sides of a payment to family, even when one side came from Paytm. Paytm draws text as literal `(...)` strings, Google Pay as hex `<...>`; `readPdfText` handles both. The real statement PDFs in `data/` are personal and gitignored; tests build fake ones with `src/test/gpayPdf.ts` (`gpayPdf`, `paytmPdf`). A statement name belongs to the person whose alias matches it with the most words (`matchPerson`), so give someone their full name as an alias when it contains another person's. The review queue (`reviewQueue()`, `ReviewQueue.tsx`) lists imported spending with no learned rule for its payee that is still "other" or matches several categories (`categoryMatches()`); answering calls `fileUnder()`, which saves a rule (even for "other"), so a payee with a rule is never asked again. `exportMoney()`/`exportMoneyCsv()`/`restoreMoney()` are the backup: `{ app: "money", version: 1, settings, txns }`; restore syncs first, then merges and never deletes. Cash entries have `source: "cash"` and payee "Cash" unless named; recategorizing them doesn't save a rule. `seedFamily()` adds the starter family once, only after a successful sync, and the synced `seeded:family` value stops it re-adding anyone you remove.
- **Apps**: the project hosts several apps (Reel Radar: discover…person; Daily Planner: todos; Money: money). `/` is the launcher. Every app page's header starts with `<AppSwitcher current="<id>" />` (Home link + switch-app menu). Don't link directly to another app's pages from an app's nav. To add an app, register it in `lib/apps.ts`.
- **Styling**: Tailwind with the theme tokens `ink` (#07070c, background), `panel` (#11111a), and `gold` (#f6c453, accent). Use those tokens rather than raw hex values. The UI must work on phone widths.
- **Code style**: TypeScript strict, functional React components, `"use client"` only where needed. Match the formatting of the file you're editing.

## Testing

- Tests live next to their source as `*.test.ts(x)`. Everything is covered: `lib/`, `types/`, `proxy.ts`, all API routes, the shared components, and **every page** (each `app/**/page.tsx`, `todos/WeekView.tsx` and `todos/planner.tsx` has a render test; the home, layout, search, person and watchlist pages share `app/simple-pages.test.tsx`).
- **Pages need render tests.** A new page, or a new button, filter, form or state on one, gets a test that renders the page and drives it through the UI (click, type, drop) and checks both what's shown and what's saved. Logic in `lib/` still gets its own unit tests.
- Coverage is enforced: `npm run coverage` fails below 97% lines/statements, 95% functions and 90% branches (`vitest.config.mts`). Don't lower the thresholds to get a change through; add the missing tests.
- Page tests run against the real `lib/` code and `localStorage`; only `fetch` is faked. Use `src/test/pages.ts`: `routeFetch({ "/api/x": body | (url, init) => body })` answers by path (`/api/sync` defaults to an empty server), `requests(fetch, path)` lists calls, `seed()`/`stored()` read and write Reel Radar state, and `stubLocation()` replaces `window.location`. Mock `next/navigation` (`usePathname`, `useSearchParams`, `useParams`) in each page test.
- jsdom gaps: there's no `DragEvent`/`PointerEvent`, so set `clientY` and modifier keys on the event yourself (see `drag()` in `todos/page.test.tsx`), and dispatch pointer moves as `MouseEvent`s. `Element.scrollTo` and `Notification` need stubs.
- The task list is reordered by a pointer-driven drag handle (`useListReorder` in `todos/page.tsx`), not HTML5 drag and drop. Tests press the handle with a `pointerdown` `MouseEvent`, move with `pointermove` on `window`, and stub each row's `getBoundingClientRect` because jsdom has no layout (see `arranging tasks` in `todos/page.test.tsx`).
- Tests run in Node by default. Anything that touches the DOM or `localStorage` starts with `// @vitest-environment jsdom`.
- Shared helpers: `src/test/fixtures.ts` (`mk()` builds a `Title`, `jsonResponse()` builds a fetch response), `src/test/pages.ts` (above), and `src/test/setup.ts` (React cleanup, lets pending sync work settle, then resets `localStorage`).
- Never hit the network: stub `fetch` with `vi.stubGlobal`, and mock `@/lib/tmdb` with `vi.mock`. Sync tests use an in-memory libSQL database in place of `@libsql/client/web`.
- Sync route tests must point `process.cwd()` at a temp dir and re-import the route (see `src/app/api/sync-route.test.ts`), so the real `data/` files are never touched.
- Don't return a value from `beforeEach(() => ...)`. Vitest calls a returned function as cleanup, so `beforeEach(() => mock.mockResolvedValue(x))` ends up calling the mock after every test. Use a braced body.
- When adding a feature, add tests for it in the same change.
- Pages sit behind login. To check UI in a browser, set `APP_USERNAME`/`APP_PASSWORD`/`AUTH_SECRET` in `.env.local` and sign in at `/login`. If you couldn't view a page, say so; don't claim it was visually checked.

## Don'ts

- Don't commit secrets, `.env.local`, or `.next/`.
- `data/storage.json` is intentionally tracked in git (it holds the owner's viewing history). Don't delete it, reset it, or overwrite it with test data. The other `data/*.json` files are local dev docs and stay gitignored.
- Don't run the dev server or scripts against the live Turso database to test changes. Start with `TURSO_DATABASE_URL=` (empty) so they use `data/`.
- Don't add dependencies without a clear need. The dependency list is deliberately small.
- Don't send TMDB requests or the API key from client components.

## Money security review

The Money app holds personal financial data and the GitHub repo is public. Whenever you change the Money app or anything its data passes through (`app/money/`, `lib/money.ts`, the statement readers, `api/sync`, `lib/docStore.ts`, `lib/sync.ts`, `proxy.ts`, `lib/auth.ts`, `api/auth/*`, `next.config.mjs`), or propose such a change, check it for security concerns and report the result, even when there are none ("Security: no concerns, because ..."). Check at least:

- **Login gate**: money data is reachable only with a valid session. Every new route or page stays behind `proxy.ts` (watch its `matcher` exclusions and the `/login`, `/api/auth/` bypass), and no server component or route reads money docs without going through it.
- **Encryption at rest**: `money-*` docs are always sealed in `docStore`, with no plain-text path or missing-key fallback (see Sync above). A new money doc key must match the `/^money-/` encryption rule and the `DOC_KEY` allowlist.
- **No leaks**: money data, statement text, UPI ids, names, or amounts never go into logs, error responses, URLs/query strings, analytics, or third-party requests (TMDB included), and never into git: real statements stay in gitignored `data/`, and tests use fake data from `src/test/gpayPdf.ts`.
- **No real data in the repo**: personal names, emails, phone numbers, account numbers and statement rows don't go into code, tests, fixtures or docs. Real names come from `MONEY_MY_NAMES`/`MONEY_FAMILY`; tests use made-up ones.
- **Untrusted input**: imported PDFs and restored backups are untrusted. Validate their shape and size, and render their text as React text only (no `dangerouslySetInnerHTML`, no `eval`, no building HTML from it).
- **Auth and session**: don't weaken the cookie flags (`httpOnly`, `sameSite`, `secure`), the constant-time comparisons, the login delay, or the security headers in `next.config.mjs`. Don't add state-changing `GET` routes.
- **Dependencies**: a new dependency that touches money data needs a clear reason and a check for known vulnerabilities.

If you find a concern, say so before or alongside the change and propose a fix. Don't silently work around it.

## Finishing a change

- Always end by giving a ready-to-use commit message for the changes made: a short imperative subject line (about 50–72 characters), a blank line, then a few bullet points on what changed and why. Give it even when you weren't asked to commit. Don't commit or push unless asked.
- Anything that depends on the browser (`localStorage`, `Date.now()`/today, `window`) must not change the first render, or hydration fails. Read it in an effect (or after a `mounted` flag) instead.

## Docs

`README.md` covers setup, features, the data flow, the scoring formula, the project structure, and troubleshooting. Keep it in sync whenever you add a page or API route, change scoring weights, or change the storage shape.
