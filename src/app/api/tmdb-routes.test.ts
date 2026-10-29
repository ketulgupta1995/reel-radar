import { beforeEach, describe, expect, it, vi } from "vitest";
import { mk } from "@/test/fixtures";

vi.mock("@/lib/tmdb", () => ({
  discover: vi.fn(),
  search: vi.fn(),
  detail: vi.fn(),
  personCredits: vi.fn(),
  getSimilar: vi.fn(),
  genreList: (type: string) => [{ id: type === "movie" ? 28 : 10759, name: "Action" }],
}));

import * as tmdb from "@/lib/tmdb";
import { GET as discoverRoute } from "./discover/route";
import { GET as searchRoute } from "./search/route";
import { GET as titleRoute } from "./title/route";
import { GET as personRoute } from "./person/[id]/route";
import { GET as similarRoute } from "./similar/route";

const m = vi.mocked(tmdb);
const get = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => vi.resetAllMocks());

describe("GET /api/discover", () => {
  beforeEach(() => {
    m.discover.mockImplementation(async (type, _page, _genre, opts) =>
      opts?.originCountry === "IN" ? [mk(100, { mediaType: type, originCountry: ["IN"] })] : [mk(1, { mediaType: type })]
    );
  });

  it("interleaves global and Indian titles by default, for both media types", async () => {
    const res = await discoverRoute(get("/api/discover?page=2&genre=28"));
    const body = await res.json();
    expect(body.results.map((t: { id: number; mediaType: string }) => `${t.mediaType}:${t.id}`)).toEqual([
      "movie:1",
      "movie:100",
      "tv:1",
      "tv:100",
    ]);
    expect(body.genres.movie).toEqual([{ id: 28, name: "Action" }]);
    expect(m.discover).toHaveBeenCalledWith("movie", 2, 28);
    expect(m.discover).toHaveBeenCalledWith("tv", 2, 28, { originCountry: "IN", minVotes: 2 });
  });

  it("returns only Indian titles for region=in", async () => {
    const body = await (await discoverRoute(get("/api/discover?type=movie&region=in"))).json();
    expect(body.results.map((t: { id: number }) => t.id)).toEqual([100]);
    expect(m.discover).toHaveBeenCalledWith("movie", 1, undefined, { originCountry: "IN", minVotes: 5 });
  });

  it("returns only global titles for region=global", async () => {
    const body = await (await discoverRoute(get("/api/discover?type=tv&region=global"))).json();
    expect(body.results.map((t: { id: number }) => t.id)).toEqual([1]);
    expect(m.discover).toHaveBeenCalledTimes(1);
  });

  it("returns 500 with the error message when TMDB fails", async () => {
    m.discover.mockRejectedValue(new Error("TMDB request failed (503)"));
    const res = await discoverRoute(get("/api/discover"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "TMDB request failed (503)" });
  });
});

describe("GET /api/search", () => {
  it("returns no results for an empty query without calling TMDB", async () => {
    expect(await (await searchRoute(get("/api/search"))).json()).toEqual({ results: [] });
    expect(m.search).not.toHaveBeenCalled();
  });

  it("returns search results", async () => {
    m.search.mockResolvedValue([mk(1)]);
    const body = await (await searchRoute(get("/api/search?query=heat"))).json();
    expect(m.search).toHaveBeenCalledWith("heat");
    expect(body.results).toHaveLength(1);
  });

  it("returns 500 on failure", async () => {
    m.search.mockRejectedValue(new Error("x"));
    expect((await searchRoute(get("/api/search?query=heat"))).status).toBe(500);
  });
});

describe("GET /api/title", () => {
  it("validates type and id", async () => {
    expect((await titleRoute(get("/api/title?type=movie"))).status).toBe(400);
    expect((await titleRoute(get("/api/title?type=book&id=1"))).status).toBe(400);
  });

  it("returns title details", async () => {
    m.detail.mockResolvedValue(mk(5, { trailerYoutubeId: "yt" }));
    const body = await (await titleRoute(get("/api/title?type=tv&id=5"))).json();
    expect(m.detail).toHaveBeenCalledWith("tv", 5);
    expect(body.trailerYoutubeId).toBe("yt");
  });

  it("returns 500 on failure", async () => {
    m.detail.mockRejectedValue(new Error("boom"));
    const res = await titleRoute(get("/api/title?type=movie&id=5"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});

describe("GET /api/person/[id]", () => {
  it("validates the id", async () => {
    expect((await personRoute(get("/api/person/x"), { params: { id: "x" } })).status).toBe(400);
  });

  it("returns credits", async () => {
    m.personCredits.mockResolvedValue({ name: "Actor", titles: [mk(1)] });
    const body = await (await personRoute(get("/api/person/7"), { params: { id: "7" } })).json();
    expect(m.personCredits).toHaveBeenCalledWith(7);
    expect(body.name).toBe("Actor");
  });

  it("returns 500 on failure", async () => {
    m.personCredits.mockRejectedValue(new Error("x"));
    expect((await personRoute(get("/api/person/7"), { params: { id: "7" } })).status).toBe(500);
  });
});

describe("GET /api/similar", () => {
  beforeEach(() => {
    m.getSimilar.mockResolvedValue([mk(2)]);
  });

  it("validates type and id", async () => {
    expect((await similarRoute(get("/api/similar?type=movie"))).status).toBe(400);
    expect((await similarRoute(get("/api/similar?type=x&id=1"))).status).toBe(400);
  });

  it("defaults to post-1990 titles and 24 results", async () => {
    const body = await (await similarRoute(get("/api/similar?type=movie&id=1"))).json();
    expect(body.results).toHaveLength(1);
    expect(m.getSimilar).toHaveBeenCalledWith("movie", 1, { minYear: 1990, maxYear: undefined, limit: 24 });
  });

  it("passes year range and limit through, with minYear=all disabling the floor", async () => {
    await similarRoute(get("/api/similar?type=tv&id=1&minYear=all&maxYear=2010&limit=5"));
    expect(m.getSimilar).toHaveBeenCalledWith("tv", 1, { minYear: 0, maxYear: 2010, limit: 5 });
    await similarRoute(get("/api/similar?type=tv&id=1&minYear=2000"));
    expect(m.getSimilar).toHaveBeenLastCalledWith("tv", 1, { minYear: 2000, maxYear: undefined, limit: 24 });
  });

  it("returns 500 on failure", async () => {
    m.getSimilar.mockRejectedValue(new Error("x"));
    expect((await similarRoute(get("/api/similar?type=movie&id=1"))).status).toBe(500);
  });
});

describe("browser caching", () => {
  it("lets the browser reuse successful responses, never errors", async () => {
    m.detail.mockResolvedValue(mk(1));
    m.personCredits.mockResolvedValue({ name: "A", titles: [] });
    m.search.mockResolvedValue([]);
    m.getSimilar.mockResolvedValue([]);
    m.discover.mockResolvedValue([]);
    const cache = async (res: Response | Promise<Response>) => (await res).headers.get("Cache-Control");
    expect(await cache(titleRoute(get("/api/title?type=movie&id=1")))).toBe("private, max-age=86400");
    expect(await cache(personRoute(get("/api/person/1"), { params: { id: "1" } }))).toBe("private, max-age=86400");
    expect(await cache(searchRoute(get("/api/search?query=x")))).toBe("private, max-age=3600");
    expect(await cache(similarRoute(get("/api/similar?type=movie&id=1")))).toBe("private, max-age=3600");
    expect(await cache(discoverRoute(get("/api/discover")))).toBe("private, max-age=3600");
    m.detail.mockRejectedValue(new Error("down"));
    expect(await cache(titleRoute(get("/api/title?type=movie&id=1")))).toBeNull();
  });
});
