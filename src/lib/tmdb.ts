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

// Added boolean to allowed parameter values
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
) {
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

export async function detail(type: MediaType, id: number) {
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