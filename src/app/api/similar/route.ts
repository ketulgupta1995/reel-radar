import { getSimilar } from "@/lib/tmdb";
import { MediaType } from "@/types/title";

export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const type = p.get("type") as MediaType;
    const id = Number(p.get("id"));

    if (!id || !["movie", "tv"].includes(type)) {
      return Response.json({ error: "Invalid title" }, { status: 400 });
    }

    const minYearParam = p.get("minYear");
    // Default to 1990 (post-1990 filter). If explicitly "all" or "0", disable year threshold.
    const minYear =
      minYearParam === "all" || minYearParam === "0"
        ? 0
        : minYearParam !== null
        ? Number(minYearParam)
        : 1990;

    const maxYearParam = p.get("maxYear");
    const maxYear = maxYearParam ? Number(maxYearParam) : undefined;

    const limitParam = p.get("limit");
    const limit = limitParam ? Number(limitParam) : 24;

    const results = await getSimilar(type, id, {
      minYear,
      maxYear,
      limit,
    });

    return Response.json({ results });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to find similar titles" },
      { status: 500 }
    );
  }
}