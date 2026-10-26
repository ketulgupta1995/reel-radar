import { MediaType, Title } from "@/types/title";

const base = "https://api.themoviedb.org/3";
const image = "https://image.tmdb.org/t/p/w500";

const genres: Record<MediaType, Record<number, string>> = {
  movie: {
    28: "Action",
    12: "Adventure",
    16: "Animation",
    35: "Comedy",
    80: "Crime",
    18: "Drama",
    14: "Fantasy",
    27: "Horror",
    9648: "Mystery",
    10749: "Romance",
    878: "Science Fiction",
    53: "Thriller",
  },
  tv: {
    10759: "Action & Adventure",
    16: "Animation",
    35: "Comedy",
    80: "Crime",
    18: "Drama",
    10765: "Sci-Fi & Fantasy",
    9648: "Mystery",
    10749: "Romance",
    10768: "War & Politics",
  },
};

export const poster = (path: string | null) => (path ? `${image}${path}` : null);

async function get(path: string, params: Record<string, string | number | boolean> = {}) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not configured");
  const u = new URL(base + path);
  u.searchParams.set("api_key", key);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const r = await fetch(u, { next: { revalidate: 3600 } });
  if (!r.ok) throw new Error(`TMDB request failed (${r.status})`);
  return r.json();
}

export const normalize = (x: any, type: MediaType): Title => {
  const originCountry: string[] = Array.isArray(x.origin_country)
    ? x.origin_country
    : Array.isArray(x.production_countries)
    ? x.production_countries.map((c: any) => c.iso_3166_1).filter(Boolean)
    : [];

  return {
    id: x.id,
    mediaType: type,
    title: type === "movie" ? x.title : x.name,
    year: Number((type === "movie" ? x.release_date : x.first_air_date)?.slice(0, 4)) || null,
    posterPath: x.poster_path,
    overview: x.overview?.trim() || "No synopsis is available.",
    genres: x.genre_ids || x.genres?.map((g: any) => g.id) || [],
    genreNames: (x.genre_ids || x.genres?.map((g: any) => g.id) || [])
      .map((id: number) => genres[type][id])
      .filter(Boolean),
    rating: Number(x.vote_average) || 0,
    popularity: Number(x.popularity) || 0,
    voteCount: Number(x.vote_count) || 0,
    numberOfSeasons: type === "tv" ? x.number_of_seasons : undefined,
    originalLanguage: x.original_language || undefined,
    originCountry,
  };
};

export type DiscoverOptions = {
  originCountry?: string;
  originalLanguage?: string;
  sortBy?: string;
  minVotes?: number;
  maxVotes?: number;
  minRating?: number;
};

export async function discover(
  type: MediaType,
  page = 1,
  genre?: number,
  options: DiscoverOptions = {}
): Promise<Title[]> {
  const p: any = {
    page,
    sort_by: options.sortBy || "popularity.desc",
    "vote_count.gte":
      options.minVotes !== undefined
        ? options.minVotes
        : options.originCountry === "IN"
        ? 10
        : 30,
  };

  if (options.maxVotes !== undefined) {
    p["vote_count.lte"] = options.maxVotes;
  }
  if (options.minRating !== undefined) {
    p["vote_average.gte"] = options.minRating;
  }

  p[type === "movie" ? "primary_release_date.gte" : "first_air_date.gte"] = "1990-01-01";
  if (genre) p.with_genres = genre;
  if (options.originCountry) p.with_origin_country = options.originCountry;
  if (options.originalLanguage) p.with_original_language = options.originalLanguage;

  const d = await get(`/discover/${type}`, p);
  return (d.results || []).map((x: any) => {
    const item = normalize(x, type);
    if (options.originCountry === "IN" && !item.originCountry?.includes("IN")) {
      item.originCountry = [...(item.originCountry || []), "IN"];
    }
    return item;
  });
}

export async function search(query: string): Promise<Title[]> {
  const d = await get(`/search/multi`, { query, page: 1, include_adult: false });
  return (d.results || [])
    .filter((x: any) => x.media_type === "movie" || x.media_type === "tv")
    .map((x: any) => normalize(x, x.media_type as MediaType));
}

export async function personCredits(personId: number): Promise<{ name: string; titles: Title[] }> {
  const person = await get(`/person/${personId}`);
  const credits = await get(`/person/${personId}/combined_credits`);
  const titles = (credits.cast || [])
    .filter((x: any) => x.media_type === "movie" || x.media_type === "tv")
    .map((x: any) => normalize(x, x.media_type as MediaType))
    .sort((a: Title, b: Title) => b.popularity - a.popularity);

  const unique = new Map<string, Title>();
  titles.forEach((t: Title) => {
    const key = `${t.mediaType}:${t.id}`;
    if (!unique.has(key)) unique.set(key, t);
  });
  return { name: person.name, titles: Array.from(unique.values()).slice(0, 50) };
}

export async function getRecommendations(type: MediaType, id: number): Promise<Title[]> {
  try {
    const d = await get(`/${type}/${id}/recommendations`, { page: 1 });
    return (d.results || []).map((x: any) => normalize(x, type));
  } catch {
    return [];
  }
}

export type SimilarOptions = {
  minYear?: number;
  maxYear?: number;
  limit?: number;
};

function buildSimilarityWhy({
  anchorTitle,
  directorName,
  matchedGenreNames,
  matchedKeywords,
  rating,
}: {
  anchorTitle: string;
  directorName?: string;
  matchedGenreNames: string[];
  matchedKeywords: string[];
  rating: number;
}): string {
  const parts: string[] = [];

  if (directorName) {
    parts.push(`Directed by ${directorName}`);
  }

  if (matchedGenreNames.length >= 2) {
    parts.push(`shared ${matchedGenreNames.slice(0, 2).join(" & ")} style`);
  } else if (matchedGenreNames.length === 1) {
    parts.push(`shared ${matchedGenreNames[0]} tone`);
  }

  if (matchedKeywords.length > 0) {
    parts.push(`thematic focus on "${matchedKeywords.slice(0, 2).join('", "')}"`);
  }

  if (parts.length === 0) {
    if (rating >= 7.8) {
      return `Critically acclaimed (${rating.toFixed(1)}/10) companion piece to "${anchorTitle}".`;
    }
    return `High narrative and stylistic affinity with "${anchorTitle}".`;
  }

  const raw = `${parts[0]}${parts.length > 1 ? ` with ${parts.slice(1).join(" and ")}` : ` aligned with "${anchorTitle}"`}.`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export async function getSimilar(
  type: MediaType,
  id: number,
  options: SimilarOptions = {}
): Promise<Title[]> {
  try {
    const minYear = options.minYear !== undefined ? options.minYear : 1990;
    const limit = options.limit || 24;

    // 1. Fetch detailed anchor metadata to power similarity scoring
    let anchor: Title;
    try {
      anchor = await detail(type, id);
    } catch {
      const raw = await get(`/${type}/${id}`).catch(() => null);
      if (!raw) return [];
      anchor = normalize(raw, type);
    }

    const primaryDirector = anchor.creators?.[0];

    // 2. Concurrently fetch high-quality candidate pools
    const fetchPromises: Promise<any>[] = [
      get(`/${type}/${id}/recommendations`, { page: 1 }).catch(() => ({ results: [] })),
      get(`/${type}/${id}/recommendations`, { page: 2 }).catch(() => ({ results: [] })),
      get(`/${type}/${id}/similar`, { page: 1 }).catch(() => ({ results: [] })),
    ];

    if (primaryDirector?.id && type === "movie") {
      fetchPromises.push(
        get(`/discover/movie`, {
          with_crew: primaryDirector.id,
          "primary_release_date.gte": minYear > 0 ? `${minYear}-01-01` : "1900-01-01",
          sort_by: "vote_average.desc",
          "vote_count.gte": 15,
        }).catch(() => ({ results: [] }))
      );
    }

    const [rec1, rec2, sim1, dirRes] = await Promise.all(fetchPromises);

    type CandidateMeta = {
      title: Title;
      recRank?: number;
      fromSimilar: boolean;
      fromDirector: boolean;
    };

    const candidateMap = new Map<number, CandidateMeta>();

    // Process TMDB recommendations (pages 1 & 2)
    const recResults = [...(rec1.results || []), ...(rec2.results || [])];
    recResults.forEach((x: any, idx: number) => {
      if (x.id === id) return;
      if (!candidateMap.has(x.id)) {
        candidateMap.set(x.id, {
          title: normalize(x, type),
          recRank: idx,
          fromSimilar: false,
          fromDirector: false,
        });
      }
    });

    // Process TMDB similar
    (sim1.results || []).forEach((x: any) => {
      if (x.id === id) return;
      const existing = candidateMap.get(x.id);
      if (existing) {
        existing.fromSimilar = true;
      } else {
        candidateMap.set(x.id, {
          title: normalize(x, type),
          fromSimilar: true,
          fromDirector: false,
        });
      }
    });

    // Process Director filmography
    if (dirRes?.results) {
      dirRes.results.forEach((x: any) => {
        if (x.id === id) return;
        const existing = candidateMap.get(x.id);
        if (existing) {
          existing.fromDirector = true;
        } else {
          candidateMap.set(x.id, {
            title: normalize(x, type),
            fromSimilar: false,
            fromDirector: true,
          });
        }
      });
    }

    const aGenres = new Set(anchor.genres || []);
    const aKeywords = (anchor.keywords || []).map((k) => k.toLowerCase());
    const aOverviewWords = new Set(
      (anchor.overview || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 4)
    );

    const scoredCandidates: Title[] = [];

    for (const meta of candidateMap.values()) {
      const c = meta.title;

      // Filter: Release year requirement (defaults to >= 1990)
      if (minYear > 0) {
        if (c.year === null || c.year < minYear) continue;
      }
      if (options.maxYear && c.year && c.year > options.maxYear) continue;

      // Quality Filter: Must have poster
      if (!c.posterPath) continue;

      // Quality Filter: Filter low-vote noise
      const isIndian =
        c.originCountry?.includes("IN") ||
        (c.originalLanguage && ["hi", "te", "ta", "ml", "kn", "bn", "mr"].includes(c.originalLanguage));
      const minVotes = isIndian ? 5 : 15;
      if (c.voteCount !== undefined && c.voteCount < minVotes) continue;

      // 1. Genre Jaccard & intersection overlap
      const cGenres = new Set(c.genres || []);
      let genreScore = 0;
      let sharedCount = 0;
      if (aGenres.size > 0 && cGenres.size > 0) {
        sharedCount = [...aGenres].filter((g) => cGenres.has(g)).length;
        const unionSize = new Set([...aGenres, ...cGenres]).size;
        const jaccard = sharedCount / unionSize;
        const overlap = sharedCount / Math.min(aGenres.size, cGenres.size);
        genreScore = 0.6 * jaccard + 0.4 * overlap;

        if (anchor.genres[0] && cGenres.has(anchor.genres[0])) {
          genreScore += 0.15;
        }
      }

      // Skip completely disjoint titles that do not share the director
      if (sharedCount === 0 && !meta.fromDirector) {
        continue;
      }

      // 2. TMDB collaborative co-watching rank
      let tmdbRecScore = 0.2;
      if (meta.recRank !== undefined) {
        tmdbRecScore = Math.max(0.2, 1.0 - meta.recRank * 0.025);
      } else if (meta.fromSimilar) {
        tmdbRecScore = 0.4;
      }

      // 3. Director match
      const sameDirector =
        meta.fromDirector ||
        (primaryDirector && (c.creators || []).some((cr) => cr.name === primaryDirector.name));
      const directorScore = sameDirector ? 1.0 : 0.0;

      // 4. Keyword & narrative synopsis overlap
      const cText = `${c.title} ${c.overview}`.toLowerCase();
      const matchedKeywords = aKeywords.filter((k) => cText.includes(k));
      const kwScore = aKeywords.length > 0 ? Math.min(matchedKeywords.length / 2, 1.0) : 0;

      const cOverviewWords = new Set(
        (c.overview || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 4)
      );
      const sharedOverviewWords = [...aOverviewWords].filter((w) => cOverviewWords.has(w));
      const overviewOverlap = sharedOverviewWords.length / Math.max(aOverviewWords.size, 1);
      const thematicScore = 0.7 * kwScore + 0.3 * Math.min(overviewOverlap * 4, 1.0);

      // 5. Temporal proximity
      let temporalScore = 0.5;
      if (anchor.year && c.year) {
        const diff = Math.abs(anchor.year - c.year);
        temporalScore = Math.max(0, 1.0 - diff / 30);
      }

      // 6. Regional / Language match
      const langScore =
        anchor.originalLanguage &&
        c.originalLanguage &&
        anchor.originalLanguage === c.originalLanguage
          ? 1.0
          : 0.5;

      // Composite multi-factor score
      const rawScore =
        35.0 * Math.min(genreScore, 1.0) +
        25.0 * tmdbRecScore +
        18.0 * directorScore +
        12.0 * thematicScore +
        5.0 * temporalScore +
        5.0 * langScore;

      // Bayesian rating quality regularizer
      const rating = c.rating || 6.0;
      const qualityMultiplier = 0.85 + 0.15 * (Math.min(rating, 10) / 10);
      const finalScore = Math.min(99, Math.max(50, Math.round(rawScore * qualityMultiplier)));

      const matchedGenreNames = (c.genreNames || []).filter((g) =>
        (anchor.genreNames || []).includes(g)
      );

      c.similarityScore = finalScore;
      c.why = buildSimilarityWhy({
        anchorTitle: anchor.title,
        directorName: sameDirector ? primaryDirector?.name : undefined,
        matchedGenreNames,
        matchedKeywords,
        rating: c.rating,
      });

      scoredCandidates.push(c);
    }

    return scoredCandidates
      .sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function detail(type: MediaType, id: number): Promise<Title> {
  const x = await get(`/${type}/${id}`, { append_to_response: "credits,keywords,videos" });
  const t = normalize(x, type);
  t.cast = (x.credits?.cast || []).slice(0, 8).map((p: any) => ({ id: p.id, name: p.name }));
  t.creators =
    type === "movie"
      ? (x.credits?.crew || []).filter((p: any) => p.job === "Director").map((p: any) => ({
          id: p.id,
          name: p.name,
        }))
      : (x.created_by || []).map((p: any) => ({ id: p.id, name: p.name }));
  t.keywords = (type === "movie" ? x.keywords?.keywords : x.keywords?.results || [])
    .slice(0, 12)
    .map((k: any) => k.name);
  const trailer = (x.videos?.results || []).find(
    (v: any) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
  );
  if (trailer) t.trailerYoutubeId = trailer.key;
  return t;
}

export const genreList = (type: MediaType) =>
  Object.entries(genres[type]).map(([id, name]) => ({ id: Number(id), name }));