import { discover, genreList } from "@/lib/tmdb";
import { MediaType, Title } from "@/types/title";
import { HOUR, cachedJson } from "@/lib/http";

export const maxDuration = 10;

export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const type = (p.get("type") as MediaType | "all") || "all";
    const page = Number(p.get("page") || 1);
    const genre = Number(p.get("genre")) || undefined;
    const region = p.get("region") || "all";

    const types: MediaType[] = type === "all" ? ["movie", "tv"] : [type];
    let results: Title[] = [];

    const indianOptions = (t: MediaType) => ({
      originCountry: "IN",
      minVotes: t === "tv" ? 2 : 5, // Indian TV shows have far fewer TMDB votes
    });

    if (region === "in") {
      results = (
        await Promise.all(
          types.map((t) => discover(t, page, genre, indianOptions(t)))
        )
      ).flat();
    } else if (region === "global") {
      results = (
        await Promise.all(types.map((t) => discover(t, page, genre)))
      ).flat();
    } else {
      // Blended feed: alternate global and Indian titles
      const [globalTitles, indianTitles] = await Promise.all([
        Promise.all(types.map((t) => discover(t, page, genre))).then((res) => res.flat()),
        Promise.all(
          types.map((t) => discover(t, page, genre, indianOptions(t)))
        ).then((res) => res.flat()),
      ]);

      const maxLen = Math.max(globalTitles.length, indianTitles.length);
      for (let i = 0; i < maxLen; i++) {
        if (globalTitles[i]) results.push(globalTitles[i]);
        if (indianTitles[i]) results.push(indianTitles[i]);
      }
    }

    return cachedJson(
      { results, genres: { movie: genreList("movie"), tv: genreList("tv") } },
      HOUR
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to load titles" },
      { status: 500 }
    );
  }
}