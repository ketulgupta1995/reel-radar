import { put, list } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const STORAGE_PATH = "storage.json";
const localDataDir = path.join(process.cwd(), "data");
const localFilePath = path.join(localDataDir, "storage.json");

const isBlobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function ensureLocalFile() {
  await fs.mkdir(localDataDir, { recursive: true });
  try {
    await fs.access(localFilePath);
  } catch {
    const initial = {
      watched: [],
      displayed: [],
      shown: [],
      watchlist: [],
      dismissed: [],
    };
    await fs.writeFile(localFilePath, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function readLocalFile() {
  await ensureLocalFile();
  const content = await fs.readFile(localFilePath, "utf-8");
  return JSON.parse(content || "{}");
}

async function writeLocalFile(body: unknown) {
  await ensureLocalFile();
  await fs.writeFile(localFilePath, JSON.stringify(body, null, 2), "utf-8");
}

export async function GET() {
  // Scenario 1: Token is missing
  if (!isBlobConfigured) {
    console.warn(
      "\x1b[33m[Storage API] ⚠️ BLOB_READ_WRITE_TOKEN is not set. Vercel Blob is inactive — reading from local filesystem (data/storage.json).\x1b[0m"
    );
    try {
      const data = await readLocalFile();
      return Response.json(data, {
        headers: { "x-storage-backend": "local-file" },
      });
    } catch {
      return Response.json({ error: "Failed to read local storage" }, { status: 500 });
    }
  }

  // Scenario 2: Token is configured, attempt Vercel Blob read
  try {
    const { blobs } = await list({ prefix: STORAGE_PATH });
    const target = blobs.find((b) => b.pathname === STORAGE_PATH);

    if (!target) {
      console.info(
        "\x1b[32m[Storage API] ☁️ Vercel Blob active, but storage.json does not exist yet. Returning empty initial state.\x1b[0m"
      );
      return Response.json(
        { watched: [], displayed: [], shown: [], watchlist: [], dismissed: [] },
        { headers: { "x-storage-backend": "vercel-blob" } }
      );
    }

    const res = await fetch(`${target.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Blob fetch failed (${res.status})`);

    const data = await res.json();
    console.info("\x1b[32m[Storage API] ☁️ Successfully read from Vercel Blob storage.\x1b[0m");
    return Response.json(data, {
      headers: { "x-storage-backend": "vercel-blob" },
    });
  } catch (error) {
    // Scenario 3: Token set, but Blob request failed (network, invalid token, quota)
    console.error(
      "\x1b[31m[Storage API] ❌ Vercel Blob request failed! Falling back to local storage (data/storage.json).\x1b[0m",
      error
    );
    try {
      const data = await readLocalFile();
      return Response.json(data, {
        headers: { "x-storage-backend": "local-file-fallback" },
      });
    } catch {
      return Response.json({ error: "Failed to read storage" }, { status: 500 });
    }
  }
}

export async function POST(req: Request) {
  const body = await req.json();

  if (!isBlobConfigured) {
    console.warn(
      "\x1b[33m[Storage API] ⚠️ BLOB_READ_WRITE_TOKEN is not set. Saving data to local filesystem (data/storage.json).\x1b[0m"
    );
    try {
      await writeLocalFile(body);
      return Response.json(
        { success: true },
        { headers: { "x-storage-backend": "local-file" } }
      );
    } catch {
      return Response.json({ error: "Failed to save local storage" }, { status: 500 });
    }
  }

  try {
    await put(STORAGE_PATH, JSON.stringify(body, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
    console.info("\x1b[32m[Storage API] ☁️ Successfully saved state to Vercel Blob.\x1b[0m");
    return Response.json(
      { success: true },
      { headers: { "x-storage-backend": "vercel-blob" } }
    );
  } catch (error) {
    console.error(
      "\x1b[31m[Storage API] ❌ Vercel Blob write failed! Saving to local filesystem (data/storage.json) instead.\x1b[0m",
      error
    );
    try {
      await writeLocalFile(body);
      return Response.json(
        { success: true, fallback: true },
        { headers: { "x-storage-backend": "local-file-fallback" } }
      );
    } catch {
      return Response.json({ error: "Failed to save storage" }, { status: 500 });
    }
  }
}