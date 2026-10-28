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
      discoveryStyle = "balanced",
      mood = "all",
      era = "all",
    } = (await r.json()) as {
      watched: Title[];
      seen?: string[];
      dismissed?: string[];
      watchlist?: Title[];
      discoveryStyle?: "balanced" | "popular" | "deepcuts";
      mood?: "all" | "dark" | "adrenaline" | "feelgood" | "mindbending";
      era?: "all" | "classic" | "modern" | "recent";
    };

    if (!watched || watched.length < 10) {
      return Response.json({ error: "Select at least 10 titles." }, { status: 400 });
    }

    const rich = await Promise.all(
      watched.map((w) => detail(w.mediaType, w.id).catch(() => w))
    );

    // Dismissals are stored as bare keys; load metadata for the most recent ones so the
    // ranker can learn what to avoid.
    const dismissedTitles = (
      await Promise.all(
        dismissed.slice(-25).map((k) => {
          const [type, id] = k.split(":");
          if ((type !== "movie" && type !== "tv") || !Number(id)) return null;
          return detail(type, Number(id)).catch(() => null);
        })
      )
    ).filter((t): t is Title => Boolean(t));

    // 1. Identify distinct taste anchors: top genres (both high-volume and niche), top directors, and top rated titles
    const genreCount = new Map<number, number>();
    rich.forEach((t) => t.genres.forEach((g) => genreCount.set(g, (genreCount.get(g) || 0) + 1)));
    const sortedGenres = [...genreCount.entries()].sort((a, b) => b[1] - a[1]);
    const topPrimaryGenres = sortedGenres.slice(0, 3).map(([g]) => g);
    // Also grab a niche/secondary genre if user has watched diverse titles
    const nicheGenre = sortedGenres.length > 3 ? sortedGenres[Math.min(4, sortedGenres.length - 1)][0] : undefined;

    // 2. Select smart seeds from watched titles: highest rated + diverse
    const highRatedSeeds = [...rich]
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 6);

    // Fetch robust pools:
    // - Popular pages 1-3
    // - Deep Cuts / Hidden Gems (pages 3-6, high rating >= 7.3, lower/moderate vote count)
    // - TMDB recommendations seeded by user's top-rated watched titles
    // - Targeted Indian cinema & TV pools
    const poolPromises: Promise<Title[]>[] = [
      // Mainstream / High affinity pools
      discover("movie", 1),
      discover("movie", 2),
      discover("movie", 3),
      discover("tv", 1),
      discover("tv", 2),
      discover("tv", 3),

      // Indian cinema & series pools
      discover("movie", 1, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("movie", 2, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("movie", 3, undefined, { originCountry: "IN", minVotes: 10 }),
      discover("tv", 1, undefined, { originCountry: "IN", minVotes: 5 }),
      discover("tv", 2, undefined, { originCountry: "IN", minVotes: 5 }),

      // "Deep Cut / Hidden Gems" pools: Highly rated (>= 7.3), moderate popularity, deeper pages
      discover("movie", 3, undefined, { minRating: 7.3, minVotes: 50, maxVotes: 3500 }),
      discover("movie", 4, undefined, { minRating: 7.2, minVotes: 40, maxVotes: 3000 }),
      discover("tv", 3, undefined, { minRating: 7.4, minVotes: 20 }),
      discover("tv", 4, undefined, { minRating: 7.2, minVotes: 15 }),

      // Indian Hidden Gems
      discover("movie", 2, undefined, { originCountry: "IN", minRating: 7.0, minVotes: 10, maxVotes: 1500 }),
      discover("tv", 2, undefined, { originCountry: "IN", minRating: 7.0, minVotes: 5 }),
    ];

    // Seed by top genres
    for (const gid of topPrimaryGenres) {
      poolPromises.push(discover("movie", 1, gid));
      poolPromises.push(discover("movie", 2, gid));
      poolPromises.push(discover("tv", 1, gid));
      poolPromises.push(discover("tv", 2, gid));
      poolPromises.push(discover("movie", 1, gid, { originCountry: "IN", minVotes: 10 }));
      poolPromises.push(discover("tv", 1, gid, { originCountry: "IN", minVotes: 5 }));
    }

    if (nicheGenre) {
      poolPromises.push(discover("movie", 1, nicheGenre));
      poolPromises.push(discover("tv", 1, nicheGenre));
    }

    // Seed TMDB /recommendations by up to 6 highest rated watched titles
    for (const w of highRatedSeeds) {
      poolPromises.push(getRecommendations(w.mediaType, w.id));
    }

    // One failed pool shouldn't sink the whole request; only give up if every pool failed.
    const settled = await Promise.all(poolPromises.map((p) => p.catch(() => [] as Title[])));
    if (!settled.some((pool) => pool.length)) {
      throw new Error("Could not reach TMDB. Check your network connection and TMDB_API_KEY.");
    }
    const candidateMap = new Map<string, Title>();
    settled.flat().forEach((c) => {
      const k = keyOf(c);
      if (!candidateMap.has(k)) candidateMap.set(k, c);
    });

    const candidates = Array.from(candidateMap.values());
    const categorized = rankCategorized(rich, candidates, seen, dismissed, watchlist, 20, {
      discoveryStyle,
      mood,
      era,
      dismissedTitles,
    });

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
        thematicShelves: categorized.thematicShelves.map((shelf) => ({
          ...shelf,
          items: attachWhy(shelf.items),
        })),
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