import { detail, discover, getRecommendations } from "@/lib/tmdb";
import { explanation, rank } from "@/lib/recommend";
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

    // Hydrate watched titles with credits and keywords
    const rich = await Promise.all(
      watched.map((w) => detail(w.mediaType, w.id).catch(() => w))
    );

    // Identify user's top genres
    const genreCount = new Map<number, number>();
    rich.forEach((t) => t.genres.forEach((g) => genreCount.set(g, (genreCount.get(g) || 0) + 1)));
    const topGenres = [...genreCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([g]) => g);

    // Build multi-source candidate pools (Hollywood + Indian Cinema & Series)
    const poolPromises: Promise<Title[]>[] = [
      // 1. Global / Hollywood titles
      discover("movie", 1),
      discover("movie", 2),
      discover("tv", 1),
      discover("tv", 2),

      // 2. Indian Movies (Bollywood, South Indian & regional)
      discover("movie", 1, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("movie", 2, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("movie", 1, undefined, {
        originCountry: "IN",
        sortBy: "vote_average.desc",
        minVotes: 25,
      }),

      // 3. Indian TV Series & Web Shows
      discover("tv", 1, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("tv", 2, undefined, { originCountry: "IN", minVotes: 10 }),
    ];

    // 4. Genre-targeted pools (both global and Indian)
    for (const gid of topGenres) {
      poolPromises.push(discover("movie", 1, gid));
      poolPromises.push(discover("tv", 1, gid));
      poolPromises.push(discover("movie", 1, gid, { originCountry: "IN", minVotes: 10 }));
    }

    // 5. TMDB recommendations for top 3 watched titles
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
    const ranked = rank(rich, candidates, seen, dismissed, watchlist);
    const recs = ranked.map((x) => ({
      ...x,
      why: explanation(x, rich),
    }));

    return Response.json({
      recommendations: recs,
      summary: [...new Set(rich.flatMap((x) => x.genreNames || []))].slice(0, 4),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to generate recommendations" },
      { status: 500 }
    );
  }
}