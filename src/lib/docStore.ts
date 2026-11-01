import { createClient, type Client } from "@libsql/client/web";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// Server-only storage for synced docs: one row per doc in a Turso (libSQL) table, or plain JSON
// files in data/ when TURSO_DATABASE_URL isn't set (local dev). A doc's etag is a hash of its
// JSON as stored, kept in its own column so an unchanged doc is answered without reading its body.

// Reel Radar's library and history, one doc per planner month, the daily tasks, and the Money
// app's settings and months.
export const DOC_KEY = /^(library|history|planner-daily|planner-log|planner-\d{4}-\d{2}|money-settings|money-\d{4}-\d{2})$/;

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
        "CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY, at INTEGER NOT NULL)",
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

// ---------------- Encryption ----------------
// The Money docs are stored encrypted (AES-256-GCM with the key in MONEY_ENCRYPTION_KEY), in Turso
// and in data/ alike: "enc:v1:<iv>:<ciphertext + tag>", base64, bound to the doc's key so one
// month can't be swapped for another. Without a valid key they can't be read or written, so they
// are never stored as plain text. Plain ones saved before encryption are sealed when next read.

const ENCRYPTED = /^money-/;
const SEALED = "enc:v1:";
const TAG_BYTES = 16;

function moneyKey(): Buffer {
  const key = Buffer.from(process.env.MONEY_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("MONEY_ENCRYPTION_KEY must be 32 random bytes, base64 (openssl rand -base64 32)");
  return key;
}

export const isSealed = (stored: string) => stored.startsWith(SEALED);

// What to store for a doc's JSON.
function seal(key: string, text: string): string {
  if (!ENCRYPTED.test(key)) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", moneyKey(), iv).setAAD(Buffer.from(key));
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${SEALED}${iv.toString("base64")}:${body.toString("base64")}`;
}

// A stored doc's JSON. A wrong key or tampered text throws.
function unseal(key: string, stored: string): string {
  if (!isSealed(stored)) return stored;
  const [iv, body] = stored.slice(SEALED.length).split(":").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", moneyKey(), iv).setAAD(Buffer.from(key));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}

const needsSealing = (key: string, stored: string) => ENCRYPTED.test(key) && !isSealed(stored);

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
  let stored: string;
  let etag: string;
  if (!isStoreConfigured()) {
    const text = await fs.readFile(localPath(`${key}.json`), "utf-8").catch(() => null);
    if (text === null) return null;
    stored = text;
    etag = etagOf(text);
    if (etag === ifNoneMatch && !needsSealing(key, stored)) return { etag, unchanged: true };
  } else {
    // A failed query throws; it must never read as "missing", or the client would push over the doc.
    // A Money doc still stored as plain text comes back with its body even when unchanged, to be sealed.
    const { rows } = await (await client()).execute({
      sql: `SELECT etag, CASE WHEN etag = ? AND (key NOT LIKE 'money-%' OR data LIKE '${SEALED}%') THEN NULL ELSE data END AS data FROM docs WHERE key = ?`,
      args: [ifNoneMatch ?? "", key],
    });
    if (!rows.length) return null;
    etag = String(rows[0].etag);
    if (rows[0].data === null) return { etag, unchanged: true };
    stored = String(rows[0].data);
  }
  const text = unseal(key, stored);
  if (needsSealing(key, stored)) {
    // Seal it in place, unless it changed meanwhile; then the next read tries again.
    etag = await writeDoc(key, JSON.parse(text), etag).catch((err) => {
      if (err instanceof ConflictError) return etag;
      throw err;
    });
  }
  return { etag, data: JSON.parse(text) };
}

// Write a doc and return its new etag. With `ifMatch`, only if the stored copy still has that
// etag; otherwise this throws ConflictError and the caller merges.
export async function writeDoc(key: string, data: unknown, ifMatch?: string): Promise<string> {
  count("writes");
  const text = seal(key, JSON.stringify(data));
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

// ---------------- Login attempts ----------------
// Failed logins in the last hour, counted for everyone together (an attacker can switch IPs), so
// password guessing stops after LOGIN_LIMIT failures. Each attempt is recorded before its password
// is checked, so guesses sent in parallel count too, and a successful one removes its record.
// While locked, even the right password is refused; signed-in devices keep their sessions.

export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW = 60 * 60 * 1000; // ms

export type LoginAttempt = { allowed: true; id: string } | { allowed: false; retryAfter: number };
type LocalAttempt = { id: string; at: number };

// Local attempts are read and rewritten as one file; this queue keeps parallel requests in order.
let localQueue: Promise<unknown> = Promise.resolve();
function withLocalAttempts<T>(fn: (attempts: LocalAttempt[]) => { attempts: LocalAttempt[]; result: T }): Promise<T> {
  const run = localQueue.then(async () => {
    const file = localPath("login-attempts.json");
    const saved: LocalAttempt[] = JSON.parse(await fs.readFile(file, "utf-8").catch(() => "[]"));
    const { attempts, result } = fn(saved);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(attempts), "utf-8");
    return result;
  });
  localQueue = run.catch(() => {});
  return run;
}

// Record an attempt and say whether it may go ahead. When locked, the attempt isn't kept, and
// `retryAfter` is the seconds until the oldest counted failure expires.
export async function beginLoginAttempt(): Promise<LoginAttempt> {
  const now = Date.now();
  const since = now - LOGIN_WINDOW;
  const verdict = (count: number, oldest: number, id: string): LoginAttempt =>
    count <= LOGIN_LIMIT ? { allowed: true, id } : { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest + LOGIN_WINDOW - now) / 1000)) };

  count("writes");
  if (!isStoreConfigured()) {
    return withLocalAttempts((saved) => {
      const recent = saved.filter((a) => a.at >= since);
      const id = randomBytes(8).toString("hex");
      const result = verdict(recent.length + 1, recent.length ? Math.min(...recent.map((a) => a.at)) : now, id);
      return { attempts: result.allowed ? [...recent, { id, at: now }] : recent, result };
    });
  }
  // One transaction: concurrent attempts each see the ones recorded before them.
  const c = await client();
  const [, inserted, counted] = await c.batch(
    [
      { sql: "DELETE FROM login_attempts WHERE at < ?", args: [since] },
      { sql: "INSERT INTO login_attempts (at) VALUES (?)", args: [now] },
      { sql: "SELECT COUNT(*) AS n, MIN(at) AS oldest FROM login_attempts WHERE at >= ?", args: [since] },
    ],
    "write"
  );
  const id = String(inserted.lastInsertRowid);
  const result = verdict(Number(counted.rows[0].n), Number(counted.rows[0].oldest), id);
  if (!result.allowed) await forgetLoginAttempt(id);
  return result;
}

// Remove an attempt's record, after it succeeded.
export async function forgetLoginAttempt(id: string): Promise<void> {
  count("writes");
  if (!isStoreConfigured()) {
    await withLocalAttempts((saved) => ({ attempts: saved.filter((a) => a.id !== id), result: undefined }));
    return;
  }
  await (await client()).execute({ sql: "DELETE FROM login_attempts WHERE id = ?", args: [Number(id)] });
}

// The single-file storage.json used before docs were split. Only the local fallback still has
// one; scripts/migrate-blob-to-turso.ts carries everything else over.
export async function readLegacyState(): Promise<unknown | null> {
  if (isStoreConfigured()) return null;
  const text = await fs.readFile(localPath("storage.json"), "utf-8").catch(() => null);
  return text === null ? null : JSON.parse(text);
}
