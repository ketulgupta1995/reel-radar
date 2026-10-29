import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";

// Server-only storage for synced docs: gzipped JSON in Vercel Blob, or plain JSON files in
// data/ when BLOB_READ_WRITE_TOKEN isn't set (local dev). Reads use get(), a simple operation,
// and never list(). With an etag an unchanged doc comes back as a body-less 304.

// Reel Radar's library and history, one doc per planner month, and the daily tasks.
export const DOC_KEY = /^(library|history|planner-daily|planner-\d{4}-\d{2})$/;

export type ReadResult = { etag: string; data: unknown } | { etag: string; unchanged: true } | null;

export class ConflictError extends Error {
  constructor() {
    super("The doc changed on the server");
  }
}

export const isBlobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const blobPath = (key: string) => `v2/${key}.json.gz`;
const localPath = (file: string) => path.join(process.cwd(), "data", file);
const etagOf = (text: string) => `"${createHash("sha1").update(text).digest("hex").slice(0, 16)}"`;

// A store is private or public, and get() addresses each on its own host, so a wrong guess just
// looks like a missing blob. Remember whichever answered for the life of this server instance.
let access: "private" | "public" | undefined;

// A failed read must surface as an error, never as "missing": the client would push over the doc.
async function blobGet(pathname: string, ifNoneMatch?: string) {
  const read = (a: "private" | "public") => get(pathname, { access: a, useCache: false, ifNoneMatch });
  if (access) return read(access);
  let privateError: unknown;
  try {
    const res = await read("private");
    if (res) {
      access = "private";
      return res;
    }
  } catch (err) {
    privateError = err ?? new Error("Blob read failed");
  }
  try {
    const res = await read("public");
    if (res) {
      access = "public";
      return res;
    }
  } catch (err) {
    if (privateError === undefined) return null; // private answered "missing"; public just doesn't exist
    throw err;
  }
  if (privateError !== undefined) throw privateError;
  return null;
}

async function blobPut(pathname: string, body: Buffer, ifMatch?: string) {
  const options = {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/gzip",
    cacheControlMaxAge: 60,
    ...(ifMatch ? { ifMatch } : {}),
  };
  try {
    return await put(pathname, body, { ...options, access: access ?? "private" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (access !== "public" && message.includes("Cannot use private access on a public store")) {
      access = "public";
      return put(pathname, body, { ...options, access });
    }
    throw err;
  }
}

export async function readDoc(key: string, ifNoneMatch?: string): Promise<ReadResult> {
  if (!isBlobConfigured()) {
    const text = await fs.readFile(localPath(`${key}.json`), "utf-8").catch(() => null);
    if (text === null) return null;
    const etag = etagOf(text);
    return etag === ifNoneMatch ? { etag, unchanged: true } : { etag, data: JSON.parse(text) };
  }
  const res = await blobGet(blobPath(key), ifNoneMatch);
  if (!res) return null;
  if (res.statusCode === 304) return { etag: res.blob.etag || ifNoneMatch || "", unchanged: true };
  const body = Buffer.from(await new Response(res.stream).arrayBuffer());
  return { etag: res.blob.etag, data: JSON.parse(gunzipSync(body).toString("utf-8")) };
}

// Write a doc and return its new etag. With `ifMatch`, only if the stored copy still has that
// etag; otherwise this throws ConflictError and the caller merges.
export async function writeDoc(key: string, data: unknown, ifMatch?: string): Promise<string> {
  const text = JSON.stringify(data);
  if (!isBlobConfigured()) {
    const file = localPath(`${key}.json`);
    if (ifMatch) {
      const current = await fs.readFile(file, "utf-8").catch(() => null);
      if (current === null || etagOf(current) !== ifMatch) throw new ConflictError();
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf-8");
    return etagOf(text);
  }
  try {
    return (await blobPut(blobPath(key), gzipSync(text), ifMatch)).etag;
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) throw new ConflictError();
    throw err;
  }
}

// The single-file storage.json used before docs were split. Read once, to migrate.
export async function readLegacyState(): Promise<unknown | null> {
  if (!isBlobConfigured()) {
    const text = await fs.readFile(localPath("storage.json"), "utf-8").catch(() => null);
    return text === null ? null : JSON.parse(text);
  }
  const res = await blobGet("storage.json");
  if (!res || res.statusCode === 304) return null;
  return JSON.parse(await new Response(res.stream).text());
}
