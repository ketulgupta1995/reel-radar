import { Title, keyOf } from "@/types/title";
import { isIndianTitle } from "@/lib/region";

const frequencies = (
  items: Title[],
  pick: (t: Title) => (string | number)[],
  weights?: (t: Title) => number
) => {
  const m = new Map<string | number, number>();
  items.forEach((t) => {
    const w = weights ? weights(t) : 1;
    const values = pick(t);
    values.forEach((v) => {
      m.set(v, (m.get(v) || 0) + w / Math.max(values.length, 1));
    });
  });
  return m;
};

export type DiscoveryStyle = "balanced" | "popular" | "deepcuts";
export type MoodFilter = "all" | "dark" | "adrenaline" | "feelgood" | "mindbending";
export type EraFilter = "all" | "classic" | "modern" | "recent";

export type RankOptions = {
  discoveryStyle?: DiscoveryStyle;
  mood?: MoodFilter;
  era?: EraFilter;
  // Full metadata for titles the user marked "not interested"; used as a negative taste signal.
  dismissedTitles?: Title[];
};

// A dismissal is a weaker signal than actually watching something.
const DISMISS_STRENGTH = 0.5;

// Genre mapping for mood filtering
const MOOD_GENRES: Record<Exclude<MoodFilter, "all">, number[]> = {
  dark: [80, 9648, 27, 53], // Crime, Mystery, Horror, Thriller
  adrenaline: [28, 12, 10759], // Action, Adventure, Action & Adventure
  feelgood: [35, 16, 10749, 10751], // Comedy, Animation, Romance, Family
  mindbending: [878, 9648, 10765, 53], // Sci-Fi, Mystery, Sci-Fi & Fantasy, Thriller
};

export function matchesEra(year: number | null | undefined, era: EraFilter): boolean {
  if (!era || era === "all" || !year) return true;
  if (era === "classic") return year < 2005; // 70s, 80s, 90s, early 2000s
  if (era === "modern") return year >= 2005 && year < 2020; // 2005-2019
  if (era === "recent") return year >= 2020; // 2020+
  return true;
}

export function matchesMood(genres: number[] = [], mood: MoodFilter): boolean {
  if (!mood || mood === "all") return true;
  const targetIds = MOOD_GENRES[mood];
  if (!targetIds) return true;
  return genres.some((g) => targetIds.includes(g));
}

export function rank(
  watched: Title[],
  candidates: Title[],
  seen: string[] = [],
  dismissed: string[] = [],
  watchlist: (Title | string)[] = [],
  limit = 20,
  options: RankOptions = {}
): Title[] {
  if (!candidates.length) return [];

  const totalWatched = Math.max(watched.length, 1);
  const { discoveryStyle = "balanced", mood = "all", era = "all", dismissedTitles = [] } = options;

  // Compute doc frequency for genres across watched titles for TF-IDF style weighting
  const genreDocCount = new Map<number, number>();
  watched.forEach((t) => {
    new Set(t.genres || []).forEach((g) => {
      genreDocCount.set(g, (genreDocCount.get(g) || 0) + 1);
    });
  });

  // Smoothed IDF
  const genreIdf = new Map<number, number>();
  genreDocCount.forEach((count, g) => {
    const idf = Math.log(1 + (totalWatched - count + 0.5) / (count + 0.5)) + 1;
    genreIdf.set(g, idf);
  });

  // Recency & engagement weighting: titles toward the end of `watched` (most recently recorded)
  // receive up to +35% higher weighting in taste profile derivation.
  const itemWeight = (t: Title) => {
    let w = 1;
    const index = watched.findIndex((x) => keyOf(x) === keyOf(t));
    if (index !== -1) {
      const recencyBoost = 1 + (index / totalWatched) * 0.35; // 1.0 to 1.35
      w *= recencyBoost;
    }
    if (t.rating && t.rating >= 8.0) w *= 1.35;
    if (t.mediaType === "tv" && t.watchedSeasons && t.watchedSeasons.length > 0) {
      w *= 1 + Math.min(t.watchedSeasons.length * 0.25, 1.25);
    }
    return w;
  };

  const rawGenreFreq = frequencies(watched, (t) => t.genres, itemWeight);
  const gs = new Map<string | number, number>();
  rawGenreFreq.forEach((val, g) => {
    const idf = typeof g === "number" ? genreIdf.get(g) || 1 : 1;
    gs.set(g, val * idf);
  });

  const creators = frequencies(
    watched,
    (t) => (t.creators || []).map((p) => p.id),
    itemWeight
  );

  const cast = frequencies(
    watched,
    (t) => (t.cast || []).map((p) => p.id),
    itemWeight
  );

  const words = frequencies(watched, (t) => t.keywords || [], itemWeight);

  // Negative profile from "not interested" titles, rescaled to the watched profile's magnitude
  // so a few dismissals can't outweigh a large history.
  const negScale = dismissedTitles.length ? totalWatched / dismissedTitles.length : 0;
  const negative = (pick: (t: Title) => (string | number)[]) => {
    const m = frequencies(dismissedTitles, pick);
    m.forEach((v, k) => m.set(k, v * negScale));
    return m;
  };
  const negGenres = negative((t) => t.genres);
  const negPeople = negative((t) => [
    ...(t.creators || []).map((p) => p.id),
    ...(t.cast || []).map((p) => p.id),
  ]);
  const negWords = negative((t) => t.keywords || []);

  const indianWatchedCount = watched.filter(isIndianTitle).length;
  const indianAffinity = indianWatchedCount / totalWatched;
  const typeShare = watched.filter((x) => x.mediaType === "tv").length / totalWatched;

  const watchedKeys = new Set(watched.map(keyOf));
  const dismissedKeys = new Set(dismissed);
  const seenKeys = new Set(seen);
  const watchlistKeys = new Set(watchlist.map((w) => (typeof w === "string" ? w : keyOf(w))));

  const uniqueCandidates = new Map<string, Title>();
  candidates.forEach((c) => {
    const k = keyOf(c);
    if (!watchedKeys.has(k) && !dismissedKeys.has(k) && !watchlistKeys.has(k) && !uniqueCandidates.has(k)) {
      // Apply era and mood filters at candidate level
      if (matchesEra(c.year, era) && matchesMood(c.genres, mood)) {
        uniqueCandidates.set(k, c);
      }
    }
  });

  const scored: (Title & { _score: number })[] = Array.from(uniqueCandidates.values()).map((c) => {
    const isIndian = isIndianTitle(c);
    const genreScore = overlap(c.genres, gs);
    const directorScore = overlap((c.creators || []).map((p) => p.id), creators);
    const actorScore = overlap((c.cast || []).map((p) => p.id), cast);
    const keywordScore = overlap(c.keywords || [], words);
    const typeFit = 1 - Math.abs((c.mediaType === "tv" ? 1 : 0) - typeShare);
    const quality = Math.min(Math.max((c.rating - 5) / 5, 0), 1);
    
    // Discovery Style weighting:
    // - "popular": reward high TMDB popularity
    // - "deepcuts": penalize high popularity and reward high rating + lower vote count
    // - "balanced": slight popularity bonus
    let popMultiplier = 0.2;
    let qualityMultiplier = 1.2;

    if (discoveryStyle === "popular") {
      popMultiplier = 0.8;
      qualityMultiplier = 0.9;
    } else if (discoveryStyle === "deepcuts") {
      popMultiplier = -0.3; // actively penalizes oversaturated blockbusters
      qualityMultiplier = 2.0; // puts immense weight on quality rating
    }

    const popularityBonus = Math.min(Math.log10(Math.max(c.popularity, 1)) / 5, 0.4) * popMultiplier;

    let regionScore = 0.5;
    if (indianAffinity >= 0.2) {
      regionScore = isIndian ? 1.4 : 0.85;
    } else if (isIndian && c.rating >= 7.5) {
      regionScore = 0.95;
    }

    const dislike =
      dismissedTitles.length === 0
        ? 0
        : DISMISS_STRENGTH *
          (3.0 * overlap(c.genres, negGenres) +
            1.5 * overlap([...(c.creators || []), ...(c.cast || [])].map((p) => p.id), negPeople) +
            1.5 * overlap(c.keywords || [], negWords));

    const seenPenalty = seenKeys.has(keyOf(c)) ? 0.45 : 1.0;

    const rawScore =
      (4.0 * genreScore +
        2.6 * directorScore +
        1.8 * actorScore +
        2.0 * keywordScore +
        qualityMultiplier * quality +
        popularityBonus +
        0.4 * typeFit -
        dislike) *
      regionScore *
      seenPenalty;

    return { ...c, _score: rawScore };
  });

  function overlap(vs: (string | number)[], m: Map<string | number, number>) {
    if (!vs.length || !m.size) return 0;
    return vs.reduce((s: number, v) => s + (m.get(v) || 0), 0) / Math.max(vs.length, 1);
  }

  scored.sort((a, b) => b._score - a._score);

  const picked: (Title & { _score: number })[] = [];
  const genreCounts = new Map<number, number>();

  for (const x of scored) {
    if (picked.length >= limit) break;
    const overSaturated = x.genres.some((g) => (genreCounts.get(g) || 0) >= 5);
    if (overSaturated && scored.length - picked.length > 20) continue;
    picked.push(x);
    x.genres.forEach((g) => genreCounts.set(g, (genreCounts.get(g) || 0) + 1));
  }

  return picked.map(({ _score, ...x }) => x);
}

export type ThematicShelf = {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  items: Title[];
};

export type CategorizedRecommendations = {
  indianMovies: Title[];
  globalMovies: Title[];
  indianSeries: Title[];
  globalSeries: Title[];
  thematicShelves: ThematicShelf[];
};

export function rankCategorized(
  watched: Title[],
  candidates: Title[],
  seen: string[] = [],
  dismissed: string[] = [],
  watchlist: (Title | string)[] = [],
  limitPerCategory = 15,
  options: RankOptions = {}
): CategorizedRecommendations {
  const ranked = rank(watched, candidates, seen, dismissed, watchlist, 250, options);

  const buckets: CategorizedRecommendations = {
    indianMovies: [],
    globalMovies: [],
    indianSeries: [],
    globalSeries: [],
    thematicShelves: [],
  };

  for (const item of ranked) {
    const isIndian = isIndianTitle(item);
    const isTv = item.mediaType === "tv";

    if (isTv && isIndian && buckets.indianSeries.length < limitPerCategory) {
      buckets.indianSeries.push(item);
    } else if (isTv && !isIndian && buckets.globalSeries.length < limitPerCategory) {
      buckets.globalSeries.push(item);
    } else if (!isTv && isIndian && buckets.indianMovies.length < limitPerCategory) {
      buckets.indianMovies.push(item);
    } else if (!isTv && !isIndian && buckets.globalMovies.length < limitPerCategory) {
      buckets.globalMovies.push(item);
    }
  }

  // Build Thematic Shelves:
  // 1. "Critically Acclaimed Hidden Gems" (Rating >= 7.6)
  const gems = ranked
    .filter((t) => (t.rating || 0) >= 7.6 && (t.popularity || 0) < 65)
    .slice(0, 10);
  if (gems.length >= 3) {
    buckets.thematicShelves.push({
      id: "hidden-gems",
      title: "💎 Hidden Gems & Critical Acclaim",
      subtitle: "Highest rated titles with lower mainstream saturation.",
      badge: "Curated Gems",
      items: gems,
    });
  }

  // 2. "Mind-Bending & Thrilling" (Sci-Fi, Mystery, Crime, Thriller)
  const mindBending = ranked
    .filter((t) => matchesMood(t.genres, "mindbending"))
    .slice(0, 10);
  if (mindBending.length >= 3) {
    buckets.thematicShelves.push({
      id: "mind-bending",
      title: "🧠 Mind-Bending & High Intrigue",
      subtitle: "Complex narratives, mysteries, and speculative worlds.",
      badge: "Sci-Fi & Thriller",
      items: mindBending,
    });
  }

  // 3. "Classic Era Retrospective" (Pre-2010 titles)
  const vintage = ranked
    .filter((t) => (t.year || 0) > 1980 && (t.year || 0) < 2012 && (t.rating || 0) >= 7.4)
    .slice(0, 10);
  if (vintage.length >= 3) {
    buckets.thematicShelves.push({
      id: "classics-vault",
      title: "🏛️ Modern Classics & Nostalgia Vault",
      subtitle: "Celebrated releases from earlier eras that define your favorite genres.",
      badge: "Classic Era",
      items: vintage,
    });
  }

  return buckets;
}

export function explanation(candidate: Title, watched: Title[]): string {
  const isCandidateIndian = isIndianTitle(candidate);
  const matchedWatched = watched.find((w) => candidate.genres.some((g) => w.genres.includes(g)));
  const sharedPeople = [...(candidate.cast || []), ...(candidate.creators || [])].filter((p) =>
    watched.some((w) => [...(w.cast || []), ...(w.creators || [])].map((x) => x.id).includes(p.id))
  );

  if (sharedPeople.length > 0) {
    return `Features ${sharedPeople[0].name}, matching talent in your viewing history.`;
  }

  if (candidate.rating >= 7.8) {
    return `Critically acclaimed (${candidate.rating.toFixed(1)}/10) gem matching your genre frequency.`;
  }

  if (isCandidateIndian) {
    const indianWatched = watched.find(isIndianTitle);
    if (indianWatched) {
      return `Recommended Indian ${
        candidate.mediaType === "tv" ? "series" : "film"
      } pairing with your history of titles like "${indianWatched.title}".`;
    }
    return `Acclaimed Indian ${
      candidate.mediaType === "tv" ? "series" : "movie"
    } (${candidate.rating.toFixed(1)}) matching your taste.`;
  }

  const shared = candidate.genres.filter((g) => watched.some((w) => w.genres.includes(g)));
  const names = candidate.genreNames?.filter((_, i) => shared.includes(candidate.genres[i])) || [];
  if (names.length && matchedWatched) {
    return `Matches the ${names.slice(0, 2).join(" & ")} style from your viewing of "${matchedWatched.title}".`;
  }

  return "A high-affinity recommendation aligned with your viewing patterns.";
}