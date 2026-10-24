import { detail, discover, getRecommendations } from "@/lib/tmdb";
import { explanation, rankCategorized } from "@/lib/recommend";
import { Title, keyOf } from "@/types/title";

export async function POST(r: Request) {
  try {
    const {
      watched,
      seen = [],
      dismissed = [],
      watchlist = [],
    } = (await r.json()) as {
      watched: Title[];
      seen?: string[];
      dismissed?: string[];
      watchlist?: Title[];
    };

    if (!watched || watched.length < 10) {
      return Response.json({ error: "Select at least 10 titles." }, { status: 400 });
    }

    const rich = await Promise.all(
      watched.map((w) => detail(w.mediaType, w.id).catch(() => w))
    );

    const genreCount = new Map<number, number>();
    rich.forEach((t) => t.genres.forEach((g) => genreCount.set(g, (genreCount.get(g) || 0) + 1)));
    const topGenres = [...genreCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([g]) => g);

    // Fetch robust pools for both movies and TV in both Indian and Global regions
    const poolPromises: Promise<Title[]>[] = [
      discover("movie", 1),
      discover("movie", 2),
      discover("tv", 1),
      discover("tv", 2),
      discover("movie", 1, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("movie", 2, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("tv", 1, undefined, { originCountry: "IN", minVotes: 5 }),
      discover("tv", 2, undefined, { originCountry: "IN", minVotes: 5 }),
    ];

    for (const gid of topGenres) {
      poolPromises.push(discover("movie", 1, gid));
      poolPromises.push(discover("tv", 1, gid));
      poolPromises.push(discover("movie", 1, gid, { originCountry: "IN", minVotes: 10 }));
      poolPromises.push(discover("tv", 1, gid, { originCountry: "IN", minVotes: 5 }));
    }

    for (const w of rich.slice(0, 3)) {
      poolPromises.push(getRecommendations(w.mediaType, w.id));
    }

    const settled = await Promise.all(poolPromises);
    const candidateMap = new Map<string, Title>();
    settled.flat().forEach((c) => {
      const k = keyOf(c);
      if (!candidateMap.has(k)) candidateMap.set(k, c);
    });

    const candidates = Array.from(candidateMap.values());
    const categorized = rankCategorized(rich, candidates, seen, dismissed, watchlist, 15);

    const attachWhy = (items: Title[]) =>
      items.map((x) => ({
        ...x,
        why: explanation(x, rich),
      }));

    return Response.json({
      categories: {
        indianMovies: attachWhy(categorized.indianMovies),
        globalMovies: attachWhy(categorized.globalMovies),
        indianSeries: attachWhy(categorized.indianSeries),
        globalSeries: attachWhy(categorized.globalSeries),
      },
      summary: [...new Set(rich.flatMap((x) => x.genreNames || []))].slice(0, 4),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to generate recommendations" },
      { status: 500 }
    );
  }
}