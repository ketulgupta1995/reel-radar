import { beforeEach, describe, expect, it, vi } from "vitest";
import { mk } from "@/test/fixtures";

vi.mock("@/lib/tmdb", () => ({
  detail: vi.fn(),
  discover: vi.fn(),
  getRecommendations: vi.fn(),
}));

import * as tmdb from "@/lib/tmdb";
import { POST } from "./route";
import { Title } from "@/types/title";

const m = vi.mocked(tmdb);
const post = (body: unknown) =>
  new Request("http://localhost/api/recommendations", { method: "POST", body: JSON.stringify(body) });

const watched = Array.from({ length: 10 }, (_, i) => mk(i + 1, { genres: [18], genreNames: ["Drama"] }));

beforeEach(() => {
  vi.resetAllMocks();
  m.detail.mockImplementation(async (type, id) => mk(id, { mediaType: type, genres: [18], genreNames: ["Drama"] }));
  m.discover.mockImplementation(async (type, page, _genre, opts) => [
    mk(1000 + (page ?? 1), { mediaType: type, originCountry: opts?.originCountry ? ["IN"] : [], genres: [18] }),
  ]);
  m.getRecommendations.mockResolvedValue([mk(1)]); // already watched, must be dropped
});

describe("POST /api/recommendations", () => {
  it("requires at least 10 watched titles", async () => {
    const res = await POST(post({ watched: watched.slice(0, 9) }));
    expect(res.status).toBe(400);
  });

  it("returns categorized, explained recommendations", async () => {
    const res = await POST(post({ watched }));
    expect(res.status).toBe(200);
    const { categories, summary } = await res.json();
    expect(summary).toEqual(["Drama"]);
    const all: Title[] = [...categories.indianMovies, ...categories.globalMovies, ...categories.indianSeries, ...categories.globalSeries];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((t) => typeof t.why === "string" && t.why.length > 0)).toBe(true);
    expect(all.some((t) => t.id <= 10)).toBe(false);
    expect(categories.indianMovies.every((t: Title) => t.originCountry?.includes("IN"))).toBe(true);
    expect(categories.globalSeries.every((t: Title) => t.mediaType === "tv")).toBe(true);
  });

  it("excludes watchlisted and dismissed titles and loads dismissed metadata", async () => {
    const res = await POST(
      post({ watched, watchlist: [mk(1001)], dismissed: ["movie:1002", "bogus", "person:5"] })
    );
    const { categories } = await res.json();
    const movieIds = [...categories.globalMovies, ...categories.indianMovies].map((t: Title) => t.id);
    expect(movieIds).not.toContain(1001);
    expect(movieIds).not.toContain(1002);
    expect(m.detail).toHaveBeenCalledWith("movie", 1002);
    expect(m.detail).not.toHaveBeenCalledWith("person", 5);
  });

  it("falls back to the posted title when detail lookup fails", async () => {
    m.detail.mockRejectedValue(new Error("x"));
    expect((await POST(post({ watched }))).status).toBe(200);
  });

  it("survives some failed pools but errors when every pool fails", async () => {
    m.discover.mockRejectedValueOnce(new Error("x"));
    expect((await POST(post({ watched }))).status).toBe(200);

    m.discover.mockRejectedValue(new Error("x"));
    m.getRecommendations.mockResolvedValue([]);
    const res = await POST(post({ watched }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Could not reach TMDB/);
  });
});
