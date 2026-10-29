import { ConflictError, DOC_KEY, ReadResult, flushUsage, readDoc, readLegacyState, writeDoc } from "@/lib/docStore";
import { empty, historyOf, libraryOf, toStored } from "@/lib/syncDocs";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const noStore = { "Cache-Control": "no-store" };
const MAX_KEYS = 40;

// Split the old single-file storage.json into the library and history docs, once.
async function migrateLegacy(docs: Record<string, ReadResult>) {
  const legacy = await readLegacyState();
  if (!legacy || typeof legacy !== "object") return;
  const state = { ...empty(), ...legacy };
  const library = libraryOf({ ...state, watched: state.watched.map(toStored), watchlist: state.watchlist.map(toStored) });
  docs.library = { etag: await writeDoc("library", library), data: library };
  const history = "history" in docs ? docs.history : await readDoc("history");
  if (history === null) {
    const data = historyOf(state);
    const etag = await writeDoc("history", data);
    if ("history" in docs) docs.history = { etag, data };
  }
}

// GET /api/sync?keys=library:<etag>,history:<etag>,planner-2026-10
// Reads several docs in one call. A key sent with the etag the client holds comes back as
// { etag, unchanged: true } when nothing changed; a doc that doesn't exist yet is null.
export async function GET(req: Request) {
  const wanted = (new URL(req.url).searchParams.get("keys") || "")
    .split(",")
    .filter(Boolean)
    .map((part): [string, string | undefined] => {
      const i = part.indexOf(":");
      return i < 0 ? [part, undefined] : [part.slice(0, i), part.slice(i + 1) || undefined];
    });
  if (!wanted.length || wanted.length > MAX_KEYS || wanted.some(([k]) => !DOC_KEY.test(k))) {
    return Response.json({ error: "Invalid keys" }, { status: 400 });
  }

  try {
    const docs: Record<string, ReadResult> = {};
    // The first read settles whether the store is private or public; the rest run in parallel.
    const [[firstKey, firstEtag], ...rest] = wanted;
    docs[firstKey] = await readDoc(firstKey, firstEtag);
    await Promise.all(
      rest.map(async ([k, etag]) => {
        docs[k] = await readDoc(k, etag);
      })
    );
    if (docs.library === null) await migrateLegacy(docs);
    return Response.json({ docs }, { headers: noStore });
  } catch (err) {
    console.error("[Sync API] Read failed", err);
    return Response.json({ error: "Failed to read storage" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage();
  }
}

// POST /api/sync { key, data, baseEtag }
// Writes one doc if the stored copy still has `baseEtag`. Otherwise answers 409 with the current
// copy ({ etag, data }, or nulls if it's gone) so the client can merge and retry.
export async function POST(req: Request) {
  const { key, data, baseEtag } = await req.json().catch(() => ({}));
  if (typeof key !== "string" || !DOC_KEY.test(key) || !data || typeof data !== "object") {
    return Response.json({ error: "Invalid doc" }, { status: 400 });
  }

  try {
    const etag = await writeDoc(key, data, typeof baseEtag === "string" && baseEtag ? baseEtag : undefined);
    return Response.json({ etag }, { headers: noStore });
  } catch (err) {
    if (err instanceof ConflictError) {
      const current = await readDoc(key).catch(() => null);
      return Response.json(current && "data" in current ? current : { etag: null, data: null }, {
        status: 409,
        headers: noStore,
      });
    }
    console.error(`[Sync API] Write failed for ${key}`, err);
    return Response.json({ error: "Failed to save storage" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage(true); // writes are rare; save the counts with them
  }
}
