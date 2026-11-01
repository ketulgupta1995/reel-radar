// Copy the synced docs from Vercel Blob (v2/<doc>.json.gz) into Turso.
//
//   npx tsx scripts/migrate-blob-to-turso.ts [--apply] [--overwrite]
//
// Without --apply it only lists what it found and what it would write. Docs already in Turso are
// left alone unless --overwrite. Needs BLOB_READ_WRITE_TOKEN, TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN in .env.local; none of them is printed. Blob is only read, never changed.

import { get, list } from "@vercel/blob";
import { readFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import { DOC_KEY, isStoreConfigured, readDoc, writeDoc } from "@/lib/docStore";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const overwrite = args.has("--overwrite");

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

// A store is private or public and get() addresses each on its own host, so try both.
async function readBlob(pathname: string): Promise<unknown | null> {
  for (const access of ["private", "public"] as const) {
    const res = await get(pathname, { access, useCache: false }).catch(() => null);
    if (res && res.statusCode === 200) {
      const body = Buffer.from(await new Response(res.stream).arrayBuffer());
      return JSON.parse(gunzipSync(body).toString("utf-8"));
    }
  }
  return null;
}

async function main() {
  loadEnvLocal();
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set in .env.local");
  if (!isStoreConfigured()) throw new Error("TURSO_DATABASE_URL is not set in .env.local");

  // One list() call, once; the app itself never lists.
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "v2/", cursor });
    for (const b of page.blobs) {
      const key = /^v2\/(.+)\.json\.gz$/.exec(b.pathname)?.[1];
      if (key && DOC_KEY.test(key)) keys.push(key);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  console.log(`Docs in Blob: ${keys.length ? keys.join(", ") : "none"}`);

  let written = 0;
  for (const key of keys) {
    const existing = await readDoc(key);
    if (existing && !overwrite) {
      console.log(`${key}: already in Turso, skipped`);
      continue;
    }
    const data = await readBlob(`v2/${key}.json.gz`);
    if (data === null) {
      console.log(`${key}: could not be read from Blob, skipped`);
      continue;
    }
    console.log(`${key}: ${(JSON.stringify(data).length / 1024).toFixed(0)} KB${apply ? "" : " (would write)"}`);
    if (apply) {
      await writeDoc(key, data);
      written++;
    }
  }
  console.log(apply ? `Wrote ${written} docs to Turso.` : "Dry run: nothing was written. Pass --apply to write.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
