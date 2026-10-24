import { Title, MediaType } from "@/types/title";
import { isIndianTitle } from "@/lib/recommend";

export type AnalysisFilters = {
  mediaType: "all" | MediaType;
  region: "all" | "in" | "global";
};

export type GenreStat = {
  name: string;
  count: number;
  percentage: number;
};

export type EraStat = {
  label: string;
  count: number;
  percentage: number;
};

export type RatingBucket = {
  range: string;
  count: number;
  percentage: number;
};

export type SeriesProgressItem = {
  id: number;
  title: string;
  watchedCount: number;
  totalCount: number | null;
  percentage: number;
  isComplete: boolean;
};

export type PersonaAnalysis = {
  title: string;
  badge: string;
  description: string;
  traits: string[];
};

export type AnalysisResult = {
  totalAnalyzed: number;
  movieCount: number;
  tvCount: number;
  averageRating: number;
  highRatedCount: number; // TMDB rating >= 8.0
  indianCount: number;
  globalCount: number;
  indianPercentage: number;
  globalPercentage: number;
  watchlistCount: number;
  backlogRatio: number; // Watchlist / (Watched + Watchlist)
  topGenres: GenreStat[];
  eraDistribution: EraStat[];
  ratingDistribution: RatingBucket[];
  popularityBreakdown: {
    hiddenGems: number; // rating >= 7.5 && popularity < 35
    blockbusters: number; // rating >= 7.0 && popularity >= 35
    popcornEntertainment: number; // rating < 7.0 && popularity >= 35
    nicheIndies: number; // rating < 7.0 && popularity < 35
  };
  tvSeriesProgress: {
    totalSeries: number;
    completedSeries: number;
    inProgressSeries: number;
    totalSeasonsWatched: number;
    overallCompletionRate: number;
    items: SeriesProgressItem[];
  };
  languages: { code: string; count: number; name: string }[];
  persona: PersonaAnalysis;
  topRatedTitles: Title[];
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  ml: "Malayalam",
  kn: "Kannada",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  zh: "Chinese",
};

export function filterWatchedTitles(titles: Title[], filters: AnalysisFilters): Title[] {
  return titles.filter((t) => {
    if (filters.mediaType !== "all" && t.mediaType !== filters.mediaType) {
      return false;
    }
    const isIndian = isIndianTitle(t);
    if (filters.region === "in" && !isIndian) return false;
    if (filters.region === "global" && isIndian) return false;
    return true;
  });
}

export function computeAnalysis(
  watched: Title[],
  watchlist: Title[],
  filters: AnalysisFilters
): AnalysisResult {
  const dataset = filterWatchedTitles(watched, filters);
  const totalAnalyzed = dataset.length;

  if (totalAnalyzed === 0) {
    return {
      totalAnalyzed: 0,
      movieCount: 0,
      tvCount: 0,
      averageRating: 0,
      highRatedCount: 0,
      indianCount: 0,
      globalCount: 0,
      indianPercentage: 0,
      globalPercentage: 0,
      watchlistCount: watchlist.length,
      backlogRatio: 0,
      topGenres: [],
      eraDistribution: [],
      ratingDistribution: [],
      popularityBreakdown: { hiddenGems: 0, blockbusters: 0, popcornEntertainment: 0, nicheIndies: 0 },
      tvSeriesProgress: {
        totalSeries: 0,
        completedSeries: 0,
        inProgressSeries: 0,
        totalSeasonsWatched: 0,
        overallCompletionRate: 0,
        items: [],
      },
      languages: [],
      persona: {
        title: "The Aspiring Spectator",
        badge: "New Explorer",
        description: "Your viewing library is just getting started. Add more movies and series to reveal your cinematic taste fingerprint.",
        traits: ["Library Initializing", "Awaiting Inputs"],
      },
      topRatedTitles: [],
    };
  }

  // 1. Media Type Counts
  const movieCount = dataset.filter((t) => t.mediaType === "movie").length;
  const tvCount = dataset.filter((t) => t.mediaType === "tv").length;

  // 2. Ratings & Quality calibration
  const ratingSum = dataset.reduce((acc, t) => acc + (t.rating || 0), 0);
  const averageRating = totalAnalyzed > 0 ? Number((ratingSum / totalAnalyzed).toFixed(1)) : 0;
  const highRatedCount = dataset.filter((t) => t.rating >= 8.0).length;

  // 3. Regional affinity
  const indianCount = dataset.filter(isIndianTitle).length;
  const globalCount = totalAnalyzed - indianCount;
  const indianPercentage = Math.round((indianCount / totalAnalyzed) * 100);
  const globalPercentage = 100 - indianPercentage;

  // 4. Backlog health
  const totalVault = totalAnalyzed + watchlist.length;
  const backlogRatio = totalVault > 0 ? Math.round((watchlist.length / totalVault) * 100) : 0;

  // 5. Genre frequency breakdown
  const genreTally: Record<string, number> = {};
  dataset.forEach((t) => {
    (t.genreNames || []).forEach((name) => {
      genreTally[name] = (genreTally[name] || 0) + 1;
    });
  });

  const sortedGenres = Object.entries(genreTally)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      name,
      count,
      percentage: Math.round((count / totalAnalyzed) * 100),
    }));

  // 6. Era / Decade distribution
  const eraBuckets: Record<string, number> = {
    "Pre-1990 (Classics)": 0,
    "1990s": 0,
    "2000s": 0,
    "2010s": 0,
    "2020s (Modern)": 0,
  };

  dataset.forEach((t) => {
    if (!t.year) return;
    if (t.year < 1990) eraBuckets["Pre-1990 (Classics)"]++;
    else if (t.year < 2000) eraBuckets["1990s"]++;
    else if (t.year < 2010) eraBuckets["2000s"]++;
    else if (t.year < 2020) eraBuckets["2010s"]++;
    else eraBuckets["2020s (Modern)"]++;
  });

  const eraDistribution: EraStat[] = Object.entries(eraBuckets).map(([label, count]) => ({
    label,
    count,
    percentage: Math.round((count / totalAnalyzed) * 100),
  }));

  // 7. Rating buckets
  const ratingTally = {
    "8.0 - 10.0": 0,
    "7.0 - 7.9": 0,
    "6.0 - 6.9": 0,
    "< 6.0": 0,
  };
  dataset.forEach((t) => {
    const r = t.rating || 0;
    if (r >= 8.0) ratingTally["8.0 - 10.0"]++;
    else if (r >= 7.0) ratingTally["7.0 - 7.9"]++;
    else if (r >= 6.0) ratingTally["6.0 - 6.9"]++;
    else ratingTally["< 6.0"]++;
  });

  const ratingDistribution: RatingBucket[] = Object.entries(ratingTally).map(([range, count]) => ({
    range,
    count,
    percentage: Math.round((count / totalAnalyzed) * 100),
  }));

  // 8. Popularity vs. Quality categorization
  let hiddenGems = 0;
  let blockbusters = 0;
  let popcornEntertainment = 0;
  let nicheIndies = 0;

  dataset.forEach((t) => {
    const isHighRating = (t.rating || 0) >= 7.2;
    const isHighPopularity = (t.popularity || 0) >= 40;
    if (isHighRating && !isHighPopularity) hiddenGems++;
    else if (isHighRating && isHighPopularity) blockbusters++;
    else if (!isHighRating && isHighPopularity) popcornEntertainment++;
    else nicheIndies++;
  });

  // 9. TV Series Progress tracking
  const tvSeries = dataset.filter((t) => t.mediaType === "tv");
  let totalSeasonsWatched = 0;
  let totalSeasonsAvailable = 0;
  let completedSeriesCount = 0;
  let inProgressSeriesCount = 0;

  const progressItems: SeriesProgressItem[] = tvSeries.map((t) => {
    const watchedSeasons = t.watchedSeasons || [];
    const watchedCount = watchedSeasons.length;
    const totalCount = t.numberOfSeasons ?? null;
    totalSeasonsWatched += watchedCount;
    if (totalCount && totalCount > 0) {
      totalSeasonsAvailable += totalCount;
    }
    const isComplete = totalCount ? watchedCount >= totalCount : false;
    if (isComplete) completedSeriesCount++;
    else if (watchedCount > 0) inProgressSeriesCount++;

    const percentage = totalCount && totalCount > 0
      ? Math.min(100, Math.round((watchedCount / totalCount) * 100))
      : watchedCount > 0 ? 50 : 0;

    return {
      id: t.id,
      title: t.title,
      watchedCount,
      totalCount,
      percentage,
      isComplete,
    };
  });

  const overallCompletionRate = totalSeasonsAvailable > 0
    ? Math.round((totalSeasonsWatched / totalSeasonsAvailable) * 100)
    : tvSeries.length > 0 && completedSeriesCount > 0
    ? Math.round((completedSeriesCount / tvSeries.length) * 100)
    : 0;

  // 10. Language distribution
  const langTally: Record<string, number> = {};
  dataset.forEach((t) => {
    const l = t.originalLanguage?.toLowerCase() || "unknown";
    langTally[l] = (langTally[l] || 0) + 1;
  });

  const languages = Object.entries(langTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({
      code,
      count,
      name: LANGUAGE_NAMES[code] || code.toUpperCase(),
    }));

  // 11. Top Rated Titles (deduplicated)
  const topRatedTitles = [...dataset]
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 6);

  // 12. Dynamic Persona Generation
  const persona = determinePersona(
    totalAnalyzed,
    sortedGenres,
    indianPercentage,
    averageRating,
    tvCount,
    movieCount,
    eraBuckets
  );

  return {
    totalAnalyzed,
    movieCount,
    tvCount,
    averageRating,
    highRatedCount,
    indianCount,
    globalCount,
    indianPercentage,
    globalPercentage,
    watchlistCount: watchlist.length,
    backlogRatio,
    topGenres: sortedGenres.slice(0, 7),
    eraDistribution,
    ratingDistribution,
    popularityBreakdown: { hiddenGems, blockbusters, popcornEntertainment, nicheIndies },
    tvSeriesProgress: {
      totalSeries: tvSeries.length,
      completedSeries: completedSeriesCount,
      inProgressSeries: inProgressSeriesCount,
      totalSeasonsWatched,
      overallCompletionRate,
      items: progressItems.slice(0, 8),
    },
    languages,
    persona,
    topRatedTitles,
  };
}

function determinePersona(
  total: number,
  topGenres: GenreStat[],
  indianPct: number,
  avgRating: number,
  tvCount: number,
  movieCount: number,
  eras: Record<string, number>
): PersonaAnalysis {
  const topGenre = topGenres[0]?.name || "";
  const secondGenre = topGenres[1]?.name || "";

  if (indianPct >= 40) {
    return {
      title: "Desi Cinema Connoisseur",
      badge: "Regional & Indian Specialist",
      description: `You have a rich passion for Indian cinema and storytelling (${indianPct}% of your viewing profile), blending regional narratives with global sensations.`,
      traits: ["Indian Blockbusters & Art-House", `${topGenre || "Drama"} Enthusiast`, "Culturally Expansive"],
    };
  }

  if (tvCount > movieCount && tvCount >= 5) {
    return {
      title: "Serial Worldbuilder",
      badge: "Prestige Television Devotee",
      description: "You favor long-form character depth and episodic multi-season journeys over self-contained features.",
      traits: ["High-Commitment Series", "Deep Character Arcs", "Season Binger"],
    };
  }

  if (avgRating >= 7.8) {
    return {
      title: "The Prestigious Cinephile",
      badge: "Critical Acclaim Focused",
      description: `With an average TMDB score of ${avgRating.toFixed(1)}, you have an exacting standard for cinematic quality and masterwork craftsmanship.`,
      traits: ["Auteur Vision", "Critically Acclaimed", "High Quality Threshold"],
    };
  }

  if (topGenre === "Science Fiction" || topGenre === "Sci-Fi & Fantasy") {
    return {
      title: "The Speculative Visionary",
      badge: "Sci-Fi & Conceptual Explorer",
      description: "You gravitate toward expansive worlds, cosmic inquiries, and speculative technology.",
      traits: ["High Concept Fiction", "Futurism & Cosmology", "Worldbuilding"],
    };
  }

  if (topGenre === "Thriller" || topGenre === "Crime" || topGenre === "Mystery") {
    return {
      title: "The Suspense Architect",
      badge: "Neo-Noir & Mystery Sleuth",
      description: "You thrive on narrative twists, cerebral pacing, psychological stakes, and high-tension cinema.",
      traits: ["Psychological Thrillers", "Twist-Driven Narratives", "Detective Minds"],
    };
  }

  if (eras["Pre-1990 (Classics)"] + eras["1990s"] >= total * 0.45 && total >= 6) {
    return {
      title: "The Golden Era Traditionalist",
      badge: "Vintage & Classic Revivalist",
      description: "You appreciate the foundational craft, practical effects, and timeless pacing of vintage cinematic eras.",
      traits: ["90s Golden Era", "Classic Hollywood", "Nostalgic Masterpieces"],
    };
  }

  return {
    title: "The Eclectic Omnivore",
    badge: "Balanced Cinephile",
    description: `Your tastes span diverse genres (${topGenre} and ${secondGenre || "Drama"}) and styles without locking into a single mold.`,
    traits: ["Cross-Genre Curiosity", "Dynamic Viewing Habits", "Exploratory Palette"],
  };
}