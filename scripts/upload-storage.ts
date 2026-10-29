// Upload data/storage.json to the doc store (Turso) as the synced library and history docs.
//
//   npx vite-node --config vitest.config.ts scripts/upload-storage.ts -- [--dry-run] [--purge-old-planner]
//
// Merges the file with whatever the store already holds, so nothing added in the app after the
// file was exported is lost. --purge-old-planner also deletes the old per-day planner blobs under
// todos/ in Vercel Blob (needs BLOB_READ_WRITE_TOKEN). --dry-run prints what would happen and
// writes nothing. Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from .env.local; they are never printed.

import { del, list } from "@vercel/blob";
import { readFileSync } from "fs";
import path from "path";
import { gzipSync } from "zlib";
import { isStoreConfigured, readDoc, readLegacyState, writeDoc } from "@/lib/docStore";
import { State, empty, historyOf, libraryOf, mergeHistory, mergeLibrary, toStored } from "@/lib/syncDocs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const purgeOldPlanner = args.has("--purge-old-planner");

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const kb = (data: unknown) => {
  const text = JSON.stringify(data);
  return `${(text.length / 1024).toFixed(0)} KB JSON, ${(gzipSync(text).length / 1024).toFixed(0)} KB gzipped`;
};

async function main() {
  loadEnvLocal();
  if (!isStoreConfigured()) throw new Error("TURSO_DATABASE_URL is not set in .env.local");

  const file: State = { ...empty(), ...JSON.parse(readFileSync(path.join(process.cwd(), "data", "storage.json"), "utf-8")) };
  console.log(`data/storage.json: ${file.watched.length} watched, ${file.watchlist.length} watchlist`);

  const [library, history] = await Promise.all([readDoc("library"), readDoc("history")]);
  const legacy = library || history ? null : await readLegacyState();
  const server: State = {
    ...empty(),
    ...((legacy as Partial<State>) ?? {}),
    ...(library && "data" in library ? (library.data as object) : {}),
    ...(history && "data" in history ? (history.data as object) : {}),
  };
  console.log(
    `Store now: ${library ? "v2 docs" : legacy ? "old storage.json" : "nothing"}, ` +
      `${server.watched.length} watched, ${server.watchlist.length} watchlist`
  );

  // No base: a two-way union, so nothing on either side counts as deleted.
  const lib = mergeLibrary(libraryOf(file), libraryOf(server));
  const libraryDoc = { ...lib, watched: lib.watched.map(toStored), watchlist: lib.watchlist.map(toStored) };
  const historyDoc = mergeHistory(historyOf(file), historyOf(server));
  console.log(`library: ${libraryDoc.watched.length} watched, ${libraryDoc.watchlist.length} watchlist, ${libraryDoc.dismissed.length} dismissed (${kb(libraryDoc)})`);
  console.log(`history: ${historyDoc.displayed.length} displayed, ${historyDoc.shown.length} shown (${kb(historyDoc)})`);

  if (!dryRun) {
    console.log(`Wrote library, etag ${await writeDoc("library", libraryDoc)}`);
    console.log(`Wrote history, etag ${await writeDoc("history", historyDoc)}`);
  }

  if (purgeOldPlanner) {
    const old: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "todos/", cursor });
      old.push(...page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    console.log(`Old planner blobs under todos/: ${old.length}`);
    if (!dryRun && old.length) {
      await del(old);
      console.log(`Deleted ${old.length}`);
    }
  }

  if (dryRun) console.log("Dry run: nothing was written or deleted.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
