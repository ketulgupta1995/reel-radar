import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "@/test/fixtures";
import {
  detail,
  discover,
  genreList,
  getRecommendations,
  getSimilar,
  normalize,
  personCredits,
  poster,
  search,
} from "./tmdb";

type Handler = (url: URL) => unknown;

// Routes TMDB requests by pathname; unknown paths return 404 so missing mocks are obvious.
function mockTmdb(routes: Record<string, unknown | Handler>) {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/3/, "");
    if (!(path in routes)) return jsonResponse({}, { status: 404 });
    const route = routes[path];
    return jsonResponse(typeof route === "function" ? (route as Handler)(url) : route);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const rawMovie = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Movie ${id}`,
  release_date: "2015-06-01",
  poster_path: `/m${id}.jpg`,
  overview: "Overview",
  genre_ids: [28],
  vote_average: 7.1,
  popularity: 50,
  vote_count: 500,
  original_language: "en",
  ...extra,
});

beforeEach(() => {
  vi.stubEnv("TMDB_API_KEY", "test-key");
});

describe("normalize", () => {
  it("maps a TMDB movie to a Title", () => {
    const t = normalize(rawMovie(1, { genre_ids: [28, 99999], production_countries: [{ iso_3166_1: "US" }] }), "movie");
    expect(t).toMatchObject({
      id: 1,
      mediaType: "movie",
      title: "Movie 1",
      year: 2015,
      posterPath: "/m1.jpg",
      genres: [28, 99999],
      genreNames: ["Action"], // unknown genre ids are dropped from names
      rating: 7.1,
      popularity: 50,
      voteCount: 500,
      originalLanguage: "en",
      originCountry: ["US"],
      numberOfSeasons: undefined,
    });
  });

  it("maps a TMDB series, using name/first_air_date and origin_country", () => {
    const t = normalize(
      { id: 2, name: "Show", first_air_date: "2019-01-01", genres: [{ id: 18 }], number_of_seasons: 3, origin_country: ["IN"] },
      "tv"
    );
    expect(t).toMatchObject({ title: "Show", year: 2019, genres: [18], genreNames: ["Drama"], numberOfSeasons: 3, originCountry: ["IN"] });
  });

  it("fills safe defaults for missing fields", () => {
    const t = normalize({ id: 3, title: "Bare", overview: "   " }, "movie");
    expect(t).toMatchObject({
      year: null,
      overview: "No synopsis is available.",
      genres: [],
      rating: 0,
      popularity: 0,
      voteCount: 0,
      originalLanguage: undefined,
      originCountry: [],
    });
  });
});

describe("poster and genreList", () => {
  it("builds a w500 poster URL or null", () => {
    expect(poster("/a.jpg")).toBe("https://image.tmdb.org/t/p/w500/a.jpg");
    expect(poster(null)).toBeNull();
  });

  it("lists genres per media type", () => {
    expect(genreList("movie")).toContainEqual({ id: 878, name: "Science Fiction" });
    expect(genreList("tv")).toContainEqual({ id: 10765, name: "Sci-Fi & Fantasy" });
  });
});

describe("TMDB request handling", () => {
  it("throws when the API key is missing", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    await expect(discover("movie")).rejects.toThrow("TMDB_API_KEY is not configured");
  });

  it("sends the API key and throws on a non-OK response", async () => {
    const fetchMock = mockTmdb({});
    await expect(discover("movie")).rejects.toThrow("TMDB request failed (404)");
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("api_key")).toBe("test-key");
  });

  it("retries once when the first request throws", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(jsonResponse({ results: [rawMovie(1)] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await discover("movie")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("discover", () => {
  it("uses default sort, vote floor and release-date floor", async () => {
    let params!: URLSearchParams;
    mockTmdb({ "/discover/movie": (u: URL) => ((params = u.searchParams), { results: [rawMovie(1)] }) });
    const out = await discover("movie", 2, 35);
    expect(out[0].id).toBe(1);
    expect(params.get("page")).toBe("2");
    expect(params.get("sort_by")).toBe("popularity.desc");
    expect(params.get("vote_count.gte")).toBe("30");
    expect(params.get("primary_release_date.gte")).toBe("1990-01-01");
    expect(params.get("with_genres")).toBe("35");
  });

  it("applies options and tags Indian-origin results with IN", async () => {
    let params!: URLSearchParams;
    mockTmdb({ "/discover/tv": (u: URL) => ((params = u.searchParams), { results: [{ id: 5, name: "S", origin_country: [] }] }) });
    const out = await discover("tv", 1, undefined, {
      originCountry: "IN",
      originalLanguage: "hi",
      maxVotes: 100,
      minRating: 7,
      sortBy: "vote_average.desc",
    });
    expect(params.get("first_air_date.gte")).toBe("1990-01-01");
    expect(params.get("vote_count.gte")).toBe("10"); // lower floor for Indian titles
    expect(params.get("vote_count.lte")).toBe("100");
    expect(params.get("vote_average.gte")).toBe("7");
    expect(params.get("with_origin_country")).toBe("IN");
    expect(params.get("with_original_language")).toBe("hi");
    expect(params.get("sort_by")).toBe("vote_average.desc");
    expect(out[0].originCountry).toEqual(["IN"]);
  });

  it("handles a response without results", async () => {
    mockTmdb({ "/discover/movie": {} });
    expect(await discover("movie")).toEqual([]);
  });
});

describe("search", () => {
  it("keeps only movies and series", async () => {
    mockTmdb({
      "/search/multi": {
        results: [
          { ...rawMovie(1), media_type: "movie" },
          { id: 2, name: "Show", media_type: "tv" },
          { id: 3, name: "Person", media_type: "person" },
        ],
      },
    });
    const out = await search("x");
    expect(out.map((t) => `${t.mediaType}:${t.id}`)).toEqual(["movie:1", "tv:2"]);
  });
});

describe("personCredits", () => {
  it("returns the name and deduplicated credits sorted by popularity", async () => {
    mockTmdb({
      "/person/7": { name: "Actor" },
      "/person/7/combined_credits": {
        cast: [
          { ...rawMovie(1, { popularity: 5 }), media_type: "movie" },
          { ...rawMovie(2, { popularity: 90 }), media_type: "movie" },
          { ...rawMovie(1, { popularity: 5 }), media_type: "movie" }, // same title, second role
          { id: 3, media_type: "person" },
        ],
      },
    });
    const out = await personCredits(7);
    expect(out.name).toBe("Actor");
    expect(out.titles.map((t) => t.id)).toEqual([2, 1]);
  });

  it("caps the filmography at 50 titles", async () => {
    mockTmdb({
      "/person/7": { name: "Actor" },
      "/person/7/combined_credits": { cast: Array.from({ length: 60 }, (_, i) => ({ ...rawMovie(i + 1), media_type: "movie" })) },
    });
    expect((await personCredits(7)).titles).toHaveLength(50);
  });
});

describe("getRecommendations", () => {
  it("returns normalized TMDB recommendations", async () => {
    mockTmdb({ "/movie/1/recommendations": { results: [rawMovie(2)] } });
    expect((await getRecommendations("movie", 1))[0].id).toBe(2);
  });

  it("returns an empty list on failure", async () => {
    mockTmdb({});
    expect(await getRecommendations("movie", 1)).toEqual([]);
  });
});

describe("detail", () => {
  it("adds cast, directors, keywords and a YouTube trailer for movies", async () => {
    mockTmdb({
      "/movie/1": {
        ...rawMovie(1),
        credits: {
          cast: Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Cast ${i}` })),
          crew: [
            { id: 50, name: "Dir", job: "Director" },
            { id: 51, name: "Writer", job: "Screenplay" },
          ],
        },
        keywords: { keywords: [{ name: "heist" }] },
        videos: {
          results: [
            { site: "Vimeo", type: "Trailer", key: "nope" },
            { site: "YouTube", type: "Featurette", key: "nope2" },
            { site: "YouTube", type: "Teaser", key: "yt123" },
          ],
        },
      },
    });
    const t = await detail("movie", 1);
    expect(t.cast).toHaveLength(8);
    expect(t.cast?.[0]).toEqual({ id: 0, name: "Cast 0" });
    expect(t.creators).toEqual([{ id: 50, name: "Dir" }]);
    expect(t.keywords).toEqual(["heist"]);
    expect(t.trailerYoutubeId).toBe("yt123");
  });

  it("uses created_by and keyword results for series", async () => {
    mockTmdb({
      "/tv/2": { id: 2, name: "Show", created_by: [{ id: 9, name: "Creator" }], keywords: { results: [{ name: "family" }] } },
    });
    const t = await detail("tv", 2);
    expect(t.creators).toEqual([{ id: 9, name: "Creator" }]);
    expect(t.keywords).toEqual(["family"]);
    expect(t.trailerYoutubeId).toBeUndefined();
  });
});

describe("getSimilar", () => {
  const anchor = {
    ...rawMovie(1, { genre_ids: undefined, genres: [{ id: 878 }, { id: 18 }], release_date: "2014-01-01" }),
    overview: "Astronauts travel through a wormhole searching for humanity's future",
    credits: { cast: [], crew: [{ id: 99, name: "Visionary Director", job: "Director" }] },
    keywords: { keywords: [{ name: "wormhole" }] },
  };

  const setup = () =>
    mockTmdb({
      "/movie/1": anchor,
      "/movie/1/recommendations": (u: URL) =>
        u.searchParams.get("page") === "1"
          ? {
              results: [
                rawMovie(1, { genre_ids: [878] }), // the anchor itself
                rawMovie(10, { genre_ids: [878, 18], overview: "A wormhole mission", release_date: "2013-01-01" }),
                rawMovie(11, { genre_ids: [878], poster_path: null }),
                rawMovie(12, { genre_ids: [878], release_date: "1980-01-01" }),
                rawMovie(13, { genre_ids: [878], vote_count: 3 }),
                rawMovie(14, { genre_ids: [35] }), // no shared genre
              ],
            }
          : { results: [] },
      "/movie/1/similar": { results: [rawMovie(20, { genre_ids: [18] })] },
      "/discover/movie": { results: [rawMovie(30, { genre_ids: [35] })] },
    });

  it("filters weak candidates and scores the rest", async () => {
    setup();
    const out = await getSimilar("movie", 1);
    const ids = out.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([10, 20, 30]));
    expect(ids).not.toContain(1); // anchor
    expect(ids).not.toContain(11); // no poster
    expect(ids).not.toContain(12); // before 1990
    expect(ids).not.toContain(13); // too few votes
    expect(ids).not.toContain(14); // no shared genre, not same director
    expect(ids[0]).toBe(10);
    for (const t of out) {
      expect(t.similarityScore).toBeGreaterThanOrEqual(50);
      expect(t.similarityScore).toBeLessThanOrEqual(99);
      expect(t.why).toBeTruthy();
    }
    const scores = out.map((t) => t.similarityScore!);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("explains director and keyword matches", async () => {
    setup();
    const out = await getSimilar("movie", 1);
    expect(out.find((t) => t.id === 30)?.why).toMatch(/^Directed by Visionary Director/);
    expect(out.find((t) => t.id === 10)?.why).toContain('"wormhole"');
  });

  it("honours minYear 0, maxYear and limit", async () => {
    setup();
    expect((await getSimilar("movie", 1, { minYear: 0 })).map((t) => t.id)).toContain(12);
    expect((await getSimilar("movie", 1, { maxYear: 2014 })).map((t) => t.id)).toEqual([10]);
    expect(await getSimilar("movie", 1, { limit: 1 })).toHaveLength(1);
  });

  it("returns an empty list when the anchor can't be loaded", async () => {
    mockTmdb({});
    expect(await getSimilar("movie", 1)).toEqual([]);
  });
});
