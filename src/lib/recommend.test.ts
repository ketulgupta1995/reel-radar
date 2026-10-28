import { describe, expect, it } from "vitest";
import { rank } from "./recommend";
import { Title } from "@/types/title";

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
