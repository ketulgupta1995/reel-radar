import { search } from "@/lib/tmdb";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query");
    if (!query) return Response.json({ results: [] });
    return Response.json({ results: await search(query) });
  } catch (e) {
    return Response.json({ error: "Failed to search titles" }, { status: 500 });
  }
}