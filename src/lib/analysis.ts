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

export type TalentObsession = {
  name: string;
  role: "director" | "actor";
  count: number;
  sampleTitles: string[];
};

export type TasteBlindspot = {
  category: string;
  reason: string;
  recommendationHint: string;
  count: number;
};

export type UniverseProgress = {
  name: string;
  tag: string;
  watchedCount: number;
  totalKnown: number;
  percentage: number;
  titles: string[];
  unseenTitles: string[];
  searchQuery: string;
};


export type OrphanedSeries = {
  title: Title;
  watchedSeasonCount: number;
  totalSeasonCount: number;
  unwatchedSeasons: number[];
  recommendationNote: string;
};

export type GraphNode = {
  id: string;
  name: string;
  type: "title" | "person";
  subType?: "movie" | "tv" | "director" | "actor";
  rating?: number;
  connections: number;
  x?: number;
  y?: number;
};

export type GraphLink = {
  source: string;
  target: string;
  label: string;
};

export type CinemaGraph = {
  nodes: GraphNode[];
  links: GraphLink[];
  centralHubs: { name: string; connections: number; type: string }[];
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
    hiddenGems: number;
    blockbusters: number;
    popcornEntertainment: number;
    nicheIndies: number;
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

  // 1. Director & Actor Obsessions
  topDirectors: TalentObsession[];
  topActors: TalentObsession[];

  // 2. Screen Time & Mileage
  screenMileage: {
    totalHours: number;
    totalDays: number;
    movieHours: number;
    seriesHours: number;
    longestSeries: { title: string; seasons: number } | null;
  };

  // 3. Contrarian vs Consensus Index
  tasteIndex: {
    consensusScore: number;
    consensusLabel: string;
    biggestHiddenGems: Title[];
    guiltyPleasures: Title[];
  };

  // 4. Taste Blindspots & Next Frontiers
  blindspots: TasteBlindspot[];

  // 5. Director & Franchise Universes
  universes: UniverseProgress[];

  // 6. Orphaned Series Alert
  orphanedSeries: OrphanedSeries[];

  // 7. Kevin Bacon / Six Degrees Cinema Graph
  cinemaGraph: CinemaGraph;
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

// Universe definitions for tracking
const PRESET_UNIVERSES = [
  {
    name: "Christopher Nolan Universe",
    tag: "Director",
    searchQuery: "Christopher Nolan",
    canonTitles: [
      "Oppenheimer",
      "Tenet",
      "Dunkirk",
      "Interstellar",
      "The Dark Knight Rises",
      "Inception",
      "The Dark Knight",
      "The Prestige",
      "Batman Begins",
      "Insomnia",
      "Memento",
      "Following",
    ],
    matcher: (t: Title) =>
      (t.creators || []).some((c) => c.name.toLowerCase().includes("nolan")) ||
      ["Inception", "Interstellar", "Oppenheimer", "The Dark Knight", "Memento", "Tenet", "Dunkirk", "The Prestige", "Batman Begins", "Insomnia", "Following"].some(
        (x) => t.title.toLowerCase().includes(x.toLowerCase())
      ),
    totalKnown: 12,
  },
  {
    name: "Denis Villeneuve Sci-Fi & Drama",
    tag: "Director",
    searchQuery: "Denis Villeneuve",
    canonTitles: [
      "Dune: Part Two",
      "Dune",
      "Blade Runner 2049",
      "Arrival",
      "Sicario",
      "Enemy",
      "Prisoners",
      "Incendies",
      "Polytechnique",
    ],
    matcher: (t: Title) =>
      (t.creators || []).some((c) => c.name.toLowerCase().includes("villeneuve")) ||
      ["Dune", "Arrival", "Blade Runner 2049", "Sicario", "Prisoners", "Incendies", "Enemy", "Polytechnique"].some(
        (x) => t.title.toLowerCase().includes(x.toLowerCase())
      ),
    totalKnown: 9,
  },
  {
    name: "Quentin Tarantino Vault",
    tag: "Director",
    searchQuery: "Quentin Tarantino",
    canonTitles: [
      "Once Upon a Time in Hollywood",
      "The Hateful Eight",
      "Django Unchained",
      "Inglourious Basterds",
      "Death Proof",
      "Kill Bill: Vol. 2",
      "Kill Bill: Vol. 1",
      "Jackie Brown",
      "Pulp Fiction",
      "Reservoir Dogs",
    ],
    matcher: (t: Title) =>
      (t.creators || []).some((c) => c.name.toLowerCase().includes("tarantino")) ||
      ["Pulp Fiction", "Inglourious Basterds", "Django Unchained", "Kill Bill", "Reservoir Dogs", "The Hateful Eight", "Once Upon a Time in Hollywood", "Jackie Brown", "Death Proof"].some((x) =>
        t.title.toLowerCase().includes(x.toLowerCase())
      ),
    totalKnown: 10,
  },
  {
    name: "Anurag Kashyap & Indian Neo-Noir",
    tag: "Auteur",
    searchQuery: "Anurag Kashyap",
    canonTitles: [
      "Gangs of Wasseypur",
      "Sacred Games",
      "Ugly",
      "Dev.D",
      "Black Friday",
      "Raman Raghav 2.0",
      "Kennedy",
      "Gulaal",
      "No Smoking",
    ],
    matcher: (t: Title) =>
      (t.creators || []).some((c) => c.name.toLowerCase().includes("kashyap")) ||
      ["Gangs of Wasseypur", "Sacred Games", "Ugly", "Dev.D", "Black Friday", "Raman Raghav", "Kennedy", "Gulaal", "No Smoking"].some((x) =>
        t.title.toLowerCase().includes(x.toLowerCase())
      ),
    totalKnown: 9,
  },
  {
    name: "Marvel Cinematic Universe (MCU)",
    tag: "Franchise",
    searchQuery: "Avengers",
    canonTitles: [
      "Iron Man",
      "Captain America: The Winter Soldier",
      "Guardians of the Galaxy",
      "Avengers: Infinity War",
      "Avengers: Endgame",
      "Thor: Ragnarok",
      "Black Panther",
      "Spider-Man: No Way Home",
      "Loki",
      "WandaVision",
    ],
    matcher: (t: Title) =>
      ["Iron Man", "Avengers", "Thor", "Captain America", "Guardians of the Galaxy", "Spider-Man", "Loki", "WandaVision", "Black Panther", "Doctor Strange"].some(
        (x) => t.title.toLowerCase().includes(x.toLowerCase())
      ),
    totalKnown: 34,
  },
  {
    name: "Prestige Crime & Mafia Epics",
    tag: "Sub-genre",
    searchQuery: "The Godfather",
    canonTitles: [
      "The Godfather",
      "The Godfather Part II",
      "Goodfellas",
      "The Sopranos",
      "Scarface",
      "The Irishman",
      "Mirzapur",
      "Narcos",
      "Peaky Blinders",
      "Casino",
    ],
    matcher: (t: Title) =>
      ["Godfather", "Goodfellas", "Sopranos", "Scarface", "The Irishman", "Mirzapur", "Narcos", "Peaky Blinders", "Casino"].some(
        (x) => t.title.toLowerCase().includes(x.toLowerCase())
      ),
    totalKnown: 12,
  },
];

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
      topDirectors: [],
      topActors: [],
      screenMileage: {
        totalHours: 0,
        totalDays: 0,
        movieHours: 0,
        seriesHours: 0,
        longestSeries: null,
      },
      tasteIndex: {
        consensusScore: 50,
        consensusLabel: "Calibrating",
        biggestHiddenGems: [],
        guiltyPleasures: [],
      },
      blindspots: [],
      universes: [],
      orphanedSeries: [],
      cinemaGraph: {
        nodes: [],
        links: [],
        centralHubs: [],
      },
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

  // 13. Director & Actor Obsessions (Talent Footprint)
  const directorMap = new Map<string, { count: number; titles: string[] }>();
  const actorMap = new Map<string, { count: number; titles: string[] }>();

  dataset.forEach((t) => {
    (t.creators || []).forEach((c) => {
      const entry = directorMap.get(c.name) || { count: 0, titles: [] };
      entry.count++;
      if (entry.titles.length < 3 && !entry.titles.includes(t.title)) {
        entry.titles.push(t.title);
      }
      directorMap.set(c.name, entry);
    });

    (t.cast || []).slice(0, 4).forEach((a) => {
      const entry = actorMap.get(a.name) || { count: 0, titles: [] };
      entry.count++;
      if (entry.titles.length < 3 && !entry.titles.includes(t.title)) {
        entry.titles.push(t.title);
      }
      actorMap.set(a.name, entry);
    });
  });

  const topDirectors: TalentObsession[] = Array.from(directorMap.entries())
    .filter(([_, d]) => d.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, d]) => ({
      name,
      role: "director",
      count: d.count,
      sampleTitles: d.titles,
    }));

  const topActors: TalentObsession[] = Array.from(actorMap.entries())
    .filter(([_, a]) => a.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, a]) => ({
      name,
      role: "actor",
      count: a.count,
      sampleTitles: a.titles,
    }));

  // 14. Screen Mileage (Total screen hours and runtime calculation)
  // Assuming average movie = 2.1 hours, average TV season = 8.5 hours
  const movieHours = Math.round(movieCount * 2.1);
  const seriesHours = Math.round(totalSeasonsWatched * 8.5);
  const totalHours = movieHours + seriesHours;
  const totalDays = Number((totalHours / 24).toFixed(1));

  let longestSeries: { title: string; seasons: number } | null = null;
  tvSeries.forEach((t) => {
    const s = t.watchedSeasons?.length || 0;
    if (!longestSeries || s > longestSeries.seasons) {
      longestSeries = { title: t.title, seasons: s };
    }
  });

  // 15. Contrarian vs. Consensus Index
  // Compare TMDB popularity & vote counts against scores
  let totalConsensusWeight = 0;
  dataset.forEach((t) => {
    const pop = t.popularity || 0;
    // Normalize popularity into 0 - 100 consensus score
    const itemConsensus = Math.min(100, Math.round(Math.log10(Math.max(pop, 1)) * 30));
    totalConsensusWeight += itemConsensus;
  });
  const consensusScore = totalAnalyzed > 0 ? Math.round(totalConsensusWeight / totalAnalyzed) : 50;

  let consensusLabel = "Balanced Explorer";
  if (consensusScore >= 68) consensusLabel = "Mainstream Consensus Loyalist";
  else if (consensusScore >= 52) consensusLabel = "Balanced Cinephile";
  else if (consensusScore >= 38) consensusLabel = "Aesthetic Independent";
  else consensusLabel = "Hyper-Contrarian / Deep Cut Specialist";

  const biggestHiddenGems = [...dataset]
    .filter((t) => (t.rating || 0) >= 7.4 && (t.popularity || 0) < 35)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 4);

  const guiltyPleasures = [...dataset]
    .filter((t) => (t.rating || 0) > 0 && (t.rating || 0) <= 6.5 && (t.popularity || 0) >= 40)
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 4);

  // 16. Taste Blindspots & The Next Frontier
  const blindspots: TasteBlindspot[] = [];

  const sciFiCount = genreTally["Science Fiction"] || genreTally["Sci-Fi & Fantasy"] || 0;
  if (sciFiCount <= 2 && totalAnalyzed >= 15) {
    blindspots.push({
      category: "High-Concept Sci-Fi & Speculative Fiction",
      reason: `Only ${sciFiCount} titles in your screening records despite high critical acclaim globally.`,
      recommendationHint: "Check out Arrival, Interstellar, or Dark (TV).",
      count: sciFiCount,
    });
  }

  const animationCount = genreTally["Animation"] || 0;
  if (animationCount <= 3 && totalAnalyzed >= 15) {
    blindspots.push({
      category: "Prestige Animation & Studio Ghibli",
      reason: `Only ${animationCount} animated titles logged. Modern cinema features masterworks like Spirited Away and Spider-Verse.`,
      recommendationHint: "Explore Arcane, Spirited Away, or Spider-Man: Into the Spider-Verse.",
      count: animationCount,
    });
  }

  const southIndianCount = dataset.filter(
    (t) =>
      t.originalLanguage === "te" ||
      t.originalLanguage === "ta" ||
      t.originalLanguage === "ml" ||
      t.originalLanguage === "kn"
  ).length;

  if (indianCount >= 10 && southIndianCount <= 3) {
    blindspots.push({
      category: "Regional South Indian Cinema (Malayalam & Tamil)",
      reason: `Your Indian cinema viewing is primarily Hindi-focused (${southIndianCount} South titles logged).`,
      recommendationHint: "Discover Kumbalangi Nights, Super Deluxe, or Aavesham.",
      count: southIndianCount,
    });
  }

  const vintageCount = eraBuckets["Pre-1990 (Classics)"] || 0;
  if (vintageCount <= 2 && totalAnalyzed >= 20) {
    blindspots.push({
      category: "Pre-90s Foundational Classics",
      reason: `Only ${vintageCount} titles from before 1990. Vintage masters paved the way for current auteurs.`,
      recommendationHint: "Try 12 Angry Men, The Godfather, or Sholay.",
      count: vintageCount,
    });
  }

  // 17. Universe & Director Progress
  const universes: UniverseProgress[] = PRESET_UNIVERSES.map((u) => {
    const matches = dataset.filter(u.matcher);
    const watchedTitles = matches.map((m) => m.title);
    const count = matches.length;
    const percentage = Math.min(100, Math.round((count / u.totalKnown) * 100));

    // Find canon titles that user hasn't seen yet
    const unseenTitles = (u.canonTitles || []).filter(
      (canon) => !dataset.some((t) => t.title.toLowerCase().includes(canon.toLowerCase()))
    );

    return {
      name: u.name,
      tag: u.tag,
      searchQuery: u.searchQuery,
      watchedCount: count,
      totalKnown: u.totalKnown,
      percentage,
      titles: watchedTitles.slice(0, 4),
      unseenTitles: unseenTitles.slice(0, 5),
    };
  }).filter((u) => u.watchedCount > 0).sort((a, b) => b.watchedCount - a.watchedCount);

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
    topDirectors,
    topActors,
    screenMileage: {
      totalHours,
      totalDays,
      movieHours,
      seriesHours,
      longestSeries,
    },
    tasteIndex: {
      consensusScore,
      consensusLabel,
      biggestHiddenGems,
      guiltyPleasures,
    },
    blindspots,
    universes,

    // 18. Orphaned Series Alert
    // Series where user watched season 1 (or partial seasons) but there are subsequent released seasons they never continued
    orphanedSeries: (() => {
      const orphans: OrphanedSeries[] = [];
      tvSeries.forEach((t) => {
        const watched = t.watchedSeasons || [];
        const total = t.numberOfSeasons ?? null;
        if (!total || total <= 1) return; // Single-season shows / miniseries aren't orphaned

        // If user watched at least 1 season but stopped before the latest season
        if (watched.length > 0 && watched.length < total) {
          const unwatched: number[] = [];
          for (let s = 1; s <= total; s++) {
            if (!watched.includes(s)) unwatched.push(s);
          }

          // Pick high-impact or critically acclaimed series to highlight
          let recommendationNote = `You enjoyed S${watched.join(", S")} — ${unwatched.length} further season${
            unwatched.length > 1 ? "s are" : " is"
          } waiting (S${unwatched.join(", S")}).`;

          if (t.rating >= 7.8) {
            recommendationNote += " Highly rated critical acclaim.";
          }

          orphans.push({
            title: t,
            watchedSeasonCount: watched.length,
            totalSeasonCount: total,
            unwatchedSeasons: unwatched,
            recommendationNote,
          });
        }
      });

      return orphans.sort((a, b) => (b.title.rating || 0) - (a.title.rating || 0));
    })(),

    // 19. "The Kevin Bacon" / Six Degrees Cinema Graph
    // Build an interconnected graph where movies and recurring talent form a constellation
    cinemaGraph: (() => {
      // Find talent that connects 2 or more titles
      const talentConnections = new Map<
        string,
        { name: string; type: "director" | "actor"; titles: Title[] }
      >();

      dataset.forEach((t) => {
        (t.creators || []).forEach((c) => {
          const key = `dir:${c.name}`;
          const cur = talentConnections.get(key) || { name: c.name, type: "director", titles: [] };
          if (!cur.titles.some((x) => x.id === t.id)) cur.titles.push(t);
          talentConnections.set(key, cur);
        });

        (t.cast || []).slice(0, 4).forEach((a) => {
          const key = `act:${a.name}`;
          const cur = talentConnections.get(key) || { name: a.name, type: "actor", titles: [] };
          if (!cur.titles.some((x) => x.id === t.id)) cur.titles.push(t);
          talentConnections.set(key, cur);
        });
      });

      // Filter to top interconnected hubs (connected to at least 2 titles)
      const topHubs = Array.from(talentConnections.entries())
        .filter(([_, v]) => v.titles.length >= 2)
        .sort((a, b) => b[1].titles.length - a[1].titles.length)
        .slice(0, 16);

      const nodesMap = new Map<string, GraphNode>();
      const links: GraphLink[] = [];

      topHubs.forEach(([hubKey, hub]) => {
        const hubId = `hub_${hubKey}`;
        if (!nodesMap.has(hubId)) {
          nodesMap.set(hubId, {
            id: hubId,
            name: hub.name,
            type: "person",
            subType: hub.type,
            connections: hub.titles.length,
          });
        }

        hub.titles.slice(0, 4).forEach((t) => {
          const titleId = `title_${t.mediaType}_${t.id}`;
          if (!nodesMap.has(titleId)) {
            nodesMap.set(titleId, {
              id: titleId,
              name: t.title,
              type: "title",
              subType: t.mediaType,
              rating: t.rating,
              connections: 1,
            });
          } else {
            const existing = nodesMap.get(titleId)!;
            existing.connections++;
          }

          links.push({
            source: hubId,
            target: titleId,
            label: hub.type === "director" ? "Directed" : "Starred in",
          });
        });
      });

      // Compute simple dynamic 2D constellation layout coordinates (circle layout centered)
      const nodes = Array.from(nodesMap.values());
      const width = 800;
      const height = 500;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = 200;

      nodes.forEach((n, idx) => {
        if (n.type === "person") {
          // Hubs on inner circle
          const angle = (idx / Math.max(topHubs.length, 1)) * 2 * Math.PI;
          const r = radius * 0.45;
          n.x = Math.round(centerX + r * Math.cos(angle));
          n.y = Math.round(centerY + r * Math.sin(angle));
        } else {
          // Titles on outer constellation ring with subtle jitter
          const angle = (idx / Math.max(nodes.length, 1)) * 2 * Math.PI;
          const r = radius * (0.85 + ((idx % 3) * 0.08));
          n.x = Math.round(centerX + r * Math.cos(angle));
          n.y = Math.round(centerY + r * Math.sin(angle));
        }
      });

      const centralHubs = topHubs.map(([_, h]) => ({
        name: h.name,
        connections: h.titles.length,
        type: h.type === "director" ? "Director" : "Actor",
      }));

      return {
        nodes,
        links,
        centralHubs,
      };
    })(),
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