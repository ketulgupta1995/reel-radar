import { createClient, type Client } from "@libsql/client/web";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// Server-only storage for synced docs: one row per doc in a Turso (libSQL) table, or plain JSON
// files in data/ when TURSO_DATABASE_URL isn't set (local dev). A doc's etag is a hash of its
// JSON, kept in its own column so an unchanged doc is answered without reading its body.

// Reel Radar's library and history, one doc per planner month, and the daily tasks.
export const DOC_KEY = /^(library|history|planner-daily|planner-\d{4}-\d{2})$/;

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
    await c.execute("CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, data TEXT NOT NULL, etag TEXT NOT NULL)");
    return c;
  })().catch((err) => {
    db = undefined;
    throw err;
  });
  return db;
}

export async function readDoc(key: string, ifNoneMatch?: string): Promise<ReadResult> {
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
