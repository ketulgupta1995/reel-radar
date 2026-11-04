import { revalidateTag } from "next/cache";
import { LIST_TAG, detailTag } from "@/lib/tmdb";

export const maxDuration = 10;

const validId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0;

// POST /api/tmdb/refresh { person?: number, title?: { type: "movie" | "tv", id: number } }
// Expires the server's cached TMDB lists, plus the one person or title named, so the next read
// waits for TMDB. Other details stay cached: expiring them all would mean hundreds of TMDB calls
// on the next recommendations request.
export async function POST(req: Request) {
  const { person, title } = await req.json().catch(() => ({}));
  if (person !== undefined && !validId(person)) return Response.json({ error: "Invalid person" }, { status: 400 });
  if (title !== undefined && (!["movie", "tv"].includes(title?.type) || !validId(title?.id))) {
    return Response.json({ error: "Invalid title" }, { status: 400 });
  }
  revalidateTag(LIST_TAG, { expire: 0 });
  if (person) revalidateTag(detailTag("person", person), { expire: 0 });
  if (title) revalidateTag(detailTag(title.type, title.id), { expire: 0 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
