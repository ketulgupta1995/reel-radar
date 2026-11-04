import { personCredits } from "@/lib/tmdb";
import { DETAIL_MAX_AGE, cachedJson } from "@/lib/http";

export const maxDuration = 10;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await params).id);
    if (!id) return Response.json({ error: "Invalid person ID" }, { status: 400 });
    return cachedJson(await personCredits(id), DETAIL_MAX_AGE);
  } catch (e) {
    return Response.json({ error: "Failed to fetch person data" }, { status: 500 });
  }
}