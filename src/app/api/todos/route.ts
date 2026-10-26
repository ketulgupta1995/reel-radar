import { put, list } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const TODO_STORAGE_PREFIX = "reel-radar-todos-";
const localDataDir = path.join(process.cwd(), "data");

const isBlobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function ensureLocalFile(date: string) {
  const localFilePath = path.join(localDataDir, `${TODO_STORAGE_PREFIX}${date}.json`);
  await fs.mkdir(localDataDir, { recursive: true });
  try {
    await fs.access(localFilePath);
  } catch {
    await fs.writeFile(localFilePath, JSON.stringify([], null, 2), "utf-8");
  }
  return localFilePath;
}

async function readLocalFile(date: string) {
  const localFilePath = await ensureLocalFile(date);
  const content = await fs.readFile(localFilePath, "utf-8");
  return JSON.parse(content || "[]");
}

async function writeLocalFile(date: string, body: unknown) {
  const localFilePath = await ensureLocalFile(date);
  await fs.writeFile(localFilePath, JSON.stringify(body, null, 2), "utf-8");
}

function getBlobPath(date: string): string {
  return `todos/${TODO_STORAGE_PREFIX}${date}.json`;
}

async function uploadToBlob(pathname: string, data: string) {
  try {
    return await put(pathname, data, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Cannot use private access on a public store")) {
      return await put(pathname, data, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
      });
    }
    throw err;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Invalid date parameter" }, { status: 400 });
  }

  if (!isBlobConfigured) {
    console.warn(
      `\x1b[33m[Todos API] ⚠️ BLOB_READ_WRITE_TOKEN is not set. Reading from local filesystem (data/${TODO_STORAGE_PREFIX}${date}.json).\x1b[0m`
    );
    try {
      const data = await readLocalFile(date);
      return Response.json({ date, todos: data }, {
        headers: { "x-storage-backend": "local-file" },
      });
    } catch {
      return Response.json({ error: "Failed to read local storage" }, { status: 500 });
    }
  }

  try {
    const blobPath = getBlobPath(date);
    const { blobs } = await list({ prefix: blobPath });
    const target = blobs.find((b) => b.pathname === blobPath);

    if (!target) {
      console.info(
        `\x1b[32m[Todos API] ☁️ Vercel Blob active, but ${blobPath} does not exist yet. Returning empty initial state.\x1b[0m`
      );
      return Response.json(
        { date, todos: [] },
        { headers: { "x-storage-backend": "vercel-blob" } }
      );
    }

    const fetchHeaders: HeadersInit = {};
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      fetchHeaders["Authorization"] = `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`;
    }

    const res = await fetch(`${target.url}?t=${Date.now()}`, {
      headers: fetchHeaders,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Blob fetch failed (${res.status} ${res.statusText})`);
    }

    const data = await res.json();
    console.info(`\x1b[32m[Todos API] ☁️ Successfully read todos for ${date} from Vercel Blob storage.\x1b[0m`);
    return Response.json({ date, todos: data }, {
      headers: { "x-storage-backend": "vercel-blob" },
    });
  } catch (error) {
    console.error(
      `\x1b[31m[Todos API] ❌ Vercel Blob read failed for ${date}! Falling back to local storage.\x1b[0m`,
      error
    );
    try {
      const data = await readLocalFile(date);
      return Response.json({ date, todos: data }, {
        headers: { "x-storage-backend": "local-file-fallback" },
      });
    } catch {
      return Response.json({ error: "Failed to read storage" }, { status: 500 });
    }
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { date, todos } = body;
  
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Invalid date parameter" }, { status: 400 });
  }
  
  if (!Array.isArray(todos)) {
    return Response.json({ error: "Todos must be an array" }, { status: 400 });
  }

  if (!isBlobConfigured) {
    console.warn(
      `\x1b[33m[Todos API] ⚠️ BLOB_READ_WRITE_TOKEN is not set. Saving todos for ${date} to local filesystem.\x1b[0m`
    );
    try {
      await writeLocalFile(date, todos);
      return Response.json(
        { success: true },
        { headers: { "x-storage-backend": "local-file" } }
      );
    } catch {
      return Response.json({ error: "Failed to save local storage" }, { status: 500 });
    }
  }

  try {
    const blobPath = getBlobPath(date);
    const payload = JSON.stringify(todos, null, 2);
    await uploadToBlob(blobPath, payload);

    console.info(`\x1b[32m[Todos API] ☁️ Successfully saved todos for ${date} to Vercel Blob.\x1b[0m`);
    return Response.json(
      { success: true },
      { headers: { "x-storage-backend": "vercel-blob" } }
    );
  } catch (error) {
    console.error(
      `\x1b[31m[Todos API] ❌ Vercel Blob write failed for ${date}! Saving to local filesystem instead.\x1b[0m`,
      error
    );
    try {
      await writeLocalFile(date, todos);
      return Response.json(
        { success: true, fallback: true },
        { headers: { "x-storage-backend": "local-file-fallback" } }
      );
    } catch {
      return Response.json({ error: "Failed to save storage" }, { status: 500 });
    }
  }
}