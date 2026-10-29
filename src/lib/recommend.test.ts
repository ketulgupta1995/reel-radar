import { describe, expect, it } from "vitest";
import { explanation, matchesEra, matchesMood, rank, rankCategorized } from "./recommend";
import { Title } from "@/types/title";
import { mk } from "@/test/fixtures";

const t = (id: number, genres: number[], type: "movie" | "tv" = "movie"): Title => ({
  id,
  mediaType: type,
  title: String(id),
  year: 2000,
  posterPath: null,
  overview: "A test title synopsis",
  genres,
  rating: 7,
  popularity: 5,
});

describe("rank", () => {
  it("excludes watched titles and favors shared genres", () => {
    const watched = [t(1, [878])];
    const out = rank(watched, [t(1, [878]), t(2, [878]), t(3, [35])]);
    expect(out.map((x) => x.id)).not.toContain(1);
    expect(out[0].id).toBe(2);
  });

  it("excludes titles that are already in the watchlist", () => {
    const watched = [t(1, [878])];
    const watchlist = [t(2, [878])];
    const candidates = [t(1, [878]), t(2, [878]), t(3, [878]), t(4, [35])];
    const out = rank(watched, candidates, [], [], watchlist);
    expect(out.map((x) => x.id)).not.toContain(1);
    expect(out.map((x) => x.id)).not.toContain(2);
    expect(out[0].id).toBe(3);
  });

  it("ranks candidates resembling dismissed titles lower", () => {
    const watched = [t(1, [878, 35]), t(2, [878, 35])];
    const candidates = [t(3, [878]), t(4, [35])];
    const baseline = rank(watched, candidates);
    const out = rank(watched, candidates, [], [], [], 20, { dismissedTitles: [t(9, [35]), t(10, [35])] });
    expect(baseline.length).toBe(2);
    expect(out[0].id).toBe(3);
    expect(out[1].id).toBe(4);
  });
});

describe("rank filters and options", () => {
  const watched = [mk(1, { genres: [878] }), mk(2, { genres: [878] })];

  it("returns nothing without candidates", () => {
    expect(rank(watched, [])).toEqual([]);
  });

  it("excludes dismissed keys and watchlist keys passed as strings", () => {
    const out = rank(watched, [mk(3, { genres: [878] }), mk(4, { genres: [878] }), mk(5, { genres: [878] })], [], ["movie:3"], ["movie:4"]);
    expect(out.map((x) => x.id)).toEqual([5]);
  });

  it("treats movie and tv with the same id as different titles", () => {
    const out = rank(watched, [mk(1, { mediaType: "tv", genres: [878] })]);
    expect(out).toHaveLength(1);
  });

  it("drops duplicate candidates", () => {
    expect(rank(watched, [mk(3), mk(3)])).toHaveLength(1);
  });

  it("ranks already-shown titles lower", () => {
    const candidates = [mk(3, { genres: [878] }), mk(4, { genres: [878] })];
    expect(rank(watched, candidates)[0].id).toBe(3);
    expect(rank(watched, candidates, ["movie:3"])[0].id).toBe(4);
  });

  it("applies era and mood filters", () => {
    const candidates = [
      mk(3, { year: 1995, genres: [53] }),
      mk(4, { year: 2010, genres: [35] }),
      mk(5, { year: 2023, genres: [28] }),
    ];
    expect(rank(watched, candidates, [], [], [], 20, { era: "classic" }).map((x) => x.id)).toEqual([3]);
    expect(rank(watched, candidates, [], [], [], 20, { era: "recent" }).map((x) => x.id)).toEqual([5]);
    expect(rank(watched, candidates, [], [], [], 20, { mood: "feelgood" }).map((x) => x.id)).toEqual([4]);
  });

  it("respects the limit and strips the internal score", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => mk(100 + i));
    const out = rank(watched, candidates, [], [], [], 5);
    expect(out).toHaveLength(5);
    expect(out[0]).not.toHaveProperty("_score");
  });

  it("is deterministic", () => {
    const candidates = Array.from({ length: 30 }, (_, i) => mk(100 + i, { genres: [i % 2 ? 878 : 18], rating: 5 + (i % 5) }));
    expect(rank(watched, candidates)).toEqual(rank(watched, candidates));
  });

  it("boosts Indian titles for viewers who watch Indian cinema", () => {
    const indianFan = [mk(1, { originalLanguage: "hi" }), mk(2, { originalLanguage: "ta" })];
    const candidates = [mk(3, { originalLanguage: "en" }), mk(4, { originalLanguage: "hi" })];
    expect(rank(indianFan, candidates)[0].id).toBe(4);
  });

  it("favours popular titles in popular mode and acclaimed ones in deep-cuts mode", () => {
    const candidates = [mk(3, { popularity: 5000, rating: 6.5 }), mk(4, { popularity: 2, rating: 7.0 })];
    expect(rank(watched, candidates, [], [], [], 20, { discoveryStyle: "deepcuts" })[0].id).toBe(4);
    expect(rank(watched, candidates, [], [], [], 20, { discoveryStyle: "popular" })[0].id).toBe(3);
  });

  it("rewards shared creators and cast", () => {
    const fan = [mk(1, { creators: [{ id: 7, name: "Dir" }] }), mk(2, { creators: [{ id: 7, name: "Dir" }] })];
    const out = rank(fan, [mk(3), mk(4, { creators: [{ id: 7, name: "Dir" }] })]);
    expect(out[0].id).toBe(4);
  });
});

describe("matchesEra", () => {
  it("buckets years into eras and lets unknown years through", () => {
    expect(matchesEra(2004, "classic")).toBe(true);
    expect(matchesEra(2005, "classic")).toBe(false);
    expect(matchesEra(2005, "modern")).toBe(true);
    expect(matchesEra(2019, "modern")).toBe(true);
    expect(matchesEra(2020, "modern")).toBe(false);
    expect(matchesEra(2020, "recent")).toBe(true);
    expect(matchesEra(null, "recent")).toBe(true);
    expect(matchesEra(1950, "all")).toBe(true);
  });
});

describe("matchesMood", () => {
  it("matches when any genre belongs to the mood", () => {
    expect(matchesMood([80], "dark")).toBe(true);
    expect(matchesMood([28], "adrenaline")).toBe(true);
    expect(matchesMood([10751], "feelgood")).toBe(true);
    expect(matchesMood([10765], "mindbending")).toBe(true);
    expect(matchesMood([35], "dark")).toBe(false);
    expect(matchesMood([], "all")).toBe(true);
  });
});

describe("rankCategorized", () => {
  const watched = [mk(1), mk(2)];

  it("splits results into Indian/global movies and series", () => {
    const out = rankCategorized(watched, [
      mk(3, { originalLanguage: "hi" }),
      mk(4),
      mk(5, { mediaType: "tv", originCountry: ["IN"] }),
      mk(6, { mediaType: "tv" }),
    ]);
    expect(out.indianMovies.map((x) => x.id)).toEqual([3]);
    expect(out.globalMovies.map((x) => x.id)).toEqual([4]);
    expect(out.indianSeries.map((x) => x.id)).toEqual([5]);
    expect(out.globalSeries.map((x) => x.id)).toEqual([6]);
  });

  it("caps each category", () => {
    const out = rankCategorized(watched, Array.from({ length: 10 }, (_, i) => mk(10 + i)), [], [], [], 3);
    expect(out.globalMovies).toHaveLength(3);
  });

  it("builds thematic shelves only when at least three titles qualify", () => {
    const gems = Array.from({ length: 3 }, (_, i) => mk(10 + i, { rating: 8, popularity: 10, genres: [878], year: 2000 }));
    const out = rankCategorized(watched, gems);
    expect(out.thematicShelves.map((s) => s.id)).toEqual(["hidden-gems", "mind-bending", "classics-vault"]);
    expect(rankCategorized(watched, gems.slice(0, 2)).thematicShelves).toEqual([]);
  });
});

describe("explanation", () => {
  it("prefers shared talent", () => {
    const watched = [mk(1, { cast: [{ id: 5, name: "Star" }] })];
    expect(explanation(mk(2, { cast: [{ id: 5, name: "Star" }] }), watched)).toContain("Features Star");
  });

  it("calls out acclaimed titles", () => {
    expect(explanation(mk(2, { rating: 8.1 }), [mk(1)])).toContain("Critically acclaimed (8.1/10)");
  });

  it("pairs Indian titles with Indian history when there is one", () => {
    expect(explanation(mk(2, { originalLanguage: "hi" }), [mk(1, { title: "Lagaan", originalLanguage: "hi" })])).toContain('"Lagaan"');
    expect(explanation(mk(2, { mediaType: "tv", originalLanguage: "hi" }), [mk(1)])).toContain("Acclaimed Indian series");
  });

  it("names shared genres, or falls back to a generic line", () => {
    const watched = [mk(1, { title: "Heat", genres: [80], genreNames: ["Crime"] })];
    expect(explanation(mk(2, { genres: [80], genreNames: ["Crime"] }), watched)).toBe(
      'Matches the Crime style from your viewing of "Heat".'
    );
    expect(explanation(mk(3, { genres: [35], genreNames: ["Comedy"] }), watched)).toBe(
      "A high-affinity recommendation aligned with your viewing patterns."
    );
  });
});
