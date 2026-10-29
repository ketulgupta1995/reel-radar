import { search } from "@/lib/tmdb";
import { HOUR, cachedJson } from "@/lib/http";

export const maxDuration = 10;

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query");
    if (!query) return Response.json({ results: [] });
    return cachedJson({ results: await search(query) }, HOUR);
  } catch (e) {
    return Response.json({ error: "Failed to search titles" }, { status: 500 });
  }
}