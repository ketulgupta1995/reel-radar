import { describe, expect, it } from "vitest";
import { computeAnalysis, filterWatchedTitles } from "./analysis";
import { mk } from "@/test/fixtures";

const ALL = { mediaType: "all", region: "all" } as const;

describe("filterWatchedTitles", () => {
  const titles = [mk(1), mk(2, { mediaType: "tv" }), mk(3, { originalLanguage: "hi" })];

  it("filters by media type and region", () => {
    expect(filterWatchedTitles(titles, ALL)).toHaveLength(3);
    expect(filterWatchedTitles(titles, { mediaType: "tv", region: "all" }).map((t) => t.id)).toEqual([2]);
    expect(filterWatchedTitles(titles, { mediaType: "all", region: "in" }).map((t) => t.id)).toEqual([3]);
    expect(filterWatchedTitles(titles, { mediaType: "all", region: "global" }).map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("computeAnalysis", () => {
  it("returns an empty profile when nothing matches", () => {
    const out = computeAnalysis([], [mk(9)], ALL);
    expect(out.totalAnalyzed).toBe(0);
    expect(out.watchlistCount).toBe(1);
    expect(out.persona.badge).toBe("New Explorer");
    expect(out.tasteIndex.consensusLabel).toBe("Calibrating");
  });

  it("computes counts, averages and regional split", () => {
    const watched = [
      mk(1, { rating: 8.5 }),
      mk(2, { rating: 7.5, mediaType: "tv" }),
      mk(3, { rating: 6, originalLanguage: "hi" }),
      mk(4, { rating: 4, originCountry: ["IN"] }),
    ];
    const out = computeAnalysis(watched, [mk(5)], ALL);
    expect(out).toMatchObject({
      totalAnalyzed: 4,
      movieCount: 3,
      tvCount: 1,
      averageRating: 6.5,
      highRatedCount: 1,
      indianCount: 2,
      globalCount: 2,
      indianPercentage: 50,
      globalPercentage: 50,
      watchlistCount: 1,
      backlogRatio: 20,
    });
    expect(out.ratingDistribution.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  });

  it("tallies genres, eras and languages", () => {
    const watched = [
      mk(1, { year: 1985, genreNames: ["Drama", "Crime"], originalLanguage: "en" }),
      mk(2, { year: 1995, genreNames: ["Drama"], originalLanguage: "en" }),
      mk(3, { year: 2005, genreNames: ["Crime"], originalLanguage: "ko" }),
      mk(4, { year: 2015, genreNames: ["Drama"], originalLanguage: "xx" }),
      mk(5, { year: 2022, genreNames: [], originalLanguage: undefined }),
    ];
    const out = computeAnalysis(watched, [], ALL);
    expect(out.topGenres[0]).toEqual({ name: "Drama", count: 3, percentage: 60 });
    expect(out.eraDistribution.map((e) => e.count)).toEqual([1, 1, 1, 1, 1]);
    expect(out.languages[0]).toEqual({ code: "en", count: 2, name: "English" });
    expect(out.languages.find((l) => l.code === "xx")?.name).toBe("XX");
    expect(out.languages.find((l) => l.code === "unknown")).toBeTruthy();
  });

  it("classifies popularity vs quality", () => {
    const out = computeAnalysis(
      [
        mk(1, { rating: 8, popularity: 10 }),
        mk(2, { rating: 8, popularity: 100 }),
        mk(3, { rating: 6, popularity: 100 }),
        mk(4, { rating: 6, popularity: 10 }),
      ],
      [],
      ALL
    );
    expect(out.popularityBreakdown).toEqual({ hiddenGems: 1, blockbusters: 1, popcornEntertainment: 1, nicheIndies: 1 });
    expect(out.tasteIndex.biggestHiddenGems.map((t) => t.id)).toEqual([1]);
    expect(out.tasteIndex.guiltyPleasures.map((t) => t.id)).toEqual([3]);
  });

  it("tracks series progress, screen time and orphaned series", () => {
    const watched = [
      mk(1),
      mk(2, { mediaType: "tv", title: "Done", numberOfSeasons: 2, watchedSeasons: [1, 2] }),
      mk(3, { mediaType: "tv", title: "Halfway", numberOfSeasons: 4, watchedSeasons: [1, 3], rating: 8 }),
      mk(4, { mediaType: "tv", title: "Unknown", watchedSeasons: [1] }),
    ];
    const out = computeAnalysis(watched, [], ALL);
    expect(out.tvSeriesProgress).toMatchObject({
      totalSeries: 3,
      completedSeries: 1,
      inProgressSeries: 2,
      totalSeasonsWatched: 5,
      overallCompletionRate: 83, // 5 of 6 known seasons
    });
    expect(out.tvSeriesProgress.items.find((i) => i.title === "Unknown")?.percentage).toBe(50);
    expect(out.screenMileage).toMatchObject({ movieHours: 2, seriesHours: 43, totalHours: 45, totalDays: 1.9 });
    expect(out.screenMileage.longestSeries).toEqual({ title: "Done", seasons: 2 }); // ties keep the first
    expect(out.orphanedSeries).toHaveLength(1);
    expect(out.orphanedSeries[0]).toMatchObject({ watchedSeasonCount: 2, totalSeasonCount: 4, unwatchedSeasons: [2, 4] });
    expect(out.orphanedSeries[0].recommendationNote).toContain("Highly rated");
  });

  it("finds recurring directors and actors and links them in the graph", () => {
    const nolan = { id: 1, name: "Christopher Nolan" };
    const bale = { id: 2, name: "Christian Bale" };
    const watched = [
      mk(1, { title: "The Prestige", creators: [nolan], cast: [bale] }),
      mk(2, { title: "Batman Begins", creators: [nolan], cast: [bale] }),
      mk(3, { title: "Solo", creators: [{ id: 3, name: "Once" }] }),
    ];
    const out = computeAnalysis(watched, [], ALL);
    expect(out.topDirectors).toEqual([{ name: "Christopher Nolan", role: "director", count: 2, sampleTitles: ["The Prestige", "Batman Begins"] }]);
    expect(out.topActors.map((a) => a.name)).toEqual(["Christian Bale"]);
    expect(out.cinemaGraph.centralHubs.map((h) => h.name)).toEqual(["Christopher Nolan", "Christian Bale"]);
    expect(out.cinemaGraph.nodes.filter((n) => n.type === "title")).toHaveLength(2);
    expect(out.cinemaGraph.links).toHaveLength(4);
    for (const n of out.cinemaGraph.nodes) {
      expect(n.x).toBeTypeOf("number");
      expect(n.y).toBeTypeOf("number");
    }
    const universe = out.universes.find((u) => u.name === "Christopher Nolan Universe");
    expect(universe?.watchedCount).toBe(2);
    expect(universe?.unseenTitles).not.toContain("The Prestige");
  });

  it("flags taste blindspots for larger libraries", () => {
    const watched = Array.from({ length: 20 }, (_, i) => mk(i + 1, { year: 2015, originalLanguage: i < 12 ? "hi" : "en" }));
    const categories = computeAnalysis(watched, [], ALL).blindspots.map((b) => b.category);
    expect(categories).toEqual([
      "High-Concept Sci-Fi & Speculative Fiction",
      "Prestige Animation & Studio Ghibli",
      "Regional South Indian Cinema (Malayalam & Tamil)",
      "Pre-90s Foundational Classics",
    ]);
    expect(computeAnalysis(watched.slice(0, 5), [], ALL).blindspots).toEqual([]);
  });

  it("chooses a persona from the viewing profile", () => {
    const persona = (watched: ReturnType<typeof mk>[]) => computeAnalysis(watched, [], ALL).persona.title;
    expect(persona([mk(1, { originalLanguage: "hi" })])).toBe("Desi Cinema Connoisseur");
    expect(persona(Array.from({ length: 5 }, (_, i) => mk(i, { mediaType: "tv" })))).toBe("Serial Worldbuilder");
    expect(persona([mk(1, { rating: 8.5 })])).toBe("The Prestigious Cinephile");
    expect(persona([mk(1, { genreNames: ["Science Fiction"] })])).toBe("The Speculative Visionary");
    expect(persona([mk(1, { genreNames: ["Thriller"] })])).toBe("The Suspense Architect");
    expect(persona(Array.from({ length: 6 }, (_, i) => mk(i, { year: 1995 })))).toBe("The Golden Era Traditionalist");
    expect(persona([mk(1)])).toBe("The Eclectic Omnivore");
  });

  it("labels the consensus index by average popularity", () => {
    expect(computeAnalysis([mk(1, { popularity: 1000 })], [], ALL).tasteIndex.consensusLabel).toBe("Mainstream Consensus Loyalist");
    expect(computeAnalysis([mk(1, { popularity: 1 })], [], ALL).tasteIndex.consensusLabel).toBe(
      "Hyper-Contrarian / Deep Cut Specialist"
    );
  });
});
