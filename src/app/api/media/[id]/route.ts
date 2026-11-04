import { deleteDoc, flushUsage, readDoc, writeDoc } from "@/lib/docStore";
import { MAX_MEDIA_BYTES, MEDIA_ID, MEDIA_TYPES, baseMime } from "@/lib/media";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// A photo or voice note attached to a list item, stored as the doc "media-<id>" holding
// { mime, data } (data in base64). Ids are random and a file is never rewritten, so a device
// caches it for good and reads it from the database at most once.

type Stored = { mime: string; data: string };
type Params = { params: Promise<{ id: string }> };

const noStore = { "Cache-Control": "no-store" };
const keyOf = async (params: Params["params"]) => {
  const { id } = await params;
  return MEDIA_ID.test(id) ? `media-${id}` : null;
};
const invalid = () => Response.json({ error: "Invalid media id" }, { status: 400, headers: noStore });

export async function GET(_req: Request, { params }: Params) {
  const key = await keyOf(params);
  if (!key) return invalid();
  try {
    const doc = await readDoc(key);
    const stored = doc && "data" in doc ? (doc.data as Stored) : null;
    if (!stored || !MEDIA_TYPES[stored.mime]) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
    return new Response(Buffer.from(stored.data, "base64"), {
      headers: {
        "Content-Type": stored.mime,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error(`[Media API] Read failed for ${key}`, err);
    return Response.json({ error: "Failed to read media" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage();
  }
}

// PUT /api/media/<id> with the file as the body and its type as Content-Type.
export async function PUT(req: Request, { params }: Params) {
  const key = await keyOf(params);
  if (!key) return invalid();
  const mime = baseMime(req.headers.get("content-type") || "");
  if (!MEDIA_TYPES[mime]) return Response.json({ error: "Unsupported type" }, { status: 415, headers: noStore });
  if (Number(req.headers.get("content-length") || 0) > MAX_MEDIA_BYTES) {
    return Response.json({ error: "Too large" }, { status: 413, headers: noStore });
  }
  const bytes = Buffer.from(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!bytes.length) return Response.json({ error: "Empty file" }, { status: 400, headers: noStore });
  if (bytes.length > MAX_MEDIA_BYTES) return Response.json({ error: "Too large" }, { status: 413, headers: noStore });

  try {
    await writeDoc(key, { mime, data: bytes.toString("base64") } satisfies Stored);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (err) {
    console.error(`[Media API] Write failed for ${key}`, err);
    return Response.json({ error: "Failed to save media" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage(true);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const key = await keyOf(params);
  if (!key) return invalid();
  try {
    await deleteDoc(key);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (err) {
    console.error(`[Media API] Delete failed for ${key}`, err);
    return Response.json({ error: "Failed to delete media" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage(true);
  }
}
