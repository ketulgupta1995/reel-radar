import { discover, genreList } from "@/lib/tmdb";
import { MediaType, Title } from "@/types/title";

export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const type = (p.get("type") as MediaType | "all") || "all";
    const page = Number(p.get("page") || 1);
    const genre = Number(p.get("genre")) || undefined;
    const region = p.get("region") || "all"; // 'all' | 'in' | 'global'

    const types: MediaType[] = type === "all" ? ["movie", "tv"] : [type];
    let results: Title[] = [];

    if (region === "in") {
      // Indian movies and series only
      results = (
        await Promise.all(
          types.map((t, i) =>
            discover(t, page + i, genre, { originCountry: "IN", minVotes: 8 })
          )
        )
      ).flat();
    } else if (region === "global") {
      // Hollywood / International
      results = (
        await Promise.all(types.map((t, i) => discover(t, page + i, genre)))
      ).flat();
    } else {
      // Blended feed: alternate Hollywood and Indian titles
      const [globalTitles, indianTitles] = await Promise.all([
        Promise.all(types.map((t, i) => discover(t, page + i, genre))).then((res) => res.flat()),
        Promise.all(
          types.map((t, i) =>
            discover(t, page + i, genre, { originCountry: "IN", minVotes: 8 })
          )
        ).then((res) => res.flat()),
      ]);

      const maxLen = Math.max(globalTitles.length, indianTitles.length);
      for (let i = 0; i < maxLen; i++) {
        if (globalTitles[i]) results.push(globalTitles[i]);
        if (indianTitles[i]) results.push(indianTitles[i]);
      }
    }

    return Response.json({
      results,
      genres: { movie: genreList("movie"), tv: genreList("tv") },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to load titles" },
      { status: 500 }
    );
  }
}