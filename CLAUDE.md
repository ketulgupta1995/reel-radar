# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Read it before making changes.

## What this is

Reel Radar: a single-user Next.js 16 (App Router) app for movie/TV discovery, watch tracking, recommendations, taste analytics, a daily todo planner, and a money tracker. Data comes from the TMDB v3 API. State lives in the browser (`localStorage`) and syncs to Turso (libSQL), or to `data/*.json` locally when Turso isn't configured.

Stack: Next.js 16, React 19, TypeScript (strict), Tailwind 3, Vitest 4, `@libsql/client`.

## Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest run
npm run coverage # tests + coverage report (fails below the thresholds in vitest.config.mts)
npm run build    # production build; also the full typecheck
npx tsc --noEmit # quick typecheck

npx vitest run src/lib/recommend.test.ts         # one file
npx vitest run src/lib/sync.test.ts -t "409"     # tests whose name matches
npx vitest run src/app/todos                     # everything under a folder
```

Before calling a change done, run `npm run coverage` and `npx tsc --noEmit` (or `npm run build`).

Node 20.9+ is required. On this machine the system `node` is v12, which fails with `SyntaxError: Unexpected token '?'`. Shell state doesn't carry between Bash calls, so put nvm's Node 22 first on PATH in every command:

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && npm test
```

## Environment

Copy `.env.example` to `.env.local`. Never commit `.env.local` or print its values.

| Var | Required | Purpose |
|---|---|---|
| `TMDB_API_KEY` | yes | Every TMDB call goes through the server; it's never exposed to the client |
| `APP_USERNAME`, `APP_PASSWORD` | yes | Single-user login credentials |
| `AUTH_SECRET` | yes | HMAC key for the session cookie |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | no | Turns on Turso storage; without the URL, storage falls back to `data/` |
| `MONEY_ENCRYPTION_KEY` | for Money | 32 bytes, base64. `docStore` encrypts `money-*` docs with it; money reads and writes fail without it |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_CRON_SECRET` | no | Closed-app reminders. The public key reaches the browser through `GET /api/push` behind the login; don't make any of these `NEXT_PUBLIC_` |
| `MONEY_MY_NAMES`, `MONEY_FAMILY` | no | Starter family for Money (`lib/moneyFamily.ts`), served by `api/money/family` and added once by `seedFamily()`. Keeps real names out of the public repo; never make them `NEXT_PUBLIC_` (static bundles aren't behind the login) |
| `BLOB_READ_WRITE_TOKEN` | scripts only | For the scripts that read or clean up old Vercel Blob data. The app doesn't use it |

## Keep away from live data

`.env.local` holds the real Turso credentials, and the owner often has their own `next dev` running from this repo against the live database.

- Start any dev server or script you run with the store turned off, on a different port: `TURSO_DATABASE_URL= npx next dev -p 3001`. An empty shell variable takes precedence over `.env.local`, and `docStore` then falls back to `data/`.
- Remember that edits to sync, storage or `docStore` code hot-reload into the owner's running server and their open tabs, so they can reach live data before any deploy.
- Ask before running `scripts/*.ts` without `--dry-run` or listing mode, or before anything else that writes to or deletes from Turso.
- When changing sync or storage, count the database reads and writes and the function calls the change adds (see "Free-tier usage and performance").

## Layout

```
src/
  proxy.ts               Auth gate for every route except /login, /api/auth/*, /api/push/send (own secret) and static files
  app/                   Pages: / (app launcher), reel-radar (Reel Radar landing), discover,
                         recommendations, analysis, watched, watchlist, dismissed, search, similar,
                         person/[id], todos, todos/stats, todos/lists, todos/review, todos/goals, todos/search, money, money/import, money/settings, books, books/[id], login
  app/todos/             Planner page parts: AddTaskForm, TaskTrays, TodoItem, NextUp, WeekView, MonthView, AutoSchedule, RepeatPicker, PlannerTools, Slipping,
                         Deadlines, ClockTimePicker, shared planner.tsx
  app/money/             Money page parts: ReviewQueue, shared.tsx
  app/api/               Route handlers: discover, recommendations, similar, search, title,
                         person/[id], sync, media/[id], books/gutenberg/[id], books/librivox, usage, push, push/send, money/family (starter family from the env),
                         tmdb/refresh, auth/login, auth/logout
  components/            TitleCard, TitleDetailsModal, StorageControls, LogoutButton, AppSwitcher, ReelNavLinks, TmdbRefreshButton
  lib/
    apps.ts              App registry (home page cards + AppSwitcher menu)
    tmdb.ts              TMDB client and normalization (server only)
    recommend.ts         Scoring and ranking; tested in recommend.test.ts
    region.ts            Indian vs Global rule (isIndianTitle, isSouthIndianTitle)
    analysis.ts          Analytics aggregation
    storage.ts           Reel Radar state: load/save, merge, export/import, useStorageSync()
    todos.ts             Todo and daily-task model and logic, planner sync ("use client")
    plannerBackup.ts     Planner export/import: days, daily tasks, day log, lists, tags, templates, goals, log items ("use client")
    reminders.ts         Reminder rules shared by the page and the server (no "use client")
    push.ts              Browser side of reminders: service worker, subscribing, notify()
    pushReminders.ts     Server side of reminders: subscriptions, what's due, sending
    webPush.ts           VAPID signing and RFC 8291 encryption with Node crypto (server only)
    lists.ts             Planner lists (wishlist, things to remember): items, quick-add parsing, sync ("use client")
    media.ts             Photo/voice-note uploads to /api/media: shrinking, type and size limits
    money.ts             Money model: transactions, people, limits, categories, import plan, sync ("use client")
    moneyFamily.ts       Parses the starter family from MONEY_MY_NAMES and MONEY_FAMILY (server only)
    gpayStatement.ts     Statement PDF reader (no PDF library), Google Pay rows, parseStatementPdf(); tested with src/test/gpayPdf.ts
    paytmStatement.ts    Paytm statement rows (year from the period, sign gives direction); same reader and test helper
    sync.ts              Client sync engine (etags, batched pushes, three-way merge, refocus)
    syncDocs.ts          Doc shapes, merge3(), toStored(); shared by client, server and script
    docStore.ts          Server-only doc storage: one Turso row per doc, or data/ locally
    http.ts              cachedJson() for browser-cacheable API responses
    plannerStats.ts      Planner stats aggregation (pure; used by /todos/stats)
    plannerInsights.ts   Sleep hours, day log trends and patterns, planned vs. actual time, review week, month data, goal progress (pure)
    plannerSearch.ts     Finds text in every day's tasks and day notes (pure; used by /todos/search)
    plannerSettings.ts   Tags, day templates, goals and day log items: a synced doc, useTags(), useGoals(), useLogItems(), tagLabel(), tagColor() ("use client")
    autoSchedule.ts      Proposes a day's plan from free time, priority and length (pure)
    quickAdd.ts          Reads the add-box shorthand: time, length, tag, priority, date, deadline, repeat
    usageStats.ts        Database reads/writes per local day (pure; used by /todos/stats)
    auth.ts              Session signing/verification via Web Crypto
    booksDoc.ts          The synced `books` doc: library entries and places, with removal markers; merge, save/commit position, useBooksSync() ("use client")
    books.ts             Books on this device: EPUB and PDF files (IndexedDB), addBook()/addUpload(), removeBook(), purgeRemoved(), openBook(), voice prefs ("use client")
    epub.ts              EPUB reader: chapters of sentences, DRM and invalid-file errors (jszip loaded on demand)
    pdfText.ts           Tidies PDF text: drops running headers, footers and page numbers, joins lines into paragraphs, rejoins hyphenated words (pure)
    pdf.ts               PDF reader: isPdf() sniffs the bytes, parsePdf() returns the same ParsedBook as parseEpub (pdf.js loaded on demand); PdfError
    sentences.ts         splitSentences(): sentences for reading aloud (pure)
    sources.ts           Types shared by the book catalogues: Found, SourceError, size and time limits (pure)
    gutenberg.ts        Gutenberg search through its OPDS feed (browser) and download through our route
    catalogue.ts        searchCatalogue(): both sources at once, merged, with a note when one fails
    librivox.ts          LibriVox recordings: search and sections through our route, formatDuration()
    voices.ts            Which speech voices to offer: English only, short list, saved choice kept (pure)
    useWakeLock.ts      Keeps the screen on while playing ("use client")
    standardEbooks.ts    Standard Ebooks search and EPUB download, straight from the browser (reads their search page; no API)
    player.ts            Sentence player state machine (run ids ignore late end events) and chunkSentence() (pure; tested in player.test.ts)
    usePlayer.ts         Speech hook over the browser's speechSynthesis; pause cancels, play repeats the sentence ("use client")
  types/title.ts         Title / MediaType types and keyOf()
data/                    storage.json (tracked backup of the watch history) + local fallback docs (<doc>.json, gitignored)
scripts/upload-storage.ts  Upload data/storage.json to the doc store (run with tsx; see README)
scripts/migrate-blob-to-turso.ts  One-off copy of the old Vercel Blob docs into Turso
```

Import through the `@/` alias (maps to `src/`).

The repo is indexed by CodeGraph (`.codegraph/`). Use `codegraph explore "<symbol or question>"` (or the MCP tool) before grep when following call paths, for example `markDirty` → `/api/sync` → `docStore.writeDoc`.

## Conventions and invariants

- **Title identity**: a title is identified by `keyOf(t)` → `"movie:123"` / `"tv:123"`. A TMDB id alone isn't unique across media types.
- **State shape** (`State` in `lib/storage.ts`): `watched`, `watchlist` (full `Title` objects), and `displayed`, `shown`, `dismissed` (key strings). If you add a field, update all of these together in `lib/syncDocs.ts`: `empty()`, `libraryOf()`/`historyOf()` and `mergeLibrary()`/`mergeHistory()`, plus import/export.
- **localStorage key** `reel-radar-v1` holds user data. Don't rename it or change the shape in ways that break existing saved data. Make migrations additive.
- **Merging** (`mergeStates`) unions watched seasons. Keep it idempotent, because import and sync both depend on it.
- **Sync** (`api/sync`, `lib/docStore.ts`, `lib/sync.ts`): data is split into docs (`library`, `history`, `planner-YYYY-MM`, `planner-daily`, `planner-log`, `planner-lists`, `planner-settings`, `money-YYYY-MM`, `money-settings`, `books`; the allowlist is `DOC_KEY`). Keep these properties:
  - Reads send the client's etag, and an unchanged doc comes back without its body. A failed read must surface as an error, never as "missing", or the client pushes over the doc.
  - Writes are conditional (`UPDATE ... WHERE etag = ?`). A push with no etag only creates a doc (`writeDoc(key, data, null)`), so a device that never pulled it can't replace it. A 409 carries the server copy; the client merges and retries.
  - Pushes are batched through `markDirty()`; don't `fetch` the sync route from features directly. A sync must not write back what it just read.
  - Merges are three-way against the stored base (`merge3`), so deletes carry across devices. Planner items carry `updatedAt`; daily copies use the fixed id `<dailyId>:<date>`.
  - Without `TURSO_DATABASE_URL` everything falls back to `data/<doc>.json`.
  - `money-*` docs are encrypted at rest in `docStore` (`seal`/`unseal`: AES-256-GCM, `enc:v1:<iv>:<ciphertext+tag>`, the doc key as AAD), in Turso and `data/` alike. Etags hash the stored (encrypted) text. Never add a path that stores them unsealed or falls back to plain text when the key is missing. Plain legacy docs are sealed on read (the read query returns their body even for a matching etag). Tests set the key with `vi.stubEnv("MONEY_ENCRYPTION_KEY", ...)`.
  - `readDoc`/`writeDoc` count every call per half hour (`flushUsage()` saves the counts to the `usage` table, or `data/usage.json`; `/api/usage` serves them to the stats page). Any new code path that queries the `docs` table must go through them so it is counted.
- **Media** (list photos and voice notes): one `media-<id>` doc each, through `readDoc`/`writeDoc`/`deleteDoc` in `api/media/[id]`, never `/api/sync` (they stay out of `DOC_KEY` and out of `localStorage`). Ids are random and files are never rewritten, so GET answers `private, immutable`. Only the types in `MEDIA_TYPES` are stored or served (no SVG or HTML), up to `MAX_MEDIA_BYTES`. List items keep `MediaRef`s; whoever drops an item, photo or list deletes its media. Links on items go through `cleanLink()` (http/https only) before they reach an `href`. `next.config.mjs` allows `microphone=(self)` for voice notes.
- **Postponing**: `postponeCount()` is the one reader of a todo's `postponed` (tasks older than that field count once if they have `carriedFrom`). `carryOverdueTo()` and `moveTodoToDate()` raise it; a move only counts when an unfinished task leaves today or a past day for a later one, not when future plans are rearranged. Overdue covers one-off tasks only, because every day gets its own daily copy. Todo ids are unique across a month doc: `saveTodos` treats the same id on another day as a move.
- **Deadlines**: a todo's `due` is separate from the day it's planned on, so moving or carrying a task keeps it. Only one-off tasks have one: `addTodo`, `setTodoDue` and `makeTodoDaily` enforce that, and `copyTodoToDate` drops it. `getDueTodos()` feeds the tray, and the page leaves those tasks out of Overdue so each shows once. That tray can hold tasks planned ahead, so `syncTrayPlanner()` pulls next month as well as every past one.
- **Goals**: live in `planner-settings` (no extra doc to read). Todos and daily tasks hold a `goalId`, which each day's copy of a repeat inherits, and `syncDailyFrom` carries a change to later days. A deleted goal's id stays on its tasks and just stops matching. `computeGoalProgress()` is the one place that decides what counts. The percentage covers one-off tasks only, because repeats have no end; every finished copy of a linked repeat counts, including cleared ones (`doneDates`), and missed copies don't.
- **Day log items**: their definitions (`LogItemDef`: a tick or a number, with an order) live in `planner-settings` as `logItems`, merged like tags; built-ins have no entry until changed, so a doc without the field (from an older device) reads as the seven built-ins. A removed item keeps its entry. A day's values are `DayLog.ticks` (`{ at? }`, minutes after midnight, only for a tick made on the day itself) and `DayLog.counts`, written through `setLogTick()`/`setLogCount()`; `updateDayLog()` and the backup import both clean them with `cleanTicks()`/`cleanCounts()`. Ticks stay out of the schedule's Done column and out of search.
- **Search**: `/todos/search` pulls everything once on open, then filters this browser's copy, so keep it free of per-keystroke requests. `/todos?date=YYYY-MM-DD` and `/todos/lists?list=<id>&item=<id>` open what a result links to; the planner clears its parameter so a later reload goes back to today.
- **Repeats**: `RepeatRule` (`lib/reminders.ts`) holds one kind at a time on a `DailyTask`: `days`, `every`, `monthDay` or `timesPerWeek`; none means daily. `normalizeRepeat()` enforces that. `repeatsOn()` only knows the calendar; a `timesPerWeek` task also depends on what's done that week, so go through `missingDailyTasks()` with a `doneInWeek` count. Its streak counts weeks, not days. Giving a repeating task's copy a time sets it for later days too (`syncDailyFrom`), which is why auto-schedule skips repeating tasks.
- **Adding to another day**: pull its month first (`syncPlanner([date])`), so the task lands in the latest copy. If the pull fails, the task stays on this device and merges when it pushes.
- **Tags**: a `TagId` is any string. Read names and colours with `tagLabel()`/`tagColor()`, and offer choices with `useTags()` (it starts on the built-ins, so the first render matches the prerendered page). Colours come only from `TAG_PALETTE`, validated together, which is why tags stop at `MAX_TAGS`. Removing a tag keeps its entry so old tasks and stats still show it.
- **Reminders**: `public/sw.js` shows pushes and has no `fetch` handler, so private pages are never cached. An outside scheduler calls `POST /api/push/send` every minute with `PUSH_CRON_SECRET`. It's the one data route `proxy.ts` skips, so it must check that secret itself, stay shut when the secret is unset, answer with counts only, and never log task text or endpoints. `push-subscriptions` goes through `readDoc`/`writeDoc` and stays out of `DOC_KEY`. Stored endpoints are limited to known push services (`PUSH_HOST`), because the server POSTs to them. The server works out what's due from the docs, so it counts today's repeating tasks that have no copy yet (`missingDailyTasks`). Code it shares with `lib/todos.ts` belongs in `lib/reminders.ts`, because a `"use client"` module can't be called from a route.
- **Vercel usage**: TMDB GET routes answer through `cachedJson()` with `LIST_MAX_AGE` or `DETAIL_MAX_AGE`, which match the data-cache TTLs in `lib/tmdb.ts`, so change them together. `TmdbRefreshButton` gets past both caches: `/api/tmdb/refresh` expires the `LIST_TAG` tag plus one `detailTag()`, then the page refetches with `cache: "reload"`. Don't expire every detail, because the next recommendations request would then make hundreds of TMDB calls. Mocks can't prove cache expiry, so check changes to it against a real `next start` with TMDB faked. `/recommendations` sends `tasteInput()` fields and keeps results per filter combination while open; if ranking starts reading another field of a watched title's fallback, add it to `tasteInput()`. Pick a `poster()` size that fits the slot. Every route that calls TMDB or the database sets `maxDuration`. Keep new routes the same (see "Free-tier usage and performance").
- **Todos** are stored one doc per month (`planner-YYYY-MM`), plus `planner-daily` for repeating tasks. `loadTodos`/`saveTodos` keep the per-day API on top of that.
- **Auth**: `lib/auth.ts` must stay Web Crypto–only (no Node `crypto`) so it stays portable between the proxy and route handlers. New API routes are protected automatically by the proxy matcher (`/api/push/send` is the exception, with its own secret). Unauthenticated `/api/*` requests get a 401 JSON response, and unauthenticated pages redirect to `/login?next=...`. Login guesses are capped (`beginLoginAttempt()`/`forgetLoginAttempt()` in `docStore`, `login_attempts` table or `data/login-attempts.json`): 10 failures an hour across all clients, then 429 even for the right password. Each attempt is recorded before the password is checked so parallel guesses count; if it can't be recorded, login answers 503 rather than skipping the cap.
- **Recommendations**: ranking in `lib/recommend.ts` must stay deterministic and must exclude watched, watchlisted, and dismissed titles. If you change scoring weights, update the formula in the README and add or adjust a test.
- **Indian vs Global**: defined once in `lib/region.ts` (origin country `IN` or an Indian original language). Always call `isIndianTitle` / `isSouthIndianTitle`. Never write language lists inline. (`originCountry: "IN"` passed to `discover()` is a TMDB query filter, which is a separate thing.)
- **TMDB**: call it only from server code via `lib/tmdb.ts` (it has the timeout, retry, and data-cache TTLs: 6 h for lists, 7 days for details). Posters load from `image.tmdb.org`, the only allowed remote image host in `next.config.mjs`.
- **Money**: transactions are one doc per month plus `money-settings`, which also lists the months that have data (a new device learns which month docs to pull from it). Amounts are positive rupees; `kind` says what they count toward (`spentOf()`, `balances()`). What you owe a family member (`balances()`) is what they've spent since your last payment to them (`lastPayments()`), not an all-time net. Imported rows use the id `gpay:<UPI id>` (Paytm's too: its "UPI Ref No" is the same number), which is what dedupes re-imports and the two sides of a payment to family, even when one side came from Paytm. Paytm draws text as literal `(...)` strings, Google Pay as hex `<...>`; `readPdfText` handles both. The real statement PDFs in `data/` are personal and gitignored; tests build fake ones with `src/test/gpayPdf.ts` (`gpayPdf`, `paytmPdf`). A statement name belongs to the person whose alias matches it with the most words (`matchPerson`), so give someone their full name as an alias when it contains another person's. The review queue (`reviewQueue()`, `ReviewQueue.tsx`) lists imported spending with no learned rule for its payee that is still "other" or matches several categories (`categoryMatches()`); answering calls `fileUnder()`, which saves a rule (even for "other"), so a payee with a rule is never asked again. `exportMoney()`/`exportMoneyCsv()`/`restoreMoney()` are the backup: `{ app: "money", version: 1, settings, txns }`; restore syncs first, then merges and never deletes. Cash entries have `source: "cash"` and payee "Cash" unless named; recategorizing them doesn't save a rule. `seedFamily()` adds the starter family once, only after a successful sync, and the synced `seeded:family` value stops it re-adding anyone you remove.
- **Apps**: the project hosts several apps (Reel Radar: discover…person; Daily Planner: todos; Money: money; Books: books). `/` is the launcher. Every app page's header starts with `<AppSwitcher current="<id>" />` (Home link + switch-app menu). Don't link directly to another app's pages from an app's nav. To add an app, register it in `lib/apps.ts`.
- **Books**: an EPUB's bytes live only in the browser's IndexedDB (`lib/books.ts`) and never go to the server, `/api/media` or Turso. A book's id is the first 16 hex characters of its file's SHA-256, so the same file is the same book. Copy protection (any encryption other than font obfuscation, or `rights.xml`) is refused with `EpubError("drm")`. Plan and tickets: `.scratch/books/` and, for PDFs, `.scratch/books-pdf/` (local, gitignored). `jszip` is a dependency, imported on demand so it only loads on Books pages; `fake-indexeddb` is a dev dependency for tests (create a fresh `new IDBFactory()` per test). `src/test/setup.ts` polyfills `Blob.arrayBuffer`, which jsdom lacks; `src/test/epub.ts` builds fake EPUBs.
- **PDFs in Books** (`lib/pdf.ts`): the type is told from the bytes (`isPdf()`: a `%PDF-` header in the first 1 KB), never the file name, in `addBook()` and `openBook()`. `parsePdf()` returns the same `ParsedBook` as `parseEpub()`, so the player, chapter list, position and sync don't know the difference: a PDF's chapters are the top-level entries of its outline when it has one that points at pages (`outlineStarts()`: entries in page order, unresolvable ones skipped, the first of two on one page kept, text before the first entry an opening chapter titled by page range), otherwise groups of 10 pages titled "Pages 1–10" (a position is chapter plus sentence). Nested outline entries are ignored. Its title and author come from the PDF's metadata, else the file name and "Unknown author". A library entry has `format: "pdf"` for a PDF; an EPUB's entry has no `format`, so older entries and older clients are unaffected (an older client that moves a PDF's place keeps `format`, since it copies the entry whole; the file-restore, different-edition and removal flows are the same for PDFs and EPUBs, and are tested for both). `pdfjs-dist` (the `legacy` build, pinned) is imported on demand so it only loads on Books pages; in a browser it reads on its own worker (`GlobalWorkerOptions.workerSrc`, set only when `Worker` exists), and without one (tests, Node) it uses its built-in fallback. It takes over the buffer it is given, so `parsePdf()` passes a copy. A PDF is untrusted input: fonts aren't loaded (`disableFontFace`), XFA is off, and text only leaves as plain strings. `src/test/pdf.ts` builds fake text PDFs (`textPdf()`, `pdfFile()`) with standard Helvetica; `gpayPdf.ts` can't be used for this, because its stand-in font only its own reader understands. `PdfError` has four codes: `invalid` (damaged or not a PDF), `scan` (no text anywhere; pages without text are skipped, so a mostly scanned PDF still reads), `encrypted` (pdf.js asks for a password) and `limit` (over `MAX_PDF_PAGES` pages or `MAX_PDF_CHARS` characters; `parsePdf()` takes lower limits as its third argument for tests). A PDF encrypted with only an owner password opens in pdf.js, so it is read; it is not refused. `addBook()` refuses bytes that are neither a PDF nor a zip with `EpubError("invalid")`, and anything over 50 MB before reading it. Reading reports progress and can be stopped: `parsePdf()` takes `onProgress(pagesRead, pages)` (after every page, which also yields to the browser between pages) and an `AbortSignal` (an `AbortError`, nothing added); `addUpload()`/`addBook()` pass them through as `ReadHooks`, and the Books page shows a `<progress>` bar and aborts when it unmounts. pdf.js itself parses on its own worker thread in a browser; the main thread only joins the text, splits sentences and hashes the file. Text cleanup lives in `lib/pdfText.ts` (heuristics; thresholds are constants at its top): `linesOf()` in `pdf.ts` turns pdf.js items into lines with their `y` and height; `stripPageFurniture()` drops bare page numbers and lines (≤ 80 characters, digits ignored) that repeat among a page's first or last 2 lines on at least half the pages (and at least 3), and never on documents of fewer than 3 pages or on pages of fewer than 5 lines; `paragraphsOfPage()` joins lines, starting a paragraph at a gap over 1.6 line heights or where text jumps back up the page, and rejoins a word hyphenated at a line end (the hyphen goes when the next line starts in lower case, so a real compound split over two lines, "well-" "known", loses its hyphen); `joinPages()` carries an open paragraph (not ending in `. ! ? … ” ’ ) ] :`) over the page break. Sentences are split per paragraph. `looksMultiColumn()` guesses columns from where text sits (`spansOf()` in `pdf.ts`): a page counts when a clear strip (≥ 12 points) in its middle 40% is crossed by at most 10% of its text pieces and each side holds ≥ 5 pieces and ≥ 25% of them, and the PDF is flagged when at least 30% of its text pages (≥ 10 pieces) count. It only sets `ParsedBook.warning` (a note the book page shows above the player; text is never reordered). Plan and tickets: `.scratch/books-pdf/`.
- **Books sync** (`lib/booksDoc.ts`, doc key `books`, stored locally as `reel-radar-books`): one item per book, `{ entry, position?, removed?, updatedAt }`, merged three-way by id with the newest change winning. A removal is a marker, never a deletion: it is final (an older or newer copy of the book can't undo it) and it is how other devices learn to delete their file (`purgeRemoved()`). `savePosition()` writes locally after every sentence and does NOT mark the doc dirty; `commitPosition()` does, and is called when playback stops, the chapter changes, and the page is left or hidden (`pushPosition()` also pushes at once). The adapter's push delay is 5 s. That batching keeps writes near 300 a month: don't mark the doc dirty per sentence. Before this doc existed the library was in `books-library-v1` and `books-position-v1`; `readDoc()` moves those over once. Adding a file for a book that is already in the library (from another device) stores the file under the existing id and keeps its place (`restored`); a catalogue book is matched by `sourceId` when its edition has changed.
- **Standard Ebooks** (`lib/standardEbooks.ts`): the site allows cross-origin requests, so search and download run in the browser and cost no Vercel usage. It has no search API, so `parseResults()` reads the search page's markup (`li[typeof="schema:Book"]`, inside `main.ebooks`); a page without `main.ebooks` is reported as a changed layout, not as an empty list. Download addresses follow `/ebooks/<path>/downloads/<path with / as _>.epub`, and `downloadEpub()` refuses any other host. Library entries from a catalogue carry `sourceId` (`standard-ebooks:<path>`), which is how a result shows "In your library".
- **Gutenberg** (`lib/gutenberg.ts`, `api/books/gutenberg/[id]`): search uses Gutenberg's own OPDS feed from the browser (it allows cross-origin requests, so no function call; Gutendex was tried first but timed out repeatedly). Its EPUB files don't allow cross-origin requests, so `GET /api/books/gutenberg/<number>` fetches `cache/epub/<n>/pg<n>.epub` (the small no-illustrations edition) and refuses anything over 4.4 MB, Vercel's response limit being 4.5 MB. The route only accepts digits and only contacts gutenberg.org; keep it that way (it is a server-side fetch). `mergeResults()` lists a book once when title and a name match, Standard Ebooks first. A failing source gives a note, not an empty list.
- **LibriVox** (`lib/librivox.ts`, `api/books/librivox`, `app/books/[id]/RecordingPlayer.tsx`): LibriVox's API has no cross-origin access, so `GET /api/books/librivox?title=&author=` (a short list, no sections, recordings by the author's surname first) and `?id=` (one recording with its sections) ask it, with a timeout and `maxDuration`. The route only passes on https archive.org audio addresses, because the browser plays them; keep that filter. Audio streams from archive.org straight to an `<audio>` element, so it costs no function calls. The user picks the recording; never attach one automatically (a title can match the wrong book). The choice is `recording` on the book's item in the `books` doc, with its own `recordingAt` so a choice made on one device and a place saved on another both survive the merge. A recording has no sentence timings and its sections don't match chapters 1:1, so only the section is tracked: it is stored as the position's `chapter` (sentence 0), and switching modes keeps that number, clamped to what the other side has. Which way a book is listened to is per device (`books-mode-v1`).
- **Player** (`lib/player.ts`, `lib/usePlayer.ts`): sentence-at-a-time, validated on Android Chrome (see `.scratch/books/spec.md`). Android sends no word events (highlight per sentence only), its own pause is unreliable (pause = `speechSynthesis.cancel()`, play re-speaks the sentence), and sentences over 1,000 characters fail (`chunkSentence`: cut after a comma, semicolon or colon when one falls past 30% of the limit, otherwise at the last space, otherwise hard; PDF text can be one long unpunctuated run, so this matters there too). Every spoken sentence carries a `runId`; an end event from an older run is ignored. The position is saved to `localStorage` (`books-position-v1`) after every sentence, only once `state.key` matches the loaded chapter. A failed sentence is retried twice (`MAX_RETRIES`), and a chunk that outlasts a time estimate counts as a failure (stall watchdog); the page pauses when `visibilitychange` says hidden, since Android's engine fails in the background. Voice and speed live in `books-voice-v1` and apply from the next sentence. Tests fake `speechSynthesis` and finish each utterance by hand (see `app/books/[id]/page.test.tsx`).
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
- Don't run the dev server or scripts against the live Turso database to test changes (see "Keep away from live data").
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

## Free-tier usage and performance

The app runs on free or hobby plans (Vercel Hobby, Turso's free plan), so keep usage low without making it slower for the user.

- For every change, consider what it adds: function calls, proxy runs, database reads and writes, TMDB requests, bandwidth, and client bundle size.
- Prefer savings the user doesn't notice: browser and data caching, conditional reads, batched writes, static rendering, and doing work in the browser.
- Don't trade away perceived speed, sync freshness or correctness to save usage unless the owner agrees. Local changes must still feel instant.
- Don't add polling, cron jobs, or per-render or per-keystroke requests without counting their monthly cost.

When a task affects usage or performance, report this before the commit message:

- **Usage:** what changes, with numbers where possible (for example, "+1 read per page open, about 300 a month").
- **Performance:** what the user would notice, or "no noticeable change".
- **Trade-off:** what you chose and why, plus any option you rejected.

If a task affects neither, say so in one line: "Usage and performance: no impact, because ...".

## Finishing a change

- Always end by giving a ready-to-use commit message for the changes made: a short imperative subject line (about 50–72 characters), a blank line, then a few bullet points on what changed and why. Give it even when you weren't asked to commit. Don't commit or push unless asked.
- Anything that depends on the browser (`localStorage`, `Date.now()`/today, `window`) must not change the first render, or hydration fails. Read it in an effect (or after a `mounted` flag) instead.

## Docs

`README.md` covers setup, features, the data flow, the scoring formula, the project structure, and troubleshooting. `CLAUDE.md` covers commands, layout, invariants and testing rules.

After every task, before giving the commit message, check both files against what changed and update them in the same change, so neither describes old behaviour or contradicts the other. This includes new or removed pages, API routes, `lib/` files, environment variables and scripts, and changes to features, scoring weights, the storage shape, or test numbers. If a task changes nothing they cover, leave them alone and say so.
