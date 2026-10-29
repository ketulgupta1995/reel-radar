import { createClient, type Client } from "@libsql/client/web";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// Server-only storage for synced docs: one row per doc in a Turso (libSQL) table, or plain JSON
// files in data/ when TURSO_DATABASE_URL isn't set (local dev). A doc's etag is a hash of its
// JSON, kept in its own column so an unchanged doc is answered without reading its body.

// Reel Radar's library and history, one doc per planner month, and the daily tasks.
export const DOC_KEY = /^(library|history|planner-daily|planner-log|planner-\d{4}-\d{2})$/;

export type ReadResult = { etag: string; data: unknown } | { etag: string; unchanged: true } | null;

export class ConflictError extends Error {
  constructor() {
    super("The doc changed on the server");
  }
}

export const isStoreConfigured = () => Boolean(process.env.TURSO_DATABASE_URL);

const localPath = (file: string) => path.join(process.cwd(), "data", file);
const etagOf = (text: string) => `"${createHash("sha1").update(text).digest("hex").slice(0, 16)}"`;

let db: Promise<Client> | undefined;

// Connect once per server instance and make sure the table exists. A failure isn't remembered.
function client(): Promise<Client> {
  db ??= (async () => {
    const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
    await c.batch(
      [
        "CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, data TEXT NOT NULL, etag TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS usage (bucket TEXT PRIMARY KEY, reads INTEGER NOT NULL, writes INTEGER NOT NULL)",
      ],
      "write"
    );
    return c;
  })().catch((err) => {
    db = undefined;
    throw err;
  });
  return db;
}

// ---------------- Usage ----------------
// How many database reads and writes the app makes, kept per half hour (UTC) so the stats page can
// total them per local day. Each doc read or write counts as one (local files count the same way). Counts gather in memory and
// are added to the usage table in a batch (see flushUsage), so counting adds few writes of its own.
// A server instance that goes away before a flush loses its last few counts.

export type UsageBucket = { reads: number; writes: number };
export type Usage = Record<string, UsageBucket>;

const FLUSH_AT = 10; // counts
const FLUSH_EVERY = 60_000; // ms
let pending: Usage = {};
let pendingTotal = 0;
let lastFlush = Date.now();

const bucketOf = (ms: number) => {
  const d = new Date(ms);
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return d.toISOString().slice(0, 16);
};

function count(kind: keyof UsageBucket, n = 1) {
  const b = (pending[bucketOf(Date.now())] ??= { reads: 0, writes: 0 });
  b[kind] += n;
  pendingTotal += n;
}

const addUsage = (into: Usage, from: Usage) => {
  for (const [k, v] of Object.entries(from)) {
    const b = (into[k] ??= { reads: 0, writes: 0 });
    b.reads += v.reads;
    b.writes += v.writes;
  }
};

// Save the gathered counts when enough have built up or it has been a minute (or `force`).
// Never throws: a failed save puts the counts back to try again.
export async function flushUsage(force = false): Promise<void> {
  if (!pendingTotal || (!force && pendingTotal < FLUSH_AT && Date.now() - lastFlush < FLUSH_EVERY)) return;
  const batch = pending;
  pending = {};
  pendingTotal = 0;
  lastFlush = Date.now();
  try {
    const rows = Object.entries(batch);
    if (isStoreConfigured()) {
      await (
        await client()
      ).batch(
        rows.map(([bucket, b]) => ({
          sql: "INSERT INTO usage (bucket, reads, writes) VALUES (?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET reads = reads + excluded.reads, writes = writes + excluded.writes",
          args: [bucket, b.reads, b.writes],
        })),
        "write"
      );
      count("writes", rows.length); // these saves are database writes too
    } else {
      const file = localPath("usage.json");
      const saved: Usage = JSON.parse(await fs.readFile(file, "utf-8").catch(() => "{}"));
      addUsage(saved, batch);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(saved), "utf-8");
    }
  } catch (err) {
    console.error("[Usage] Save failed", err);
    const failed = pending;
    pending = batch;
    addUsage(pending, failed);
    pendingTotal += totalOf(batch);
  }
}

const totalOf = (u: Usage) => Object.values(u).reduce((n, b) => n + b.reads + b.writes, 0);

// Everything counted since `since` (a bucket key like "2026-10-01T00:00"), saved and not yet saved.
export async function readUsage(since: string): Promise<Usage> {
  const usage: Usage = {};
  if (isStoreConfigured()) {
    const { rows } = await (
      await client()
    ).execute({ sql: "SELECT bucket, reads, writes FROM usage WHERE bucket >= ?", args: [since] });
    for (const r of rows) usage[String(r.bucket)] = { reads: Number(r.reads), writes: Number(r.writes) };
  } else {
    const saved: Usage = JSON.parse(await fs.readFile(localPath("usage.json"), "utf-8").catch(() => "{}"));
    addUsage(usage, Object.fromEntries(Object.entries(saved).filter(([k]) => k >= since)));
  }
  addUsage(usage, Object.fromEntries(Object.entries(pending).filter(([k]) => k >= since)));
  return usage;
}

export async function readDoc(key: string, ifNoneMatch?: string): Promise<ReadResult> {
  count("reads");
  if (!isStoreConfigured()) {
    const text = await fs.readFile(localPath(`${key}.json`), "utf-8").catch(() => null);
    if (text === null) return null;
    const etag = etagOf(text);
    return etag === ifNoneMatch ? { etag, unchanged: true } : { etag, data: JSON.parse(text) };
  }
  // A failed query throws; it must never read as "missing", or the client would push over the doc.
  const { rows } = await (await client()).execute({
    sql: "SELECT etag, CASE WHEN etag = ? THEN NULL ELSE data END AS data FROM docs WHERE key = ?",
    args: [ifNoneMatch ?? "", key],
  });
  if (!rows.length) return null;
  const etag = String(rows[0].etag);
  return rows[0].data === null ? { etag, unchanged: true } : { etag, data: JSON.parse(String(rows[0].data)) };
}

// Write a doc and return its new etag. With `ifMatch`, only if the stored copy still has that
// etag; otherwise this throws ConflictError and the caller merges.
export async function writeDoc(key: string, data: unknown, ifMatch?: string): Promise<string> {
  count("writes");
  const text = JSON.stringify(data);
  const etag = etagOf(text);
  if (!isStoreConfigured()) {
    const file = localPath(`${key}.json`);
    if (ifMatch) {
      const current = await fs.readFile(file, "utf-8").catch(() => null);
      if (current === null || etagOf(current) !== ifMatch) throw new ConflictError();
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf-8");
    return etag;
  }
  const c = await client();
  if (ifMatch) {
    const { rowsAffected } = await c.execute({
      sql: "UPDATE docs SET data = ?, etag = ? WHERE key = ? AND etag = ?",
      args: [text, etag, key, ifMatch],
    });
    if (!rowsAffected) throw new ConflictError();
  } else {
    await c.execute({
      sql: "INSERT INTO docs (key, data, etag) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, etag = excluded.etag",
      args: [key, text, etag],
    });
  }
  return etag;
}

// The single-file storage.json used before docs were split. Only the local fallback still has
// one; scripts/migrate-blob-to-turso.ts carries everything else over.
export async function readLegacyState(): Promise<unknown | null> {
  if (isStoreConfigured()) return null;
  const text = await fs.readFile(localPath("storage.json"), "utf-8").catch(() => null);
  return text === null ? null : JSON.parse(text);
}
